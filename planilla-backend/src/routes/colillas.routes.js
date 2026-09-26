const express = require('express');
const router = express.Router();
const db = require('../db');
const { calcularPlanilla } = require('../calculo');
const asyncHandler = require('../utils/asyncHandler');

function extraerInputs(body) {
  const campos = [
    'horasExtra', 'horasSinGoce', 'diasVacaciones', 'diasSinGoceCompletos',
    'diasIncapacidad', 'diasLicenciaMP', 'diasLicenciaCuido', 'horasFeriado'
  ];
  const inputs = {};
  campos.forEach(c => { inputs[c] = Number(body[c]) || 0; });
  return inputs;
}

// POST /api/colillas/calcular
// Solo calcula y devuelve el resultado (vista previa). No guarda nada todavía,
// igual que el botón "Calcular colilla" del frontend.
router.post('/calcular', asyncHandler(async (req, res) => {
  const { empleadoId, periodoInicio, periodoFin, feriadoNombre } = req.body || {};
  if (!empleadoId || !periodoInicio || !periodoFin) {
    return res.status(400).json({ error: 'Faltan empleadoId, periodoInicio o periodoFin' });
  }

  const empleadoResult = await db.query(
    'SELECT * FROM empleados WHERE id = $1 AND empresa_id = $2',
    [empleadoId, req.empresaId]
  );
  const empleado = empleadoResult.rows[0];
  if (!empleado) return res.status(404).json({ error: 'Colaborador no encontrado' });

  const inputs = extraerInputs(req.body);

  if (inputs.diasVacaciones > Number(empleado.vacaciones_disponibles)) {
    return res.status(400).json({
      error: 'El colaborador solo tiene ' + empleado.vacaciones_disponibles + ' día(s) de vacaciones disponibles',
      vacacionesDisponibles: Number(empleado.vacaciones_disponibles)
    });
  }
  if (inputs.horasFeriado > 0 && !feriadoNombre) {
    return res.status(400).json({ error: 'Indica a cuál feriado corresponden esas horas' });
  }

  const resultado = calcularPlanilla(Number(empleado.salario), inputs);
  res.json({ empleado: { id: empleado.id, nombre: empleado.nombre, correo: empleado.correo }, inputs, feriadoNombre: feriadoNombre || '', resultado });
}));

// POST /api/colillas/guardar
// Recalcula desde cero en el servidor (nunca confía en los montos que mande el cliente),
// descuenta vacaciones si corresponde, y guarda la colilla del período.
router.post('/guardar', asyncHandler(async (req, res) => {
  const { empleadoId, periodoInicio, periodoFin, feriadoNombre } = req.body || {};
  if (!empleadoId || !periodoInicio || !periodoFin) {
    return res.status(400).json({ error: 'Faltan empleadoId, periodoInicio o periodoFin' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const empleadoResult = await client.query(
      'SELECT * FROM empleados WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
      [empleadoId, req.empresaId]
    );
    const empleado = empleadoResult.rows[0];
    if (!empleado) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Colaborador no encontrado' });
    }

    const inputs = extraerInputs(req.body);

    if (inputs.diasVacaciones > Number(empleado.vacaciones_disponibles)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El colaborador solo tiene ' + empleado.vacaciones_disponibles + ' día(s) de vacaciones disponibles' });
    }
    if (inputs.horasFeriado > 0 && !feriadoNombre) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Indica a cuál feriado corresponden esas horas' });
    }

    const resultado = calcularPlanilla(Number(empleado.salario), inputs);

    if (inputs.diasVacaciones > 0) {
      await client.query(
        'UPDATE empleados SET vacaciones_disponibles = vacaciones_disponibles - $1, actualizado_en = now() WHERE id = $2',
        [inputs.diasVacaciones, empleado.id]
      );
    }

    const datos = { ...inputs, feriadoNombre: feriadoNombre || '', ...resultado, empleadoNombre: empleado.nombre, empleadoCorreo: empleado.correo };

    // Si ya existía una colilla para este empleado+período, se sobreescribe (permite corregir errores).
    const colillaResult = await client.query(
      `INSERT INTO colillas (empresa_id, empleado_id, periodo_inicio, periodo_fin, datos)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (empleado_id, periodo_inicio, periodo_fin)
       DO UPDATE SET datos = EXCLUDED.datos, creado_en = now()
       RETURNING id, periodo_inicio, periodo_fin, datos, creado_en`,
      [req.empresaId, empleado.id, periodoInicio, periodoFin, JSON.stringify(datos)]
    );

    await client.query('COMMIT');
    res.status(201).json(colillaResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar la colilla' });
  } finally {
    client.release();
  }
}));

// GET /api/colillas?periodoInicio=...&periodoFin=...
router.get('/', asyncHandler(async (req, res) => {
  const { periodoInicio, periodoFin, empleadoId } = req.query;
  const condiciones = ['c.empresa_id = $1'];
  const valores = [req.empresaId];

  if (periodoInicio) { valores.push(periodoInicio); condiciones.push('c.periodo_inicio = $' + valores.length); }
  if (periodoFin) { valores.push(periodoFin); condiciones.push('c.periodo_fin = $' + valores.length); }
  if (empleadoId) { valores.push(empleadoId); condiciones.push('c.empleado_id = $' + valores.length); }

  const result = await db.query(
    `SELECT c.id, c.empleado_id, e.nombre AS empleado_nombre, c.periodo_inicio, c.periodo_fin, c.datos, c.creado_en
     FROM colillas c JOIN empleados e ON e.id = c.empleado_id
     WHERE ${condiciones.join(' AND ')}
     ORDER BY c.periodo_inicio DESC, e.nombre ASC`,
    valores
  );
  res.json(result.rows);
}));

module.exports = router;
