// Pruebas de QA (independientes) del cambio "subdominio inexistente".
// Correr: TEST_DATABASE_URL=postgresql://postgres@localhost:<puerto>/<base>_test node --test qa-subdominio-inexistente/
// Usan el servidor real (test/soporte/servidor.js) contra una base desechable. Crean sus datos y los borran.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../test/soporte/servidor');
const bcrypt = require('bcryptjs');
const hashPassword = (p) => bcrypt.hash(p, 10);

const opts = { skip: S.SIN_BASE };
const direccion = (valor, ip = S.ipFalsa(), extra = {}) =>
  S.api('GET', '/api/auth/direccion?valor=' + encodeURIComponent(valor), { headers: { 'X-Forwarded-For': ip, ...extra } });

// Empresas "heredadas": nombres que el registro público aceptaba antes de este cambio (1 a 63 caracteres, sin lista
// de reservados; abierto del 25 sep al 14 oct 2026) o que db/seed-admin.js acepta hoy sin validar (--subdominio=...).
const LARGO_31 = 'qa' + 'l'.repeat(29); // 31 caracteres
const HEREDADAS = ['q7', LARGO_31, 'soporte'];
const CLAVE = 'clave-de-prueba-qa-1';

test.before(async () => {
  if (S.SIN_BASE) return;
  await S.prepararEsquema();
  const hash = await hashPassword(CLAVE);
  for (const n of HEREDADAS) {
    const e = await S.db().query(
      'INSERT INTO empresas (nombre, subdominio) VALUES ($1, $2) ON CONFLICT (subdominio) DO UPDATE SET activa = true RETURNING id',
      [`QA ${n}`, n]
    );
    await S.db().query(
      'INSERT INTO usuarios (empresa_id, usuario, password_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [e.rows[0].id, 'dueno', hash]
    );
  }
});
test.after(async () => {
  if (S.SIN_BASE) return;
  await S.db().query('DELETE FROM empresas WHERE subdominio = ANY($1)', [HEREDADAS]);
  await S.limpiar();
});

test('QA-B1: empresa activa y suspendida existen; el login de ambas responde como antes (200 y 403 suspendida)', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('qa');
  assert.deepEqual((await direccion(A.subdominio)).body, { existe: true });
  const ok = await S.api('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': S.ipFalsa() }, body: { subdominio: A.subdominio, usuario: A.usuario, password: A.password } });
  assert.equal(ok.status, 200);
  await S.api('POST', '/api/provision/estado', { headers: { 'x-provision-secret': S.PROVISION_SECRET }, body: { stripeSubscriptionId: A.sub, activa: false } });
  assert.deepEqual((await direccion(A.subdominio)).body, { existe: true });
  const susp = await S.api('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': S.ipFalsa() }, body: { subdominio: A.subdominio, usuario: A.usuario, password: A.password } });
  assert.equal(susp.status, 403);
  assert.equal(susp.body.codigo, 'suspendida');
  // El token ya emitido deja de servir (como antes).
  const yo = await S.api('GET', '/api/empleados', { token: A.token });
  assert.ok([401, 403].includes(yo.status), `token de empresa suspendida: ${yo.status}`);
});

test('QA-B2: la demo (DEMO_ENABLED=true) existe y entra con demo/demo1234', opts, async (t) => {
  const srv = await S.iniciarServidor({ DEMO_ENABLED: 'true' });
  t.after(() => srv.detener());
  let r;
  for (let i = 0; i < 30; i++) { r = await direccion('demo'); if (r.body && r.body.existe) break; await new Promise((x) => setTimeout(x, 200)); }
  assert.deepEqual(r.body, { existe: true });
  const l = await S.api('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': S.ipFalsa() }, body: { subdominio: 'demo', usuario: 'demo', password: 'demo1234' } });
  assert.equal(l.status, 200);
});

test('QA-B3: los clientes heredados con nombres fuera de 3-30 o reservados siguen pudiendo iniciar sesión en la API', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  for (const n of HEREDADAS) {
    const l = await S.api('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': S.ipFalsa() }, body: { subdominio: n, usuario: 'dueno', password: CLAVE } });
    assert.equal(l.status, 200, `login ${n}: ${l.texto}`);
  }
});

