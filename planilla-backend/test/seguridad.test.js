// Integración: límite de intentos, cabeceras, CORS, tokens de usuarios borrados, demo y seed-admin.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const S = require('./soporte/servidor');

const opts = { skip: S.SIN_BASE };
const login = (subdominio, usuario, password, ip) =>
  S.api('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': ip }, body: { subdominio, usuario, password } });

test.before(async () => { if (!S.SIN_BASE) await S.prepararEsquema(); });
test.after(async () => { if (!S.SIN_BASE) await S.limpiar(); });

const contar = (rs) => rs.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});

test('N-01: 200 intentos CONCURRENTES contra un usuario real: como máximo 10 respuestas 401, el resto 429', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('n1');
  const ip = S.ipFalsa();
  const rs = await Promise.all(Array.from({ length: 200 }, (_, i) => login(A.subdominio, A.usuario, `mala-${i}`, ip)));
  const c = contar(rs);
  console.log('    concurrencia, usuario real (200):', JSON.stringify(c));
  assert.ok(c[401] <= 10, JSON.stringify(c));
  assert.equal((c[401] || 0) + (c[429] || 0), 200, JSON.stringify(c));
  assert.match(rs.find((r) => r.status === 429).body.error, /Demasiados intentos/);
});

test('N-01: 200 intentos CONCURRENTES contra un usuario inexistente: como máximo 10 respuestas 401', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('n2');
  const ip = S.ipFalsa();
  const rs = await Promise.all(Array.from({ length: 200 }, (_, i) => login(A.subdominio, 'fantasma', `mala-${i}`, ip)));
  const c = contar(rs);
  console.log('    concurrencia, usuario inexistente (200):', JSON.stringify(c));
  assert.ok(c[401] <= 10, JSON.stringify(c));
  assert.equal((c[401] || 0) + (c[429] || 0), 200, JSON.stringify(c));
  // empresa inexistente: misma conducta
  const ip2 = S.ipFalsa();
  const rs2 = await Promise.all(Array.from({ length: 50 }, (_, i) => login('o1tnoexiste', 'x', `m${i}`, ip2)));
  assert.ok(contar(rs2)[401] <= 10);
});

test('usuario inexistente y contraseña errónea responden igual (mismo mensaje y tiempo parecido)', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('t');
  const medir = async (usuario) => {
    const t0 = process.hrtime.bigint();
    const r = await login(A.subdominio, usuario, 'mala-contraseña', S.ipFalsa());
    return { r, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
  };
  await medir('calentar');
  const real = await medir(A.usuario);
  const falso = await medir('fantasma');
  assert.equal(real.r.status, 401); assert.equal(falso.r.status, 401);
  assert.deepEqual(real.r.body, falso.r.body);
  assert.ok(falso.ms > real.ms / 3, `inexistente ${falso.ms} ms vs real ${real.ms} ms: debería ejecutar bcrypt también`);
});

test('login: 10 fallos del mismo par IP+usuario dan 429 (aun con la clave correcta) y otra IP no se ve afectada', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('r');
  const ip = S.ipFalsa();
  for (let i = 0; i < 10; i++) assert.equal((await login(A.subdominio, A.usuario, `mala-${i}`, ip)).status, 401);
  const bloqueado = await login(A.subdominio, A.usuario, A.password, ip);
  assert.equal(bloqueado.status, 429);
  assert.match(bloqueado.body.error, /Demasiados intentos/);
  assert.ok(Number(bloqueado.headers.get('retry-after')) > 0);
  assert.equal((await login(A.subdominio, A.usuario, A.password, S.ipFalsa())).status, 200);
});

test('N-02: un atacante en la IP A que falla 50 veces contra X no impide que X entre desde la IP B', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('v');
  const ipA = S.ipFalsa();
  const rs = [];
  for (let i = 0; i < 50; i++) rs.push(await login(A.subdominio, A.usuario, `mala-${i}`, ipA));
  const c = contar(rs);
  assert.equal(c[401], 10);
  assert.equal(c[429], 40);
  const victima = await login(A.subdominio, A.usuario, A.password, S.ipFalsa());
  assert.equal(victima.status, 200);
});

test('IP sola: 40 fallos con usuarios distintos desde una IP la bloquean (rociado); concurrente también', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('i');
  const ip = S.ipFalsa();
  const rs = await Promise.all(Array.from({ length: 80 }, (_, i) => login(A.subdominio, `u${i}`, 'x', ip)));
  const c = contar(rs);
  assert.ok(c[401] <= 40, JSON.stringify(c));
  assert.equal((await login(A.subdominio, A.usuario, A.password, ip)).status, 429);
  assert.equal((await login(A.subdominio, A.usuario, A.password, S.ipFalsa())).status, 200);
});

