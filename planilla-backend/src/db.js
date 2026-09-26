// Conexión a PostgreSQL compartida por toda la app.
// Usa DATABASE_URL (Railway, Render y la mayoría de proveedores la inyectan automáticamente).
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway/Render exigen SSL en producción pero no traen certificado propio verificable.
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
