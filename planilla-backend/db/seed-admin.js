// Crea (o resetea) la empresa y el usuario administrador por defecto.
// Por defecto: subdominio "admin", usuario "Admin", contraseña "IexxI"
// (coincide con el subdominio fijo que usa el login del frontend).
// Uso:
//   node db/seed-admin.js
//   node db/seed-admin.js --subdominio=admin --usuario=Admin --password=OtraClave --nombre="Mi Empresa"
//   node db/seed-admin.js --database-url=postgresql://user:pass@host:puerto/db  (si no tienes DATABASE_URL en el entorno)
//
// Es seguro correrlo varias veces: si la empresa/usuario ya existen, solo
// actualiza la contraseña del usuario indicado en vez de duplicar filas.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

function arg(nombre, porDefecto) {
  const prefijo = `--${nombre}=`;
  const encontrado = process.argv.find((a) => a.startsWith(prefijo));
  return encontrado ? encontrado.slice(prefijo.length) : porDefecto;
}

async function main() {
  const databaseUrl = arg('database-url', process.env.DATABASE_URL);
  if (!databaseUrl) {
    console.error('Falta DATABASE_URL (o pasa --database-url=... ).');
    process.exit(1);
  }

  const subdominio = String(arg('subdominio', 'admin')).trim().toLowerCase();
  const usuario = arg('usuario', 'Admin');
  const password = arg('password', 'IexxI');
  const nombreEmpresa = arg('nombre', 'Empresa Admin');

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let empresaResult = await client.query(
      'SELECT id, nombre, subdominio FROM empresas WHERE subdominio = $1',
      [subdominio]
    );
    let empresa = empresaResult.rows[0];

    if (!empresa) {
      const insertEmpresa = await client.query(
        'INSERT INTO empresas (nombre, subdominio) VALUES ($1, $2) RETURNING id, nombre, subdominio',
        [nombreEmpresa, subdominio]
      );
      empresa = insertEmpresa.rows[0];
      console.log(`Empresa creada: ${empresa.nombre} (subdominio "${empresa.subdominio}")`);
    } else {
      console.log(`Empresa ya existía: ${empresa.nombre} (subdominio "${empresa.subdominio}")`);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const usuarioExistente = await client.query(
      'SELECT id FROM usuarios WHERE empresa_id = $1 AND lower(usuario) = lower($2)',
      [empresa.id, usuario]
    );

    if (usuarioExistente.rows[0]) {
      await client.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [
        passwordHash,
        usuarioExistente.rows[0].id
      ]);
      console.log(`Usuario "${usuario}" ya existía: contraseña actualizada.`);
    } else {
      await client.query(
        'INSERT INTO usuarios (empresa_id, usuario, password_hash) VALUES ($1, $2, $3)',
        [empresa.id, usuario, passwordHash]
      );
      console.log(`Usuario "${usuario}" creado.`);
    }

    await client.query('COMMIT');
    console.log('\nListo. Puedes iniciar sesión con:');
    console.log(`  Subdominio: ${empresa.subdominio}`);
    console.log(`  Usuario:    ${usuario}`);
    console.log(`  Contraseña: ${password}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creando el administrador por defecto:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