test('usuario solo: la fuerza bruta distribuida (muchas IP) se frena en 100, no antes', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('d2');
  const rs = await Promise.all(Array.from({ length: 120 }, (_, i) => login(A.subdominio, A.usuario, `mala-${i}`, S.ipFalsa())));
  const c = contar(rs);
  console.log('    distribuido, 120 IP distintas:', JSON.stringify(c));
  assert.equal(c[401], 100);
  assert.equal(c[429], 20);
});

test('login: los aciertos no cuentan y limpian los fallos', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('k');
  const ip = S.ipFalsa();
  for (let ronda = 0; ronda < 3; ronda++) {
    for (let i = 0; i < 9; i++) await login(A.subdominio, A.usuario, 'mala', ip);
    assert.equal((await login(A.subdominio, A.usuario, A.password, ip)).status, 200);
  }
  for (let i = 0; i < 12; i++) assert.equal((await login(A.subdominio, A.usuario, A.password, ip)).status, 200);
});

test('login: usuarios existentes con contraseña corta siguen entrando', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('c');
  await S.db().query('INSERT INTO usuarios (empresa_id, usuario, password_hash) VALUES ($1, $2, $3)',
    [A.empresaId, 'antiguo', await bcrypt.hash('abc', 4)]);
  const r = await login(A.subdominio, 'antiguo', 'abc', S.ipFalsa());
  assert.equal(r.status, 200);
  assert.equal((await login(A.subdominio, 'antiguo', 'abc', S.ipFalsa())).body.usuario.usuario, 'antiguo');
});

test('login: campos que no son texto dan 400', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const r = await S.api('POST', '/api/auth/login', { body: { subdominio: 'x', usuario: { a: 1 }, password: ['y'] } });
  assert.equal(r.status, 400);
});

test('cabeceras de seguridad (helmet) y sin X-Powered-By', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const r = await S.api('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.ok(r.headers.get('strict-transport-security'));
  assert.ok(r.headers.get('referrer-policy'));
});

