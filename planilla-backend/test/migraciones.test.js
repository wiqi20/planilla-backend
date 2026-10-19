// Migraciones versionadas: orden, checksum, transacción por migración, candado y equivalencia con el esquema viejo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('./soporte/servidor');
const { migrar, leerMigraciones, checksum } = require('../src/migraciones');

const opts = { skip: S.SIN_BASE };
const ESQUEMAS = ['mig_vacio_test', 'mig_viejo_test', 'mig_orden_test', 'mig_falla_test', 'mig_conc_test', 'mig_cambio_test'];
const carpetas = [];

async function borrarEsquemas() {
  for (const e of ESQUEMAS) await S.db().query(`DROP SCHEMA IF EXISTS ${e} CASCADE`);
}
test.before(async () => { if (!S.SIN_BASE) { await S.prepararEsquema(); await borrarEsquemas(); } });
test.after(async () => {
  for (const c of carpetas) fs.rmSync(c, { recursive: true, force: true });
  if (!S.SIN_BASE) { await borrarEsquemas(); await S.limpiar(); }
});

// Huella del esquema: columnas, restricciones e índices (sin la tabla de control schema_migrations).
async function huella(esquema) {
  const c = await S.db().connect();
  try {
    await c.query(`SET search_path TO ${esquema}`);
    const columnas = (await c.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position
       FROM information_schema.columns WHERE table_schema = $1 AND table_name <> 'schema_migrations'
       ORDER BY table_name, ordinal_position`, [esquema])).rows;
    const restricciones = (await c.query(
      `SELECT cl.relname AS tabla, co.contype, pg_get_constraintdef(co.oid) AS def
       FROM pg_constraint co JOIN pg_class cl ON cl.oid = co.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
       WHERE n.nspname = $1 AND cl.relname <> 'schema_migrations' ORDER BY 1, 2, 3`, [esquema])).rows;
    const indices = (await c.query(
      `SELECT tablename, regexp_replace(indexdef, $2, '', 'g') AS def FROM pg_indexes
       WHERE schemaname = $1 AND tablename <> 'schema_migrations' ORDER BY 1, 2`, [esquema, `${esquema}\\.`])).rows;
    return { columnas, restricciones, indices };
  } finally { c.release(); }
}

function carpetaTemporal(archivos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  carpetas.push(dir);
  for (const [n, sql] of Object.entries(archivos)) fs.writeFileSync(path.join(dir, n), sql);
  return dir;
}

test('las migraciones del repositorio tienen nombres válidos, números seguidos y checksum estable', () => {
  const ms = leerMigraciones();
  assert.ok(ms.length >= 2);
  ms.forEach((m, i) => assert.equal(m.version, String(i + 1).padStart(3, '0')));
  assert.equal(checksum('a\r\nb'), checksum('a\nb')); // mismo resultado en Windows y Linux
});

test('base vacía y base con el esquema viejo (Ola 1) quedan exactamente iguales', opts, async () => {
  const db = S.db();
  // Base "de producción": ya tiene el esquema viejo (schema.sql de la Ola 1), con datos, y nunca vio migraciones.
  await db.query('CREATE SCHEMA mig_viejo_test');
  const c = await db.connect();
  try {
    await c.query('SET search_path TO mig_viejo_test');
    await c.query(fs.readFileSync(path.join(__dirname, 'soporte', 'esquema-ola1.sql'), 'utf8'));
    await c.query("INSERT INTO empresas (nombre, subdominio) VALUES ('Vieja', 'vieja')");
    await c.query("INSERT INTO usuarios (empresa_id, usuario, password_hash) SELECT id, 'u', 'hash' FROM empresas");
  } finally { c.release(); }

  const rVacia = await migrar(db, { esquema: 'mig_vacio_test' });
  const rVieja = await migrar(db, { esquema: 'mig_viejo_test' });
  assert.deepEqual(rVacia.aplicadas, rVieja.aplicadas);
  assert.deepEqual(await huella('mig_vacio_test'), await huella('mig_viejo_test'));

  // Los datos de la base vieja siguen intactos y reciben el valor inicial de token_version.
  const filas = (await db.query('SELECT e.nombre, u.usuario, u.password_hash, u.token_version FROM mig_viejo_test.empresas e JOIN mig_viejo_test.usuarios u ON u.empresa_id = e.id')).rows;
  assert.deepEqual(filas, [{ nombre: 'Vieja', usuario: 'u', password_hash: 'hash', token_version: 0 }]);
});

test('volver a migrar no hace nada y schema_migrations guarda versión, nombre y checksum', opts, async () => {
  const r = await migrar(S.db(), { esquema: 'mig_vacio_test' });
  assert.deepEqual(r.aplicadas, []);
  const reg = (await S.db().query('SELECT version, nombre, checksum FROM mig_vacio_test.schema_migrations ORDER BY version')).rows;
  assert.deepEqual(reg, leerMigraciones().map((m) => ({ version: m.version, nombre: m.nombre, checksum: m.checksum })));
});

test('dos arranques a la vez sobre una base nueva no chocan (candado) y aplican una sola vez', opts, async () => {
  const resultados = await Promise.all([1, 2, 3, 4].map(() => migrar(S.db(), { esquema: 'mig_conc_test' })));
  const total = resultados.reduce((n, r) => n + r.aplicadas.length, 0);
  assert.equal(total, leerMigraciones().length);
  const n = (await S.db().query('SELECT count(*)::int AS n FROM mig_conc_test.schema_migrations')).rows[0].n;
  assert.equal(n, leerMigraciones().length);
});

test('una migración que falla se deshace por completo y no se registra; las anteriores quedan', opts, async () => {
  const dir = carpetaTemporal({
    '001_ok.sql': 'CREATE TABLE ok_t (id int);',
    '002_mala.sql': 'CREATE TABLE a_medias (id int); INSERT INTO tabla_que_no_existe VALUES (1);'
  });
  await assert.rejects(migrar(S.db(), { esquema: 'mig_falla_test', carpeta: dir }), /002_mala\.sql/);
  const tablas = (await S.db().query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'mig_falla_test' ORDER BY 1")).rows.map((r) => r.table_name);
  assert.deepEqual(tablas, ['ok_t', 'schema_migrations']); // a_medias no quedó
  const reg = (await S.db().query('SELECT version FROM mig_falla_test.schema_migrations')).rows.map((r) => r.version);
  assert.deepEqual(reg, ['001']);
});

test('si una migración ya aplicada cambió en disco, se detiene (checksum)', opts, async () => {
  const dir = carpetaTemporal({ '001_a.sql': 'CREATE TABLE c_t (id int);' });
  await migrar(S.db(), { esquema: 'mig_cambio_test', carpeta: dir });
  fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE c_t (id int, extra int);');
  await assert.rejects(migrar(S.db(), { esquema: 'mig_cambio_test', carpeta: dir }), /cambió después de aplicarse/);
});

test('una migración pendiente con número menor que la última aplicada se rechaza (fuera de orden)', opts, async () => {
  const dir = carpetaTemporal({ '001_a.sql': 'CREATE TABLE o1 (id int);', '003_c.sql': 'CREATE TABLE o3 (id int);' });
  await migrar(S.db(), { esquema: 'mig_orden_test', carpeta: dir });
  fs.writeFileSync(path.join(dir, '002_b.sql'), 'CREATE TABLE o2 (id int);');
  await assert.rejects(migrar(S.db(), { esquema: 'mig_orden_test', carpeta: dir }), /fuera de orden/);
});

test('nombres inválidos, números repetidos y esquemas inválidos se rechazan', opts, async () => {
  assert.throws(() => leerMigraciones(carpetaTemporal({ 'schema.sql': 'SELECT 1;' })), /Nombre de migración inválido/);
  assert.throws(() => leerMigraciones(carpetaTemporal({ '001_a.sql': 'SELECT 1;', '001_b.sql': 'SELECT 1;' })), /dos migraciones con el número 001/);
  await assert.rejects(migrar(S.db(), { esquema: 'mal; DROP TABLE x' }), /DB_SCHEMA/);
});
