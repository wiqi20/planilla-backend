const express = require('express');
const router = express.Router();
const db = require('../db');
const asyncHandler = require('../utils/asyncHandler');

// Límite generoso pero acotado para la imagen de la boleta firmada (base64 en texto).
// ~2,000,000 caracteres de base64 ≈ 1.5 MB de imagen real.
const MAX_FIRMA_LENGTH = 2_000_000;

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

// domingo = 0 en JS Date; lunes a sábado son días laborales para este calendario.
function esDomingo(fechaISO) {
  return new Date(fechaISO + 'T00:00:00').getDay() === 0;
}

function contarDiasLaborables(inicioISO, finISO) {
  let cuenta = 0;
  const actual = new Date(inicioISO + 'T00:00:00');
  const fin = new Date(finISO + 'T00:00:00');
  while (actual <= fin) {
    if (actual.getDay() !== 0) cuenta++;
    actual.setDate(actual.getDate() + 1);
  }
  return cuenta;
}

function validarDatos(body, empleado, diasVacacionesPrevios) {
  const diasDisfrutar = Number(body.diasDisfrutar);
  const { periodoInicio, periodoFin } = body;
  if (!periodoInicio || !periodoFin) return 'Faltan las fechas del rango a disfrutar';
  if (periodoFin < periodoInicio) return 'El rango de fechas no es válido';
  if (periodoInicio < hoyISO()) return 'El rango de fechas a disfrutar no puede ser anterior a la fecha actual';
  if (esDomingo(periodoInicio) || esDomingo(periodoFin)) {
    return 'El período a disfrutar solo puede iniciar y terminar en un día laboral (lunes a sábado)';
  }
  if (!diasDisfrutar || diasDisfrutar <= 0) return 'Indica la cantidad de días a disfrutar';
  if (!Number.isInteger(diasDisfrutar)) return 'La cantidad de días a disfrutar debe ser un número entero de días completos';

  const saldoEfectivo = Number(empleado.vacaciones_disponibles) + (diasVacacionesPrevios || 0);
  if (diasDisfrutar > saldoEfectivo) {
    return 'El colaborador solo tiene ' + saldoEfectivo + ' día(s) de vacaciones disponibles';
  }

  const diasLaborables = contarDiasLaborables(periodoInicio, periodoFin);
  if (diasLaborables > diasDisfrutar) {
    return 'El rango de fechas seleccionado tiene ' + diasLaborables + ' día(s) laborable(s) (lunes a sábado), ' +
      'lo cual excede los ' + diasDisfrutar + ' día(s) a disfrutar indicados';
  }
  return null;
}

