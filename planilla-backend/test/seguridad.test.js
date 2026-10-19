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

test('login: bloquea tras 10 fallos desde la misma IP (429 en español) y no afecta a otra IP', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('r');
  const ip = S.ipFalsa();
  for (let i = 0; i < 10; i++) {
    const r = await login(A.subdominio, `inexistente${i}`, 'x', ip); // usuarios distintos: solo cuenta la IP
    assert.equal(r.status, 401);
  }
  const bloqueado = await login(A.subdominio, A.usuario, A.password, ip); // ni con la clave correcta
  assert.equal(bloqueado.status, 429);
  assert.match(bloqueado.body.error, /Demasiados intentos/);
  assert.ok(Number(bloqueado.headers.get('retry-after')) > 0);
  const otraIp = await login(A.subdominio, A.usuario, A.password, S.ipFalsa());
  assert.equal(otraIp.status, 200);
});

test('login: bloquea tras 10 fallos contra el mismo usuario aunque cambie la IP', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('u');
  for (let i = 0; i < 10; i++) {
    assert.equal((await login(A.subdominio, A.usuario, `mala-${i}`, S.ipFalsa())).status, 401);
  }
  const r = await login(A.subdominio, A.usuario.toUpperCase(), A.password, S.ipFalsa());
  assert.equal(r.status, 429);
  assert.match(r.body.error, /Demasiados intentos/);
  // otro usuario de la misma empresa no se ve afectado
  const otro = await login(A.subdominio, 'no-bloqueado', 'x', S.ipFalsa());
  assert.equal(otro.status, 401);
});

test('login: los aciertos no cuentan y limpian los fallos del usuario', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('k');
  for (let ronda = 0; ronda < 3; ronda++) {
    for (let i = 0; i < 9; i++) await login(A.subdominio, A.usuario, 'mala', S.ipFalsa());
    assert.equal((await login(A.subdominio, A.usuario, A.password, S.ipFalsa())).status, 200);
  }
  const ip = S.ipFalsa();
  for (let i = 0; i < 15; i++) assert.equal((await login(A.subdominio, A.usuario, A.password, ip)).status, 200);
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
