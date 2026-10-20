// Aplica las migraciones pendientes de db/migrations contra la base de DATABASE_URL.
// Uso: npm run migrate   (el servidor también lo hace solo al arrancar)
require('dotenv').config();
const { Pool } = require('pg');
const { migrar } = require('../src/migraciones');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Falta la variable de entorno DATABASE_URL. Revisa tu archivo .env');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });
  try {
    const r = await migrar(pool, { log: console.log });
    console.log(r.aplicadas.length
      ? `Listo. ${r.aplicadas.length} migración(es) aplicada(s).`
      : 'Listo. La base ya estaba al día.');
  } catch (err) {
    console.error('Error aplicando las migraciones:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
