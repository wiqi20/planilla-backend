// Empresa "demo": la que ve cualquier visitante desde el portafolio de sticr.app.
// Tiene datos inventados y se restablece sola, así nunca se mezcla con datos de clientes reales.
const db = require('./db');
const { hashPassword } = require('./auth');

const DEMO_SUBDOMINIO = 'demo';
const DEMO_USUARIO = 'demo';
const DEMO_PASSWORD = 'demo1234'; // pública a propósito: la demo es de acceso libre

const EMPLEADOS_DEMO = [
  { nombre: 'Ana Rodríguez Mora', correo: 'ana.rodriguez@ejemplo.cr', salario: 850000, ingreso: '2021-03-15', vacaciones: 10 },
  { nombre: 'Luis Fernández Soto', correo: 'luis.fernandez@ejemplo.cr', salario: 1200000, ingreso: '2019-08-01', vacaciones: 14 },
  { nombre: 'María Jiménez Vargas', correo: 'maria.jimenez@ejemplo.cr', salario: 650000, ingreso: '2023-01-09', vacaciones: 6 },
  { nombre: 'Carlos Solano Araya', correo: 'carlos.solano@ejemplo.cr', salario: 1850000, ingreso: '2018-05-21', vacaciones: 20 },
  { nombre: 'Daniela Castro Pérez', correo: 'daniela.castro@ejemplo.cr', salario: 520000, ingreso: '2025-06-02', vacaciones: 0 },
  { nombre: 'Jorge Villalta Núñez', correo: 'jorge.villalta@ejemplo.cr', salario: 2600000, ingreso: '2016-11-14', vacaciones: 22 },
];

// Borra la empresa demo (y todo lo que cuelga de ella) y la vuelve a crear con los datos de ejemplo.
async function reiniciarDemo() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM empresas WHERE subdominio = $1 AND es_demo = true', [DEMO_SUBDOMINIO]);
    const empresa = await client.query(
      `INSERT INTO empresas (nombre, subdominio, correo_admin, es_demo)
       VALUES ('Empresa de Ejemplo S.A.', $1, 'planilla@ejemplo.cr', true) RETURNING id`,
      [DEMO_SUBDOMINIO]
    );
    const empresaId = empresa.rows[0].id;
    await client.query(
      'INSERT INTO usuarios (empresa_id, usuario, password_hash) VALUES ($1, $2, $3)',
      [empresaId, DEMO_USUARIO, passwordHash]
    );
    for (const e of EMPLEADOS_DEMO) {
      await client.query(
        `INSERT INTO empleados (empresa_id, nombre, correo, salario, fecha_ingreso, vacaciones_disponibles)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [empresaId, e.nombre, e.correo, e.salario, e.ingreso, e.vacaciones]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Si DEMO_ENABLED=true, crea la demo al arrancar y la restablece cada DEMO_RESET_HOURS (6 por defecto).
function iniciarDemoProgramado() {
  if (process.env.DEMO_ENABLED !== 'true') return;
  const horas = Math.max(1, Number(process.env.DEMO_RESET_HOURS) || 6);
  const ejecutar = () => reiniciarDemo().then(
    () => console.log('Empresa demo restablecida.'),
    (err) => console.error('No se pudo restablecer la empresa demo:', err)
  );
  ejecutar();
  setInterval(ejecutar, horas * 3600 * 1000).unref();
}

module.exports = { reiniciarDemo, iniciarDemoProgramado, DEMO_SUBDOMINIO };
