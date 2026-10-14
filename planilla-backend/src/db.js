// Conexión a PostgreSQL compartida por toda la app.
// Usa DATABASE_URL (Railway, Render y la mayoría de proveedores la inyectan automáticamente).
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 10,
  // Railway/Render exigen SSL en producción pero no traen certificado propio verificable.
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

// Esquema propio dentro de la base (opcional). Permite que este backend comparta una base de
// datos con otro sistema sin mezclar tablas. Ej.: DB_SCHEMA=planilla
const DB_SCHEMA = process.env.DB_SCHEMA;
if (DB_SCHEMA) {
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(DB_SCHEMA)) {
    throw new Error('DB_SCHEMA solo puede tener minúsculas, números y guion bajo.');
  }
  pool.on('connect', (client) => {
    client.query(`SET search_path TO ${DB_SCHEMA}`);
  });
}

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