// DEFECTO QA-01: esta prueba falla con el commit 3c93808. /direccion responde existe:false para empresas reales cuyo
// nombre no pasa validarSubdominio, y el frontend les muestra "Esta dirección no existe" (sin formulario de ingreso).
test('QA-B4 (QA-01): /direccion dice que existen los clientes heredados con nombres fuera de 3-30 o reservados', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const obtenido = {};
  for (const n of HEREDADAS) obtenido[n] = (await direccion(n)).body.existe;
  assert.deepEqual(obtenido, Object.fromEntries(HEREDADAS.map((n) => [n, true])));
});

test('QA-B5: registrar-empresa (si se activara) rechaza 2 y 31 caracteres, acepta 3 y 30', opts, async (t) => {
  const srv = await S.iniciarServidor({ ALLOW_PUBLIC_REGISTRATION: 'true' });
  t.after(() => srv.detener());
  const reg = (subdominio) => S.api('POST', '/api/auth/registrar-empresa', { body: { nombreEmpresa: 'QA', subdominio, usuario: 'dueno', password: 'clave-larga-1' } });
  assert.equal((await reg('o1')).status, 400);
  assert.equal((await reg('o1t' + 'x'.repeat(28))).status, 400); // 31
  const tres = 'o1t';
  const treinta = 'o1t' + 'y'.repeat(27);
  await S.db().query('DELETE FROM empresas WHERE subdominio = ANY($1)', [[tres, treinta]]);
  assert.equal((await reg(tres)).status, 201);
  assert.equal((await reg(treinta)).status, 201);
});

test('QA-B6: límite por IP. 120 cargas de página pasan; la 121 da 429; otra IP y el login no se ven afectados', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('ql');
  const ip = S.ipFalsa();
  for (let i = 0; i < 120; i++) {
    const r = await direccion(A.subdominio, ip);
    assert.equal(r.status, 200, `consulta ${i + 1}`);
    assert.deepEqual(r.body, { existe: true });
  }
  const r121 = await direccion(A.subdominio, ip);
  assert.equal(r121.status, 429);
  assert.ok(Number(r121.headers.get('retry-after')) > 0);
  // El login desde esa misma IP sigue funcionando: el límite de nombres es aparte.
  const l = await S.api('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': ip }, body: { subdominio: A.subdominio, usuario: A.usuario, password: A.password } });
  assert.equal(l.status, 200);
  assert.equal((await direccion(A.subdominio, S.ipFalsa())).status, 200);
});

test('QA-B7: X-Forwarded-For con varias IP: cuenta la última (la que agrega el proxy), no la que inventa el cliente', opts, async (t) => {
  const srv = await S.iniciarServidor({ NOMBRES_MAX_POR_IP: '3' });
  t.after(() => srv.detener());
  const real = S.ipFalsa();
  for (let i = 0; i < 3; i++) assert.equal((await direccion('o1tlibre1', `${S.ipFalsa()}, ${real}`)).status, 200);
  assert.equal((await direccion('o1tlibre1', `${S.ipFalsa()}, ${real}`)).status, 429);
});

test('QA-B8: entradas raras no rompen la ruta (200 con solo {existe}; el carácter nulo da 400 como en toda la API)', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  // El carácter nulo lo rechaza antes el filtro global (rechazarNul, ola 2) con 400: comportamiento previo y esperado.
  for (const v of ['\u0000abc']) assert.equal((await direccion(v)).status, 400, JSON.stringify(v));
  for (const v of ["' OR 1=1 --", '%00', 'demo ', ' DEMO', 'a'.repeat(5000), 'xn--abc', '..', 'crumble.sticr.app']) {
    const r = await direccion(v);
    assert.equal(r.status, 200, JSON.stringify(v));
    assert.equal(typeof r.body.existe, 'boolean');
    assert.deepEqual(Object.keys(r.body), ['existe']);
  }
  // Mayúsculas y espacios de la demo se normalizan (el navegador ya manda el host en minúsculas).
  const sinParam = await S.api('GET', '/api/auth/direccion', { headers: { 'X-Forwarded-For': S.ipFalsa() } });
  assert.deepEqual(sinParam.body, { existe: false });
});
