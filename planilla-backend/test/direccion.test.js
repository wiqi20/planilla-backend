// GET /api/auth/direccion: ¿esta dirección (nombre.planilla.sticr.app) es una empresa de Planilla?
// Unidad (sin base) e integración (con TEST_DATABASE_URL).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { validarSubdominio, nombreParaConsultar, esEtiquetaDns, RESERVADOS, OTROS_SISTEMAS, NUNCA_CLIENTE } = require('../src/subdominios');
const { claveDeIp } = require('../src/limiteIntentos');
const S = require('./soporte/servidor');

const opts = { skip: S.SIN_BASE };
// Los 9 nombres que el PM pidió reservar (no se pueden vender).
const RESERVADOS_PEDIDOS = ['crumble', 'crumble-admin', 'pasteleria-demo', 'pasteleria-demo-admin', 'www', 'admin', 'api', 'planilla', 'planilla-api'];
// Los 8 que nunca son una empresa de Planilla en /direccion (misma lista que NUNCA_CLIENTE del frontend).
const NUNCA = ['crumble', 'crumble-admin', 'pasteleria-demo', 'pasteleria-demo-admin', 'www', 'admin', 'api', 'app'];
// Filas sembradas a mano con nombres de NUNCA (simula datos viejos o un error): igual dan existe:false.
const SEMBRADOS = ['crumble', 'pasteleria-demo', 'www', 'app'];
// Empresas heredadas que existen aunque no cumplan las reglas de venta (H-1 / QA-01).
const HEREDADAS = ['ab', 'q8', 'o1h' + 'x'.repeat(37), 'ayuda', 'o1h--doble', 'o1h' + 'y'.repeat(60)]; // 2, 2, 40, reservado, '--', 63
const SEED_CORTO = 'o1';

const direccion = (valor, ip = S.ipFalsa()) =>
  S.api('GET', '/api/auth/direccion' + (valor === undefined ? '' : `?valor=${encodeURIComponent(valor)}`), { headers: { 'X-Forwarded-For': ip } });

test('subdominios: los 9 nombres pedidos están reservados para la venta', () => {
  for (const n of RESERVADOS_PEDIDOS) {
    assert.equal(RESERVADOS.has(n), true, n);
    assert.deepEqual(validarSubdominio(n), { ok: false, motivo: 'Ese nombre está reservado' }, n);
    assert.equal(validarSubdominio(n.toUpperCase()).ok, false, n);
  }
  assert.deepEqual(OTROS_SISTEMAS, ['crumble', 'crumble-admin', 'pasteleria-demo', 'pasteleria-demo-admin']);
  assert.deepEqual(NUNCA_CLIENTE, NUNCA);
  // Nombres parecidos siguen siendo vendibles.
  assert.equal(validarSubdominio('crumble2').ok, true);
  assert.equal(validarSubdominio('pasteleria').ok, true);
});

test('nombreParaConsultar: cualquier etiqueta DNS de 1 a 63 caracteres salvo NUNCA_CLIENTE; sin reglas de venta', () => {
  assert.equal(nombreParaConsultar('MiNegocio '), 'minegocio');
  for (const n of ['demo', 'a', 'ab', 'q8', 'ayuda', 'soporte', 'planilla', 'planilla-api', 'a--b', 'x'.repeat(40), 'x'.repeat(63)]) {
    assert.equal(nombreParaConsultar(n), n, n);
  }
  for (const n of [...NUNCA, 'APP', '-abc', 'abc-', 'a.b', 'a b', 'ñandú', '', 'x'.repeat(64)]) {
    assert.equal(nombreParaConsultar(n), null, n);
  }
  for (const v of [undefined, null, 5, ['minegocio'], { valor: 'x' }]) assert.equal(nombreParaConsultar(v), null);
  assert.equal(esEtiquetaDns('x'.repeat(63)), true);
  assert.equal(esEtiquetaDns('x'.repeat(64)), false);
});

test('claveDeIp: IPv4 tal cual, IPv6 agrupada por /64, IPv4 mapeada como IPv4', () => {
  assert.equal(claveDeIp('10.1.2.3'), '10.1.2.3');
  assert.equal(claveDeIp('::ffff:10.1.2.3'), '10.1.2.3');
  const bloque = '2001:db8:1:2::/64';
  for (const ip of ['2001:db8:1:2:3:4:5:6', '2001:0DB8:0001:0002::9', '2001:db8:1:2::', '2001:db8:1:2::1%eth0', '2001:db8:1:2:ffff:ffff:ffff:ffff']) {
    assert.equal(claveDeIp(ip), bloque, ip);
  }
  assert.notEqual(claveDeIp('2001:db8:1:3::1'), bloque);
  assert.equal(claveDeIp('2001:db8::1.2.3.4'), '2001:db8:0:0::/64');
  assert.equal(claveDeIp('no-es-ip'), 'no-es-ip');
});