// POST /api/boletas/generar
// Descuenta los días de vacaciones del saldo del colaborador, igual que hace
// una colilla de pago con su campo diasVacaciones.
router.post('/generar', asyncHandler(async (req, res) => {
  const { empleadoId, diasDisfrutar, periodoInicio, periodoFin } = req.body || {};
  if (!empleadoId) return res.status(400).json({ error: 'Falta empleadoId' });

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

    const errorValidacion = validarDatos(req.body, empleado, 0);
    if (errorValidacion) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: errorValidacion });
    }

    await client.query(
      'UPDATE empleados SET vacaciones_disponibles = vacaciones_disponibles - $1, actualizado_en = now() WHERE id = $2',
      [Number(diasDisfrutar), empleado.id]
    );

    const fechaGeneracion = hoyISO();
    const result = await client.query(
      `INSERT INTO boletas_vacaciones
         (empresa_id, empleado_id, dias_disfrutar, periodo_inicio, periodo_fin, fecha_generacion, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.empresaId, empleado.id, Number(diasDisfrutar), periodoInicio, periodoFin, fechaGeneracion, req.usuarioNombre || null]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...result.rows[0], empleado_nombre: empleado.nombre, empleado_correo: empleado.correo });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo generar la boleta' });
  } finally {
    client.release();
  }
}));

// GET /api/boletas?empleadoId=&periodoInicio=&periodoFin=
router.get('/', asyncHandler(async (req, res) => {
  const { periodoInicio, periodoFin, empleadoId } = req.query;
  const condiciones = ['b.empresa_id = $1'];
  const valores = [req.empresaId];

  if (periodoInicio) { valores.push(periodoInicio); condiciones.push('b.periodo_fin >= $' + valores.length); }
  if (periodoFin) { valores.push(periodoFin); condiciones.push('b.periodo_inicio <= $' + valores.length); }
  if (empleadoId) { valores.push(empleadoId); condiciones.push('b.empleado_id = $' + valores.length); }

  // No se incluye la imagen de firma aquí (puede pesar varios cientos de KB en
  // base64 cada una): el listado solo indica si existe, y se pide aparte
  // (GET /api/boletas/:id/firma) solo cuando de verdad se necesita mostrarla.
  const result = await db.query(
    `SELECT b.id, b.empresa_id, b.empleado_id, b.dias_disfrutar, b.periodo_inicio, b.periodo_fin,
            b.fecha_generacion, b.creado_por, b.actualizado_por, b.creado_en, b.actualizado_en,
            (b.firma_imagen IS NOT NULL) AS tiene_firma,
            e.nombre AS empleado_nombre, e.correo AS empleado_correo
     FROM boletas_vacaciones b JOIN empleados e ON e.id = b.empleado_id
     WHERE ${condiciones.join(' AND ')}
     ORDER BY b.periodo_inicio DESC, e.nombre ASC`,
    valores
  );
  res.json(result.rows);
}));

// GET /api/boletas/:id/firma -> la imagen completa, solo cuando se necesita ver/imprimir una boleta puntual
router.get('/:id/firma', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    'SELECT firma_imagen FROM boletas_vacaciones WHERE id = $1 AND empresa_id = $2',
    [id, req.empresaId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Boleta no encontrada' });
  res.json({ firmaImagen: result.rows[0].firma_imagen });
}));

// PUT /api/boletas/:id
// Corrige una boleta ya guardada. Los días de vacaciones ya descontados por la
// boleta original se restauran temporalmente para validar y aplicar solo la
// diferencia contra el saldo del colaborador (mismo patrón que colillas/guardar).
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { diasDisfrutar, periodoInicio, periodoFin } = req.body || {};

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const boletaResult = await client.query(
      'SELECT * FROM boletas_vacaciones WHERE id = $1 AND empresa_id = $2',
      [id, req.empresaId]
    );
    const boleta = boletaResult.rows[0];
    if (!boleta) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Boleta no encontrada' });
    }

    const empleadoResult = await client.query(
      'SELECT * FROM empleados WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
      [boleta.empleado_id, req.empresaId]
    );
    const empleado = empleadoResult.rows[0];
    if (!empleado) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Colaborador no encontrado' });
    }

    const diasVacacionesPrevios = Number(boleta.dias_disfrutar) || 0;
    const errorValidacion = validarDatos(req.body, empleado, diasVacacionesPrevios);
    if (errorValidacion) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: errorValidacion });
    }

    const delta = Number(diasDisfrutar) - diasVacacionesPrevios;
    if (delta !== 0) {
      await client.query(
        'UPDATE empleados SET vacaciones_disponibles = vacaciones_disponibles - $1, actualizado_en = now() WHERE id = $2',
        [delta, empleado.id]
      );
    }

    const result = await client.query(
      `UPDATE boletas_vacaciones
       SET dias_disfrutar = $1, periodo_inicio = $2, periodo_fin = $3,
           actualizado_por = $4, actualizado_en = now()
       WHERE id = $5
       RETURNING *`,
      [Number(diasDisfrutar), periodoInicio, periodoFin, req.usuarioNombre || null, id]
    );

    await client.query('COMMIT');
    res.json({ ...result.rows[0], empleado_nombre: empleado.nombre, empleado_correo: empleado.correo });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la boleta' });
  } finally {
    client.release();
  }
}));

// PUT /api/boletas/:id/firma
// Adjunta (o reemplaza) la imagen de la boleta ya firmada, como comprobante.
// No afecta fechas/días/saldo: es solo evidencia de firma.
router.put('/:id/firma', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { firmaImagen } = req.body || {};
  if (!firmaImagen || typeof firmaImagen !== 'string') {
    return res.status(400).json({ error: 'Falta la imagen de la boleta firmada' });
  }
  if (firmaImagen.length > MAX_FIRMA_LENGTH) {
    return res.status(400).json({ error: 'La imagen es demasiado grande. Usa una foto más comprimida (menos de ~1.5 MB).' });
  }
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(firmaImagen)) {
    return res.status(400).json({ error: 'Formato de imagen no soportado. Usa PNG, JPG o WEBP.' });
  }

  const boletaResult = await db.query(
    'SELECT b.*, e.nombre AS empleado_nombre, e.correo AS empleado_correo FROM boletas_vacaciones b JOIN empleados e ON e.id = b.empleado_id WHERE b.id = $1 AND b.empresa_id = $2',
    [id, req.empresaId]
  );
  const boleta = boletaResult.rows[0];
  if (!boleta) return res.status(404).json({ error: 'Boleta no encontrada' });

  const result = await db.query(
    `UPDATE boletas_vacaciones
     SET firma_imagen = $1, actualizado_por = $2, actualizado_en = now()
     WHERE id = $3
     RETURNING *`,
    [firmaImagen, req.usuarioNombre || null, id]
  );
  res.json({ ...result.rows[0], empleado_nombre: boleta.empleado_nombre, empleado_correo: boleta.empleado_correo });
}));

module.exports = router;
