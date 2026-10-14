// Aplica db/schema.sql contra la base de datos apuntada por DATABASE_URL.
// Uso: npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Falta la variable de entorno DATABASE_URL. Revisa tu archivo .env');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  const schemaPath = path.join(__dirname, 'schema.sql');
  let schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const schema = process.env.DB_SCHEMA;
  if (schema) {
    if (!/^[a-z_][a-z0-9_]{0,40}$/.test(schema)) {
      console.error('DB_SCHEMA solo puede tener minúsculas, números y guion bajo.');
      process.exit(1);
    }
    schemaSql = `CREATE SCHEMA IF NOT EXISTS ${schema}; SET search_path TO ${schema};\n` + schemaSql;
  }

  console.log('Aplicando esquema desde db/schema.sql ...');
  try {
    await pool.query(schemaSql);
    console.log('Listo. Tablas creadas o ya existentes.');
  } catch (err) {
    console.error('Error aplicando el esquema:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
