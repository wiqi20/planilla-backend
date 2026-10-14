const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword, verificarPassword, firmarToken } = require('../auth');
const asyncHandler = require('../utils/asyncHandler');

const { validarSubdominio } = require('../subdominios');

// POST /api/auth/registrar-empresa
// Alta de un nuevo cliente de sticr.com: crea la empresa + su primer usuario administrador.
// Desactivado por defecto: en el servicio compartido las empresas se crean solo desde
// /api/provision (después de confirmar el pago). Se puede reactivar con ALLOW_PUBLIC_REGISTRATION=true.
router.post('/registrar-empresa', asyncHandler(async (req, res) => {
  if (process.env.ALLOW_PUBLIC_REGISTRATION !== 'true') {
    return res.status(403).json({ error: 'El registro público está desactivado' });
  }
  const { nombreEmpresa, subdominio, usuario, password } = req.body || {};

  if (!nombreEmpresa || !subdominio || !usuario || !password) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }
  const subdominioNormalizado = String(subdominio).trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdominioNormalizado)) {
    return res.status(400).json({ error: 'El subdominio solo puede tener letras minúsculas, números y guiones' });
  }
  if (String(password).length < 4) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const empresaResult = await client.query(
      'INSERT INTO empresas (nombre, subdominio) VALUES ($1, $2) RETURNING id, nombre, subdominio',
      [nombreEmpresa, subdominioNormalizado]
    );
    const empresa = empresaResult.rows[0];

    const passwordHash = await hashPassword(password);
    const usuarioResult = await client.query(
      'INSERT INTO usuarios (empresa_id, usuario, password_hash) VALUES ($1, $2, $3) RETURNING id, usuario',
      [empresa.id, usuario, passwordHash]
    );
    const usuarioCreado = usuarioResult.rows[0];

    await client.query('COMMIT');

    const token = firmarToken({ empresaId: empresa.id, usuarioId: usuarioCreado.id, usuario: usuarioCreado.usuario });
    res.status(201).json({ token, empresa, usuario: usuarioCreado });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') { // unique_violation
      return res.status(409).json({ error: 'Ese subdominio ya está en uso' });
    }
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la empresa' });
  } finally {
    client.release();
  }
}));

// POST /api/auth/login
// El usuario indica en qué empresa (subdominio) quiere entrar, junto a sus credenciales.
router.post('/login', asyncHandler(async (req, res) => {
  const { subdominio, usuario, password } = req.body || {};
  if (!subdominio || !usuario || !password) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  try {
    const empresaResult = await db.query(
      'SELECT id, nombre, subdominio, activa FROM empresas WHERE subdominio = $1',
      [String(subdominio).trim().toLowerCase()]
    );
    const empresa = empresaResult.rows[0];
    if (!empresa) {
      return res.status(401).json({ error: 'Empresa, usuario o contraseña incorrectos' });
    }
    if (!empresa.activa) {
      return res.status(403).json({ error: 'Esta cuenta está suspendida. Contacta a STI para reactivarla.', codigo: 'suspendida' });
    }

    const usuarioResult = await db.query(
      'SELECT id, usuario, password_hash FROM usuarios WHERE empresa_id = $1 AND lower(usuario) = lower($2)',
      [empresa.id, usuario]
    );
    const usuarioFila = usuarioResult.rows[0];
    if (!usuarioFila) {
      return res.status(401).json({ error: 'Empresa, usuario o contraseña incorrectos' });
    }

    const passwordOk = await verificarPassword(password, usuarioFila.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Empresa, usuario o contraseña incorrectos' });
    }

    const token = firmarToken({ empresaId: empresa.id, usuarioId: usuarioFila.id, usuario: usuarioFila.usuario });
    delete empresa.activa;
    res.json({ token, empresa, usuario: { id: usuarioFila.id, usuario: usuarioFila.usuario } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno al iniciar sesión' });
  }
}));

// GET /api/auth/subdominio-disponible?valor=cliente1
router.get('/subdominio-disponible', asyncHandler(async (req, res) => {
  const revision = validarSubdominio(req.query.valor);
  if (!revision.ok) return res.json({ disponible: false, motivo: revision.motivo });
  const valor = revision.valor;
  const result = await db.query('SELECT 1 FROM empresas WHERE subdominio = $1', [valor]);
  res.json({ disponible: result.rows.length === 0 });
}));

module.exports = router;