test('CORS: origen ajeno no recibe Access-Control-Allow-Origin; los permitidos y sin Origin funcionan', opts, async (t) => {
  const srv = await S.iniciarServidor({ NODE_ENV: 'production' });
  t.after(() => srv.detener());
  const ajeno = await S.api('GET', '/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(ajeno.status, 200);
  assert.equal(ajeno.headers.get('access-control-allow-origin'), null);
  const preAjeno = await fetch(`${S.BASE}/api/empleados`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(preAjeno.headers.get('access-control-allow-origin'), null);
  for (const o of ['https://sticr.app', 'https://planilla.sticr.app', 'https://posadasweet.sticr.app', 'https://demo.sticr.app', 'https://cliente9.sticr.app']) {
    const r = await S.api('GET', '/health', { headers: { Origin: o } });
    assert.equal(r.headers.get('access-control-allow-origin'), o);
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
  }
  const pre = await fetch(`${S.BASE}/api/empleados`, { method: 'OPTIONS', headers: { Origin: 'https://planilla.sticr.app', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://planilla.sticr.app');
  // localhost no se permite en producción
  const local = await S.api('GET', '/health', { headers: { Origin: 'http://localhost:3000' } });
  assert.equal(local.headers.get('access-control-allow-origin'), null);
  // sin Origin (servidor a servidor): el aprovisionamiento sigue funcionando
  const sin = await S.api('POST', '/api/provision/empresa', { headers: { 'x-provision-secret': S.PROVISION_SECRET }, body: {} });
  assert.equal(sin.status, 400); // llegó a la validación: CORS no lo bloquea
});

test('CORS: fuera de producción se permite localhost; CORS_ORIGINS reemplaza la lista', opts, async (t) => {
  let srv = await S.iniciarServidor({ NODE_ENV: 'development' });
  const local = await S.api('GET', '/health', { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  await srv.detener();
  srv = await S.iniciarServidor({ NODE_ENV: 'production', CORS_ORIGINS: 'https://solo-este.example' });
  t.after(() => srv.detener());
  assert.equal((await S.api('GET', '/health', { headers: { Origin: 'https://solo-este.example' } })).headers.get('access-control-allow-origin'), 'https://solo-este.example');
  assert.equal((await S.api('GET', '/health', { headers: { Origin: 'https://planilla.sticr.app' } })).headers.get('access-control-allow-origin'), null);
});

test('token de un usuario borrado deja de servir (y el de los demás sigue)', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('d');
  const nuevo = await S.api('POST', '/api/admin/usuarios', { token: A.token, body: { usuario: 'temporal', password: 'temporal-123' } });
  assert.equal(nuevo.status, 201, nuevo.texto);
  const l = await login(A.subdominio, 'temporal', 'temporal-123', S.ipFalsa());
  assert.equal(l.status, 200);
  assert.equal((await S.api('GET', '/api/empleados', { token: l.body.token })).status, 200);

  assert.equal((await S.api('DELETE', `/api/admin/usuarios/${nuevo.body.id}`, { token: A.token })).status, 204);
  const despues = await S.api('GET', '/api/empleados', { token: l.body.token });
  assert.equal(despues.status, 401);
  assert.equal((await S.api('GET', '/api/empleados', { token: A.token })).status, 200);
});

test('token con el id de usuario de OTRA empresa no sirve', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('x');
  const B = await S.crearEmpresa('y');
  const jwt = require('jsonwebtoken');
  const falso = jwt.sign({ empresaId: A.empresaId, usuarioId: B.usuarioId, usuario: 'x' }, 'jwt-de-pruebas-no-es-un-secreto-real');
  assert.equal((await S.api('GET', '/api/empleados', { token: falso })).status, 401);
});

test('la empresa demo (demo / demo1234) se crea al arrancar y su login sigue funcionando', opts, async (t) => {
  const srv = await S.iniciarServidor({ DEMO_ENABLED: 'true' });
  t.after(() => srv.detener());
  let r;
  for (let i = 0; i < 50; i++) {
    r = await login('demo', 'demo', 'demo1234', S.ipFalsa());
    if (r.status === 200) break;
    await new Promise((x) => setTimeout(x, 200));
  }
  assert.equal(r.status, 200, r.texto);
  assert.equal((await S.api('GET', '/api/empleados', { token: r.body.token })).body.length, 6);
  // N-02: nadie puede dejar fuera a la demo con fallos (par y usuario excluidos; solo cuenta la IP)
  const ipAtacante = S.ipFalsa();
  for (let i = 0; i < 60; i++) await login('demo', 'demo', `mala-${i}`, ipAtacante);
  assert.equal((await login('demo', 'demo', 'demo1234', S.ipFalsa())).status, 200);
  const rafaga = await Promise.all(Array.from({ length: 30 }, (_, i) => login('demo', 'demo', 'x' + i, S.ipFalsa())));
  assert.ok(rafaga.every((x) => x.status === 401), 'la demo no se bloquea por fallos de otros');
  assert.equal((await login('demo', 'demo', 'demo1234', S.ipFalsa())).status, 200);
  // la demo sigue siendo de solo lectura para usuarios
  assert.equal((await S.api('POST', '/api/admin/usuarios', { token: r.body.token, body: { usuario: 'otro', password: '12345678' } })).status, 403);
  // un reinicio de la demo invalida los tokens viejos (el usuario se vuelve a crear) pero se puede volver a entrar
  assert.equal((await S.api('POST', '/api/provision/demo/reiniciar', { headers: { 'x-provision-secret': S.PROVISION_SECRET } })).status, 200);
  assert.equal((await login('demo', 'demo', 'demo1234', S.ipFalsa())).status, 200);
});

const seed = (env) => spawnSync(process.execPath, [path.join(S.RAIZ, 'db', 'seed-admin.js'), '--subdominio=o1tseed'], {
  cwd: S.RAIZ, encoding: 'utf8', env: { PATH: process.env.PATH, DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:1/x_test', ...env }
});

test('seed-admin: sin ADMIN_PASSWORD (o con menos de 8 caracteres) falla con mensaje claro', () => {
  for (const env of [{}, { ADMIN_PASSWORD: '' }, { ADMIN_PASSWORD: '1234567' }]) {
    const r = seed(env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ADMIN_PASSWORD/);
    assert.doesNotMatch(r.stdout + r.stderr, /IexxI/);
  }
});

test('seed-admin: con ADMIN_PASSWORD válida crea el administrador y no imprime la clave', opts, async () => {
  const clave = 'clave-seed-de-pruebas';
  const r = seed({ ADMIN_PASSWORD: clave });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, new RegExp(clave));
  const fila = await S.db().query("SELECT u.password_hash FROM usuarios u JOIN empresas e ON e.id = u.empresa_id WHERE e.subdominio = 'o1tseed'");
  assert.equal(await bcrypt.compare(clave, fila.rows[0].password_hash), true);
});

test('arranque: escribe en el log qué trust proxy quedó activo y por qué', opts, async () => {
  let srv = await S.iniciarServidor({ TRUST_PROXY: '', RAILWAY_PROJECT_ID: 'proyecto-de-prueba', NODE_ENV: 'development' });
  assert.match(srv.salida(), /\[aviso\] trust proxy = 1 \(se detectó Railway \(RAILWAY_PROJECT_ID\)\)/);
  assert.doesNotMatch(srv.salida(), /proyecto-de-prueba/);
  await srv.detener();
  srv = await S.iniciarServidor({ TRUST_PROXY: '' });
  assert.match(srv.salida(), /\[aviso\] trust proxy = false/);
  await srv.detener();
});
