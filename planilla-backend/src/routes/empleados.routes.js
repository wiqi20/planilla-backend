const express = require('express');
const router = express.Router();
const db = require('../db');
const asyncHandler = require('../utils/asyncHandler');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tieneAntiguedadMinima(fechaIngreso) {
  const inicio = new Date(fechaIngreso);
  const hoy = new Date();
  const meses = (hoy.getFullYear() - inicio.getFullYear()) * 12 + (hoy.getMonth() - inicio.getMonth());
  return meses >= 12;
}

// GET /api/empleados
router.get('/', asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT id, nombre, correo, salario, fecha_ingreso, vacaciones_disponibles, activo
     FROM empleados WHERE empresa_id = $1 ORDER BY nombre ASC`,
    [req.empresaId]
  );
  res.json(result.rows);
}));

// POST /api/empleados
router.post('/', asyncHandler(async (req, res) => {
  const { nombre, correo, salario, fechaIngreso, vacacionesDisponibles } = req.body || {};

  if (!nombre || !correo || !salario || !fechaIngreso) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }
  if (!EMAIL_REGEX.test(correo)) {
    return res.status(400).json({ error: 'El correo no tiene un formato válido' });
  }

  // Misma regla de negocio que en el cliente: sin 1 año de antigüedad no se
  // pueden asignar vacaciones base, sin importar lo que mande el request.
  const vacacionesFinal = tieneAntiguedadMinima(fechaIngreso) ? (Number(vacacionesDisponibles) || 0) : 0;

  try {
    const result = await db.query(
      `INSERT INTO empleados (empresa_id, nombre, correo, salario, fecha_ingreso, vacaciones_disponibles)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre, correo, salario, fecha_ingreso, vacaciones_disponibles, activo`,
      [req.empresaId, nombre, correo.toLowerCase(), salario, fechaIngreso, vacacionesFinal]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un colaborador con ese correo' });
    }
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el colaborador' });
  }
}));

// PUT /api/empleados/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nombre, correo, salario, fechaIngreso, vacacionesDisponibles, activo } = req.body || {};

  if (correo && !EMAIL_REGEX.test(correo)) {
    return res.status(400).json({ error: 'El correo no tiene un formato válido' });
  }

  const existente = await db.query(
    'SELECT * FROM empleados WHERE id = $1 AND empresa_id = $2',
    [id, req.empresaId]
  );
  if (existente.rows.length === 0) {
    return res.status(404).json({ error: 'Colaborador no encontrado' });
  }

  const actual = existente.rows[0];
  const nuevaFecha = fechaIngreso || actual.fecha_ingreso;
  const vacacionesFinal = tieneAntiguedadMinima(nuevaFecha)
    ? (vacacionesDisponibles !== undefined ? Number(vacacionesDisponibles) : actual.vacaciones_disponibles)
    : 0;

  try {
    const result = await db.query(
      `UPDATE empleados SET
         nombre = COALESCE($1, nombre),
         correo = COALESCE($2, correo),
         salario = COALESCE($3, salario),
         fecha_ingreso = COALESCE($4, fecha_ingreso),
         vacaciones_disponibles = $5,
         activo = COALESCE($6, activo),
         actualizado_en = now()
       WHERE id = $7 AND empresa_id = $8
       RETURNING id, nombre, correo, salario, fecha_ingreso, vacaciones_disponibles, activo`,
      [nombre, correo ? correo.toLowerCase() : null, salario, fechaIngreso, vacacionesFinal, activo, id, req.empresaId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un colaborador con ese correo' });
    }
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el colaborador' });
  }
}));

// DELETE /api/empleados/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    'DELETE FROM empleados WHERE id = $1 AND empresa_id = $2 RETURNING id',
    [id, req.empresaId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Colaborador no encontrado' });
  }
  res.status(204).send();
}));

module.exports = router;
