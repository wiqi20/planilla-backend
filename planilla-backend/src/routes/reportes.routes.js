const express = require('express');
const router = express.Router();
const db = require('../db');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/reportes/generar { periodoInicio, periodoFin }
// Arma el reporte a partir de las colillas YA GUARDADAS de ese período exacto,
// igual que hace el frontend: nunca se calculan montos nuevos aquí.
router.post('/generar', asyncHandler(async (req, res) => {
  const { periodoInicio, periodoFin } = req.body || {};
  if (!periodoInicio || !periodoFin) {
    return res.status(400).json({ error: 'Faltan periodoInicio o periodoFin' });
  }

  const empleadosResult = await db.query(
    'SELECT id, nombre, correo FROM empleados WHERE empresa_id = $1 AND activo = true ORDER BY nombre ASC',
    [req.empresaId]
  );
  const empleados = empleadosResult.rows;

  const colillasResult = await db.query(
    `SELECT empleado_id, datos FROM colillas
     WHERE empresa_id = $1 AND periodo_inicio = $2 AND periodo_fin = $3`,
    [req.empresaId, periodoInicio, periodoFin]
  );
  const colillasPorEmpleado = new Map(colillasResult.rows.map(r => [r.empleado_id, r.datos]));

  const filas = [];
  const faltantes = [];
  empleados.forEach(emp => {
    const datos = colillasPorEmpleado.get(emp.id);
    if (datos) {
      filas.push({ empleadoId: emp.id, nombre: emp.nombre, correo: emp.correo, ...datos });
    } else {
      faltantes.push(emp.nombre);
    }
  });

  if (filas.length === 0) {
    return res.status(404).json({
      error: 'No hay ninguna colilla guardada todavía para ese período exacto',
      faltantes
    });
  }

  const totales = filas.reduce((acc, f) => {
    acc.totBruto += Number(f.brutoQuincenal) || 0;
    acc.totCcss += Number(f.ccss) || 0;
    acc.totRenta += Number(f.renta) || 0;
    acc.totNeto += Number(f.neto) || 0;
    return acc;
  }, { totBruto: 0, totCcss: 0, totRenta: 0, totNeto: 0 });

  const datosReporte = { filas, totales, faltantes };

  const guardado = await db.query(
    `INSERT INTO reportes (empresa_id, periodo_inicio, periodo_fin, datos)
     VALUES ($1, $2, $3, $4)
     RETURNING id, periodo_inicio, periodo_fin, datos, creado_en`,
    [req.empresaId, periodoInicio, periodoFin, JSON.stringify(datosReporte)]
  );

  res.status(201).json(guardado.rows[0]);
}));

// GET /api/reportes  -> historial de reportes generados
router.get('/', asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT id, periodo_inicio, periodo_fin, datos, creado_en
     FROM reportes WHERE empresa_id = $1
     ORDER BY periodo_inicio DESC, creado_en DESC`,
    [req.empresaId]
  );
  res.json(result.rows);
}));

module.exports = router;