test.before(async () => { if (!S.SIN_BASE) await S.prepararEsquema(); });
test.after(async () => {
  if (S.SIN_BASE) return;
  await S.db().query('DELETE FROM empresas WHERE subdominio = ANY($1)', [[...SEMBRADOS, ...HEREDADAS, SEED_CORTO]]);
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

test('direccion: empresas heredadas que no cumplen las reglas de venta existen (2, 40 y 63 caracteres, reservado, --) (H-1)', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  for (const n of HEREDADAS) {
    await S.db().query('INSERT INTO empresas (nombre, subdominio) VALUES ($1, $2) ON CONFLICT (subdominio) DO NOTHING', [`Heredada ${n}`, n]);
  }
  for (const n of HEREDADAS) {
    const r = await direccion(n);
    assert.equal(r.status, 200, n);
    assert.deepEqual(r.body, { existe: true }, n);
    assert.deepEqual((await direccion(n.toUpperCase())).body, { existe: true }, n);
  }
});

test('direccion: los 8 nunca-cliente, inválidos y libres responden igual que "no existe", aunque haya una fila con ese nombre', opts, async (t) => {
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  for (const n of SEMBRADOS) {
    await S.db().query('INSERT INTO empresas (nombre, subdominio) VALUES ($1, $2) ON CONFLICT (subdominio) DO NOTHING', [`Fila ${n}`, n]);
  }
  const referencia = await direccion('o1tlibre999');
  assert.equal(referencia.status, 200);
  assert.deepEqual(referencia.body, { existe: false });
  const casos = [...NUNCA, '-abc', 'abc-', 'a.b', 'con espacio', 'ñandú', 'x'.repeat(64), 'x'.repeat(200), '', undefined];
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

test('direccion: el límite agrupa IPv6 por /64 (cambiar la parte baja de la dirección no da más cupo) (M-1)', opts, async (t) => {
  const srv = await S.iniciarServidor({ NOMBRES_MAX_POR_IP: '3' });
  t.after(() => srv.detener());
  const prefijo = `2001:db8:${((Math.random() * 0xffff) | 0).toString(16)}:7`;
  for (let i = 1; i <= 3; i++) assert.equal((await direccion('o1tlibre1', `${prefijo}::${i}`)).status, 200);
  assert.equal((await direccion('o1tlibre1', `${prefijo}:ab:cd:ef:${((Math.random() * 0xffff) | 0).toString(16)}`)).status, 429);
  assert.equal((await direccion('o1tlibre1', `${prefijo.replace(/:7$/, ':8')}::1`)).status, 200); // otro /64
});

test('direccion: CORS permite leerla desde un subdominio de planilla.sticr.app y no desde otro sistema de STI', opts, async (t) => {
  const srv = await S.iniciarServidor({ NODE_ENV: 'production' });
  t.after(() => srv.detener());
  const r = await S.api('GET', '/api/auth/direccion?valor=crumble', { headers: { Origin: 'https://crumble.planilla.sticr.app', 'X-Forwarded-For': S.ipFalsa() } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { existe: false });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://crumble.planilla.sticr.app');
  // crumble.sticr.app es de otro sistema: su navegador no puede leer la respuesta (la ruta responde igual).
  const otro = await S.api('GET', '/api/auth/direccion?valor=crumble', { headers: { Origin: 'https://crumble.sticr.app', 'X-Forwarded-For': S.ipFalsa() } });
  assert.equal(otro.status, 200);
  assert.equal(otro.headers.get('access-control-allow-origin'), null);
});

test('registro público (si se activara) y aprovisionamiento rechazan los nombres reservados', opts, async (t) => {
  const srv = await S.iniciarServidor({ ALLOW_PUBLIC_REGISTRATION: 'true' });
  t.after(() => srv.detener());
  const prov = { 'x-provision-secret': S.PROVISION_SECRET };
  for (const n of RESERVADOS_PEDIDOS) {
    const reg = await S.api('POST', '/api/auth/registrar-empresa', { body: { nombreEmpresa: 'X', subdominio: n, usuario: 'dueno', password: 'clave-larga-1' } });
    assert.equal(reg.status, 400, `registrar ${n}: ${reg.texto}`);
    assert.equal(reg.body.error, 'Ese nombre está reservado');
    const e = await S.api('POST', '/api/provision/empresa', { headers: prov, body: { nombreEmpresa: 'X', subdominio: n, stripeSubscriptionId: `sub_res_${n}` } });
    assert.equal(e.status, 400, `provision ${n}: ${e.texto}`);
    const d = await S.api('GET', `/api/provision/subdominio-disponible?valor=${n}`, { headers: prov });
    assert.equal(d.body.disponible, false, n);
  }
  const filas = await S.db().query('SELECT subdominio FROM empresas WHERE subdominio = ANY($1)', [RESERVADOS_PEDIDOS.filter((n) => !SEMBRADOS.includes(n) && n !== 'admin')]);
  assert.equal(filas.rows.length, 0);
});

const seed = (subdominio, env = {}) => spawnSync(process.execPath, [path.join(S.RAIZ, 'db', 'seed-admin.js'), `--subdominio=${subdominio}`], {
  cwd: S.RAIZ, encoding: 'utf8',
  env: { PATH: process.env.PATH, DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:1/x_test', ADMIN_PASSWORD: 'clave-seed-de-pruebas', ...env }
});

test('seed-admin: rechaza un subdominio que no es etiqueta DNS (sin tocar la base)', () => {
  for (const n of ['x'.repeat(64), '-abc', 'a.b', 'con espacio']) {
    const r = seed(n, { DATABASE_URL: 'postgresql://postgres@localhost:1/sin_base_test' });
    assert.equal(r.status, 1, n);
    assert.match(r.stderr, /no es válido: usa de 1 a 63/, n);
  }
});

test('seed-admin: un nombre fuera de las reglas de venta se crea con un aviso, y /direccion lo ve', opts, async (t) => {
  const r = seed(SEED_CORTO);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /no cumple las reglas de venta \(Debe tener entre 3 y 30 caracteres\)\. Se crea igual\./);
  const srv = await S.iniciarServidor();
  t.after(() => srv.detener());
  assert.deepEqual((await direccion(SEED_CORTO)).body, { existe: true });
});
