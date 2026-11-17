// GET /api/auth/direccion: ¿esta dirección (nombre.sticr.app) es una empresa de Planilla?
// Unidad (sin base) e integración (con TEST_DATABASE_URL).
const test = require('node:test');
const assert = require('node:assert/strict');
const { validarSubdominio, nombreDeEmpresaPosible, RESERVADOS, OTROS_SISTEMAS } = require('../src/subdominios');
const S = require('./soporte/servidor');

const opts = { skip: S.SIN_BASE };
const NUNCA_CLIENTE = ['crumble', 'crumble-admin', 'pasteleria-demo', 'pasteleria-demo-admin', 'www', 'admin', 'api', 'planilla', 'planilla-api'];
// Filas sembradas a mano con nombres que nunca deben contar como cliente (simula datos viejos o un error).
const SEMBRADOS = ['crumble', 'pasteleria-demo', 'www'];

const direccion = (valor, ip = S.ipFalsa()) =>
  S.api('GET', '/api/auth/direccion' + (valor === undefined ? '' : `?valor=${encodeURIComponent(valor)}`), { headers: { 'X-Forwarded-For': ip } });

test('subdominios: los nombres de otros sistemas y los propios de STI están reservados', () => {
  for (const n of NUNCA_CLIENTE) {
    assert.equal(RESERVADOS.has(n), true, n);
    assert.deepEqual(validarSubdominio(n), { ok: false, motivo: 'Ese nombre está reservado' }, n);
    assert.equal(validarSubdominio(n.toUpperCase()).ok, false, n);
  }
  assert.deepEqual(OTROS_SISTEMAS, ['crumble', 'crumble-admin', 'pasteleria-demo', 'pasteleria-demo-admin']);
  // Nombres parecidos siguen siendo vendibles.
  assert.equal(validarSubdominio('crumble2').ok, true);
  assert.equal(validarSubdominio('pasteleria').ok, true);
});

test('nombreDeEmpresaPosible: solo nombres vendibles y la demo; nunca reservados, inválidos ni no-texto', () => {
  assert.equal(nombreDeEmpresaPosible('MiNegocio '), 'minegocio');
  assert.equal(nombreDeEmpresaPosible('demo'), 'demo');
  for (const n of [...NUNCA_CLIENTE, 'ab', '-abc', 'abc-', 'a--b', 'a.b', 'a b', '', 'x'.repeat(31)]) {
    assert.equal(nombreDeEmpresaPosible(n), null, n);
  }
  for (const v of [undefined, null, 5, ['minegocio'], { valor: 'x' }]) assert.equal(nombreDeEmpresaPosible(v), null);
});

test.before(async () => { if (!S.SIN_BASE) await S.prepararEsquema(); });
test.after(async () => {
  if (S.SIN_BASE) return;
  await S.db().query('DELETE FROM empresas WHERE subdominio = ANY($1)', [SEMBRADOS]);
  await S.limpiar();
});

test('direccion: una empresa existe (activa o suspendida); un nombre libre no', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const A = await S.crearEmpresa('d');
  const r = await direccion(A.subdominio);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { existe: true }); // nada más: ni nombre, ni estado, ni id
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await direccion(A.subdominio.toUpperCase())).body, { existe: true });

  const susp = await S.api('POST', '/api/provision/estado', { headers: { 'x-provision-secret': S.PROVISION_SECRET }, body: { stripeSubscriptionId: A.sub, activa: false } });
  assert.equal(susp.status, 200);
  assert.deepEqual((await direccion(A.subdominio)).body, { existe: true });

  assert.deepEqual((await direccion('o1tnoexiste123')).body, { existe: false });
});

test('direccion: la demo existe solo si está creada', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  await S.db().query("DELETE FROM empresas WHERE subdominio = 'demo' AND es_demo");
  assert.deepEqual((await direccion('demo')).body, { existe: false });
  await S.db().query("INSERT INTO empresas (nombre, subdominio, es_demo) VALUES ('Demo', 'demo', true)");
  assert.deepEqual((await direccion('demo')).body, { existe: true });
});

