const express = require('express');
const router = express.Router();
const db = require('../db');
const asyncHandler = require('../utils/asyncHandler');

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function validarDatos(body, empleado) {
  const diasDisfrutar = Number(body.diasDisfrutar);
  const { periodoInicio, periodoFin } = body;
  if (!periodoInicio || !periodoFin) return 'Faltan las fechas del rango a disfrutar';
  if (periodoFin < periodoInicio) return 'El rango de fechas no es válido';
  if (periodoInicio < hoyISO()) return 'El rango de fechas a disfrutar no puede ser anterior a la fecha actual';
  if (!diasDisfrutar || diasDisfrutar <= 0) return 'Indica la cantidad de días a disfrutar';
  if (diasDisfrutar > Number(empleado.vacaciones_disponibles)) {
    return 'El colaborador solo tiene ' + empleado.vacaciones_disponibles + ' día(s) de vacaciones disponibles';
  }
  return null;
}

// POST /api/boletas/generar
router.post('/generar', asyncHandler(async (req, res) => {
  const { empleadoId, diasDisfrutar, periodoInicio, periodoFin } = req.body || {};
  if (!empleadoId) return res.status(400).json({ error: 'Falta empleadoId' });

  const empleadoResult = await db.query(
    'SELECT * FROM empleados WHERE id = $1 AND empresa_id = $2',
    [empleadoId, req.empresaId]
  );
  const empleado = empleadoResult.rows[0];
  if (!empleado) return res.status(404).json({ error: 'Colaborador no encontrado' });

  const errorValidacion = validarDatos(req.body, empleado);
  if (errorValidacion) return res.status(400).json({ error: errorValidacion });

  const fechaGeneracion = hoyISO();
  const result = await db.query(
    `INSERT INTO boletas_vacaciones
       (empresa_id, empleado_id, dias_disfrutar, periodo_inicio, periodo_fin, fecha_generacion, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [req.empresaId, empleado.id, Number(diasDisfrutar), periodoInicio, periodoFin, fechaGeneracion, req.usuarioNombre || null]
  );
  res.status(201).json({ ...result.rows[0], empleado_nombre: empleado.nombre, empleado_correo: empleado.correo });
}));

// GET /api/boletas?empleadoId=&periodoInicio=&periodoFin=
router.get('/', asyncHandler(async (req, res) => {
  const { periodoInicio, periodoFin, empleadoId } = req.query;
  const condiciones = ['b.empresa_id = $1'];
  const valores = [req.empresaId];

  if (periodoInicio) { valores.push(periodoInicio); condiciones.push('b.periodo_fin >= $' + valores.length); }
  if (periodoFin) { valores.push(periodoFin); condiciones.push('b.periodo_inicio <= $' + valores.length); }
  if (empleadoId) { valores.push(empleadoId); condiciones.push('b.empleado_id = $' + valores.length); }

  const result = await db.query(
    `SELECT b.*, e.nombre AS empleado_nombre, e.correo AS empleado_correo
     FROM boletas_vacaciones b JOIN empleados e ON e.id = b.empleado_id
     WHERE ${condiciones.join(' AND ')}
     ORDER BY b.periodo_inicio DESC, e.nombre ASC`,
    valores
  );
  res.json(result.rows);
}));

// PUT /api/boletas/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { diasDisfrutar, periodoInicio, periodoFin } = req.body || {};

  const boletaResult = await db.query(
    'SELECT * FROM boletas_vacaciones WHERE id = $1 AND empresa_id = $2',
    [id, req.empresaId]
  );
  const boleta = boletaResult.rows[0];
  if (!boleta) return res.status(404).json({ error: 'Boleta no encontrada' });

  const empleadoResult = await db.query(
    'SELECT * FROM empleados WHERE id = $1 AND empresa_id = $2',
    [boleta.empleado_id, req.empresaId]
  );
  const empleado = empleadoResult.rows[0];
  if (!empleado) return res.status(404).json({ error: 'Colaborador no encontrado' });

  const errorValidacion = validarDatos(req.body, empleado);
  if (errorValidacion) return res.status(400).json({ error: errorValidacion });

  const result = await db.query(
    `UPDATE boletas_vacaciones
     SET dias_disfrutar = $1, periodo_inicio = $2, periodo_fin = $3,
         actualizado_por = $4, actualizado_en = now()
     WHERE id = $5
     RETURNING *`,
    [Number(diasDisfrutar), periodoInicio, periodoFin, req.usuarioNombre || null, id]
  );
  res.json({ ...result.rows[0], empleado_nombre: empleado.nombre, empleado_correo: empleado.correo });
}));

module.exports = router;
