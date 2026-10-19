// Integración: el servidor real arranca migrando solo y se apaga en orden con SIGTERM/SIGINT.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const S = require('./soporte/servidor');

const opts = { skip: S.SIN_BASE };
const ESQUEMA = 'arranque_test';

test.before(async () => { if (!S.SIN_BASE) { await S.prepararEsquema(); await S.db().query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`); } });
test.after(async () => {
  if (S.SIN_BASE) return;
  await S.db().query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  await S.limpiar();
});

async function puertoCerrado() {
  await assert.rejects(fetch(`${S.BASE}/health`), 'el puerto ya no acepta conexiones');
}

test('al arrancar sobre una base vacía aplica las migraciones solo, y SIGTERM lo apaga con código 0', opts, async () => {
  const srv = await S.iniciarServidor({ DB_SCHEMA: ESQUEMA });
  const tablas = (await S.db().query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1", [ESQUEMA])).rows.map((r) => r.table_name);
  for (const t of ['empresas', 'usuarios', 'empleados', 'colillas', 'reportes', 'boletas_vacaciones', 'schema_migrations']) assert.ok(tablas.includes(t), `falta ${t}`);
  const col = await S.db().query("SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'usuarios' AND column_name = 'token_version'", [ESQUEMA]);
  assert.equal(col.rows.length, 1);
  assert.equal((await S.api('GET', '/health')).status, 200);

  srv.proceso.kill('SIGTERM');
  assert.equal(await srv.esperarSalida(), 0);
  assert.match(srv.salida(), /\[cierre\] terminado en orden/);
  await puertoCerrado();
});

test('SIGINT también apaga en orden', opts, async () => {
  const srv = await S.iniciarServidor({ DB_SCHEMA: ESQUEMA });
  srv.proceso.kill('SIGINT');
  assert.equal(await srv.esperarSalida(), 0);
  await puertoCerrado();
});

test('si la base no está disponible y debe migrar, el servicio no inicia (sale con error)', opts, async () => {
  await assert.rejects(S.iniciarServidor({ DATABASE_URL: 'postgresql://postgres@localhost:1/sin_base_test' }, { esperarOk: true }), /No se pudo iniciar el servicio/);
});

// Abre una conexión nueva, manda el login y avisa cuando la conexión ya está establecida (así la petición
// está de verdad "en vuelo" cuando llega la señal, sin depender de tiempos).
function loginEnVuelo() {
  let conectada;
  const lista = new Promise((r) => { conectada = r; });
  const respuesta = new Promise((resolve, rechazar) => {
    const cuerpo = JSON.stringify({ subdominio: 'no-existe', usuario: 'x', password: 'y' });
    const req = http.request(`${S.BASE}/api/auth/login`, {
      method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo), 'X-Forwarded-For': S.ipFalsa() }
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('socket', (sock) => sock.once('connect', conectada));
    req.on('error', rechazar);
    req.end(cuerpo);
  });
  return { lista, respuesta };
}

test('las peticiones en vuelo durante SIGTERM se completan antes de salir', opts, async () => {
  const srv = await S.iniciarServidor({ DB_SCHEMA: ESQUEMA });
  // Un login cuesta ~100 ms de bcrypt: se envían varios y se manda la señal mientras se procesan.
  const enVuelo = Array.from({ length: 6 }, loginEnVuelo);
  await Promise.all(enVuelo.map((p) => p.lista));
  await new Promise((r) => setTimeout(r, 30));
  srv.proceso.kill('SIGTERM');
  const estados = await Promise.all(enVuelo.map((p) => p.respuesta));
  assert.deepEqual(estados, [401, 401, 401, 401, 401, 401], 'cada petición recibió su respuesta completa');
  assert.equal(await srv.esperarSalida(), 0);
});