test('direccion: reservados, otros sistemas e inválidos responden igual que "no existe", aunque haya una fila con ese nombre', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  for (const n of SEMBRADOS) {
    await S.db().query('INSERT INTO empresas (nombre, subdominio) VALUES ($1, $2) ON CONFLICT (subdominio) DO NOTHING', [`Fila ${n}`, n]);
  }
  const referencia = await direccion('o1tlibre999');
  assert.equal(referencia.status, 200);
  assert.deepEqual(referencia.body, { existe: false });
  const casos = [...NUNCA_CLIENTE, 'ab', 'a--b', '-abc', 'con espacio', 'ñandú', 'x'.repeat(200), '', undefined];
  for (const v of casos) {
    const r = await direccion(v);
    assert.equal(r.status, 200, String(v));
    assert.equal(r.texto, referencia.texto, String(v));
    assert.equal(r.headers.get('cache-control'), 'no-store', String(v));
  }
  // Parámetro repetido (llega como arreglo): igual.
  const arr = await S.api('GET', '/api/auth/direccion?valor=crumble&valor=crumble', { headers: { 'X-Forwarded-For': S.ipFalsa() } });
  assert.equal(arr.status, 200);
  assert.equal(arr.texto, referencia.texto);
});

test('direccion: "no existe" e "inválido" tardan parecido (los dos consultan la base)', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  const medir = async (valor) => {
    const ms = [];
    for (let i = 0; i < 25; i++) {
      const t0 = process.hrtime.bigint();
      await direccion(valor, S.ipFalsa()); // otra IP en cada llamada: el límite no interviene
      ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    ms.sort((a, b) => a - b);
    return ms[Math.floor(ms.length / 2)];
  };
  await medir('o1tcalentar');
  const libre = await medir('o1tlibre777');
  const invalido = await medir('crumble');
  console.log(`    mediana libre ${libre.toFixed(2)} ms, reservado ${invalido.toFixed(2)} ms`);
  assert.ok(Math.abs(libre - invalido) < 5, `libre ${libre} ms vs reservado ${invalido} ms`);
});

test('direccion: límite de consultas por IP (compartido con subdominio-disponible), con 429 y Retry-After', opts, async (t) => {
  const srv = await S.iniciarServidor({ NOMBRES_MAX_POR_IP: '5' });
  t.after(() => srv.detener());
  const ip = S.ipFalsa();
  for (let i = 0; i < 4; i++) assert.equal((await direccion(`o1tn${i}abc`, ip)).status, 200);
  const disp = await S.api('GET', '/api/auth/subdominio-disponible?valor=o1tzzz', { headers: { 'X-Forwarded-For': ip } });
  assert.equal(disp.status, 200);
  const bloqueado = await direccion('o1tn9abc', ip);
  assert.equal(bloqueado.status, 429);
  assert.match(bloqueado.body.error, /Demasiadas consultas/);
  assert.ok(bloqueado.body.mensaje);
  assert.ok(Number(bloqueado.headers.get('retry-after')) > 0);
  assert.equal(bloqueado.headers.get('cache-control'), 'no-store');
  const disp2 = await S.api('GET', '/api/auth/subdominio-disponible?valor=o1tzzz', { headers: { 'X-Forwarded-For': ip } });
  assert.equal(disp2.status, 429);
  // Otra IP no se ve afectada.
  assert.equal((await direccion('o1tn9abc', S.ipFalsa())).status, 200);
});

test('direccion: CORS permite leerla desde un subdominio de sticr.app', opts, async (t) => {
  const srv = await S.iniciarServidor({ NODE_ENV: 'production' });
  t.after(() => srv.detener());
  const r = await S.api('GET', '/api/auth/direccion?valor=crumble', { headers: { Origin: 'https://crumble.sticr.app', 'X-Forwarded-For': S.ipFalsa() } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://crumble.sticr.app');
});

test('registro público (si se activara) y aprovisionamiento rechazan los nombres reservados', opts, async (t) => {
  const srv = await S.iniciarServidor({ ALLOW_PUBLIC_REGISTRATION: 'true' });
  t.after(() => srv.detener());
  const prov = { 'x-provision-secret': S.PROVISION_SECRET };
  for (const n of NUNCA_CLIENTE) {
    const reg = await S.api('POST', '/api/auth/registrar-empresa', { body: { nombreEmpresa: 'X', subdominio: n, usuario: 'dueno', password: 'clave-larga-1' } });
    assert.equal(reg.status, 400, `registrar ${n}: ${reg.texto}`);
    assert.equal(reg.body.error, 'Ese nombre está reservado');
    const e = await S.api('POST', '/api/provision/empresa', { headers: prov, body: { nombreEmpresa: 'X', subdominio: n, stripeSubscriptionId: `sub_res_${n}` } });
    assert.equal(e.status, 400, `provision ${n}: ${e.texto}`);
    const d = await S.api('GET', `/api/provision/subdominio-disponible?valor=${n}`, { headers: prov });
    assert.equal(d.body.disponible, false, n);
  }
  const filas = await S.db().query('SELECT subdominio FROM empresas WHERE subdominio = ANY($1)', [NUNCA_CLIENTE.filter((n) => !SEMBRADOS.includes(n) && n !== 'admin')]);
  assert.equal(filas.rows.length, 0);
});
