// Ejecutor de migraciones versionadas.
//  - Archivos db/migrations/NNN_nombre.sql, en orden numérico.
//  - Tabla schema_migrations: versión, nombre, checksum (sha256) y fecha de cada una aplicada.
//  - Cada migración corre en su propia transacción: o se aplica completa y se registra, o no queda nada.
//  - Un candado de la base (pg_advisory_lock) evita que dos instancias migren a la vez.
//  - Si una migración ya aplicada cambió en disco (checksum distinto), o hay una pendiente con número
//    menor que la última aplicada, se detiene con un error: nadie edita el pasado ni aplica fuera de orden.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CARPETA = path.join(__dirname, '..', 'db', 'migrations');
const NOMBRE_VALIDO = /^(\d{3})_([a-z0-9_]+)\.sql$/;
const CANDADO = 727_001; // número arbitrario, propio de este servicio
const ESQUEMA_VALIDO = /^[a-z_][a-z0-9_]{0,40}$/;

function checksum(texto) {
  // Se normaliza el fin de línea para que el mismo archivo dé el mismo resultado en Windows y en Linux.
  return crypto.createHash('sha256').update(texto.replace(/\r\n/g, '\n')).digest('hex');
}

// Lee y valida la carpeta de migraciones. Devuelve [{ version, nombre, archivo, sql, checksum }] ordenado.
function leerMigraciones(carpeta = CARPETA) {
  const archivos = fs.readdirSync(carpeta).filter((f) => f.endsWith('.sql')).sort();
  const vistas = new Set();
  return archivos.map((archivo) => {
    const m = NOMBRE_VALIDO.exec(archivo);
    if (!m) throw new Error(`Nombre de migración inválido: "${archivo}" (debe ser NNN_nombre.sql, en minúsculas)`);
    if (vistas.has(m[1])) throw new Error(`Hay dos migraciones con el número ${m[1]}`);
    vistas.add(m[1]);
    const sql = fs.readFileSync(path.join(carpeta, archivo), 'utf8');
    return { version: m[1], nombre: m[2], archivo, sql, checksum: checksum(sql) };
  });
}

// Aplica las pendientes. `pool` es un Pool de pg. Devuelve { aplicadas: [archivo...], yaAplicadas: n }.
async function migrar(pool, { esquema = process.env.DB_SCHEMA, carpeta = CARPETA, log = () => {} } = {}) {
  if (esquema && !ESQUEMA_VALIDO.test(esquema)) {
    throw new Error('DB_SCHEMA solo puede tener minúsculas, números y guion bajo.');
  }
  const migraciones = leerMigraciones(carpeta);
  const client = await pool.connect(); // una sola conexión: el candado y el search_path son de la sesión
  try {
    await client.query('SELECT pg_advisory_lock($1)', [CANDADO]);
    let rutaOriginal = null;
    try {
      if (esquema) {
        rutaOriginal = (await client.query('SHOW search_path')).rows[0].search_path;
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${esquema}`);
        await client.query(`SET search_path TO ${esquema}`);
      }
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version     TEXT PRIMARY KEY,
        nombre      TEXT NOT NULL,
        checksum    TEXT NOT NULL,
        aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      const previas = new Map((await client.query('SELECT version, nombre, checksum FROM schema_migrations')).rows
        .map((r) => [r.version, r]));

      // Las ya aplicadas deben seguir existiendo y no haber cambiado.
      for (const [version, fila] of previas) {
        const local = migraciones.find((m) => m.version === version);
        if (!local) throw new Error(`La base tiene aplicada la migración ${version}_${fila.nombre} que no existe en db/migrations`);
        if (local.checksum !== fila.checksum) {
          throw new Error(`La migración ${local.archivo} cambió después de aplicarse (checksum distinto). No se edita una migración aplicada: crea una nueva.`);
        }
      }
      const ultima = [...previas.keys()].sort().pop() || '000';
      const pendientes = migraciones.filter((m) => !previas.has(m.version));
      const fuera = pendientes.find((m) => m.version < ultima);
      if (fuera) throw new Error(`La migración ${fuera.archivo} está pendiente pero ya se aplicó la ${ultima}: fuera de orden.`);

      const aplicadas = [];
      for (const m of pendientes) {
        try {
          await client.query('BEGIN');
          await client.query(m.sql);
          await client.query('INSERT INTO schema_migrations (version, nombre, checksum) VALUES ($1, $2, $3)',
            [m.version, m.nombre, m.checksum]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          err.message = `Falló la migración ${m.archivo}: ${err.message}`;
          throw err;
        }
        aplicadas.push(m.archivo);
        log(`Migración aplicada: ${m.archivo}`);
      }
      return { aplicadas, yaAplicadas: previas.size };
    } finally {
      // La conexión vuelve al pool: se le devuelve su search_path y se suelta el candado.
      if (rutaOriginal !== null) await client.query(`SET search_path TO ${rutaOriginal}`).catch(() => {});
      await client.query('SELECT pg_advisory_unlock($1)', [CANDADO]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

module.exports = { migrar, leerMigraciones, checksum, CARPETA };
