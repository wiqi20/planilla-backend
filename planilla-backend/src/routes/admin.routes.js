const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword } = require('../auth');
const asyncHandler = require('../utils/asyncHandler');
const { idDeRuta } = require('../validacion');

// Contraseña mínima al CREAR o CAMBIAR. Quien ya tiene una más corta puede seguir entrando (el login no la revisa).
const PASSWORD_MIN = 8;

// En la empresa demo (pública) nadie puede cambiar usuarios ni datos de la empresa:
// así un visitante no puede dejar a los demás fuera. Todo se restablece solo cada cierto tiempo.
function bloquearEnDemo(req, res, next) {
  if (req.esDemo && req.method !== 'GET') {
    return res.status(403).json({ error: 'Esta acción no está disponible en la demo.' });
  }
  next();
}
router.use('/usuarios', bloquearEnDemo);
router.use('/empresa', bloquearEnDemo);

// ---------- Configuración de la empresa ----------

// GET /api/admin/empresa
router.get('/empresa', asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT id, nombre, subdominio, correo_admin FROM empresas WHERE id = $1',
    [req.empresaId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Empresa no encontrada' });
  res.json(result.rows[0]);
}));

// PUT /api/admin/empresa { nombre, correoAdmin }
router.put('/empresa', asyncHandler(async (req, res) => {
  const { nombre, correoAdmin } = req.body || {};
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if ((nombre !== undefined && nombre !== null && (typeof nombre !== 'string' || nombre.length > 120)) ||
      (correoAdmin !== undefined && correoAdmin !== null && (typeof correoAdmin !== 'string' || correoAdmin.length > 254))) {
    return res.status(400).json({ error: 'El nombre y el correo deben ser texto de largo razonable' });
  }
  if (correoAdmin && !EMAIL_REGEX.test(correoAdmin)) {
    return res.status(400).json({ error: 'El correo administrativo no tiene un formato válido' });
  }
  const result = await db.query(
    `UPDATE empresas SET nombre = COALESCE($1, nombre), correo_admin = $2 WHERE id = $3
     RETURNING id, nombre, subdominio, correo_admin`,
    [nombre || null, correoAdmin || null, req.empresaId]
  );
  res.json(result.rows[0]);
}));

// ---------- Usuarios administradores ----------

// GET /api/admin/usuarios
router.get('/usuarios', asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT id, usuario, creado_en FROM usuarios WHERE empresa_id = $1 ORDER BY usuario ASC',
    [req.empresaId]
  );
  res.json(result.rows);
}));

// POST /api/admin/usuarios { usuario, password }
router.post('/usuarios', asyncHandler(async (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) return res.status(400).json({ error: 'Faltan usuario o password' });
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return res.status(400).json({ error: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres` });
  }
  if (typeof usuario !== 'string' || usuario.length > 40) {
    return res.status(400).json({ error: 'El usuario debe ser un texto de hasta 40 caracteres' });
  }

  try {
    const passwordHash = await hashPassword(password);
    const result = await db.query(
      `INSERT INTO usuarios (empresa_id, usuario, password_hash) VALUES ($1, $2, $3)
       RETURNING id, usuario, creado_en`,
      [req.empresaId, usuario, passwordHash]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el usuario' });
  }
}));

// PUT /api/admin/usuarios/:id { usuario, password? }
router.put('/usuarios/:id', asyncHandler(async (req, res) => {
  const id = idDeRuta(req.params.id);
  if (id === null) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { usuario, password } = req.body || {};
  if (usuario !== undefined && usuario !== null && (typeof usuario !== 'string' || usuario.length > 40)) {
    return res.status(400).json({ error: 'El usuario debe ser un texto de hasta 40 caracteres' });
  }
  if (password !== undefined && password !== null && password !== '' && (typeof password !== 'string' || password.length < PASSWORD_MIN)) {
    return res.status(400).json({ error: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres` });
  }

  try {
    let passwordHash = null;
    if (password) passwordHash = await hashPassword(password);

    const result = await db.query(
      `UPDATE usuarios SET
         usuario = COALESCE($1, usuario),
         password_hash = COALESCE($2, password_hash)
       WHERE id = $3 AND empresa_id = $4
       RETURNING id, usuario, creado_en`,
      [usuario || null, passwordHash, id, req.empresaId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el usuario' });
  }
}));

// DELETE /api/admin/usuarios/:id
router.delete('/usuarios/:id', asyncHandler(async (req, res) => {
  const id = idDeRuta(req.params.id);
  if (id === null) return res.status(404).json({ error: 'Usuario no encontrado' });

  const countResult = await db.query('SELECT COUNT(*)::int AS total FROM usuarios WHERE empresa_id = $1', [req.empresaId]);
  if (countResult.rows[0].total <= 1) {
    return res.status(400).json({ error: 'Debe existir al menos un usuario administrador' });
  }

  const result = await db.query(
    'DELETE FROM usuarios WHERE id = $1 AND empresa_id = $2 RETURNING id',
    [id, req.empresaId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.status(204).send();
}));

module.exports = router;
