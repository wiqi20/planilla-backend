const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword } = require('../auth');
const { validarSubdominio } = require('../subdominios');
const { reiniciarDemo } = require('../demo');
const asyncHandler = require('../utils/asyncHandler');

// Estas rutas las llama el sitio sticr.app cuando alguien paga, cancela o termina de configurar
// su cuenta. No llevan usuario: se protegen con una clave compartida (PROVISION_SECRET).
function requireProvisionSecret(req, res, next) {
  const esperado = process.env.PROVISION_SECRET;
  if (!esperado || esperado.length < 24) {
    return res.status(503).json({ error: 'El aprovisionamiento no está configurado' });
  }
  const recibido = String(req.headers['x-provision-secret'] || '');
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  next();
}
router.use(requireProvisionSecret);

// GET /api/provision/subdominio-disponible?valor=minegocio
router.get('/subdominio-disponible', asyncHandler(async (req, res) => {
  const revision = validarSubdominio(req.query.valor);
  if (!revision.ok) return res.json({ disponible: false, motivo: revision.motivo });
  const existe = await db.query('SELECT 1 FROM empresas WHERE subdominio = $1', [revision.valor]);
  res.json({ disponible: existe.rows.length === 0, valor: revision.valor });
}));

// POST /api/provision/empresa { nombreEmpresa, subdominio, stripeSubscriptionId }
// Crea la empresa del cliente que acaba de pagar (todavía sin usuario). Se puede repetir sin
// duplicar: Stripe reenvía avisos, y la misma suscripción siempre da la misma empresa.
router.post('/empresa', asyncHandler(async (req, res) => {
  const { nombreEmpresa, subdominio, stripeSubscriptionId } = req.body || {};
  if ([nombreEmpresa, stripeSubscriptionId].some((v) => typeof v !== 'string')) {
    return res.status(400).json({ error: 'Faltan nombreEmpresa o stripeSubscriptionId' });
  }
  const nombre = String(nombreEmpresa || '').trim();
  const subscription = String(stripeSubscriptionId || '').trim();
  const revision = validarSubdominio(subdominio);
  if (nombre.length < 2 || nombre.length > 120 || !subscription) {
    return res.status(400).json({ error: 'Faltan nombreEmpresa o stripeSubscriptionId' });
  }
  if (!revision.ok) return res.status(400).json({ error: revision.motivo });

  const buscar = () => db.query(
    'SELECT id, nombre, subdominio, activa FROM empresas WHERE stripe_subscription_id = $1',
    [subscription]
  );

  const previa = await buscar();
  if (previa.rows[0]) return res.json({ empresa: previa.rows[0], creada: false });

  const ocupado = await db.query('SELECT 1 FROM empresas WHERE subdominio = $1', [revision.valor]);
  if (ocupado.rows.length > 0) return res.status(409).json({ error: 'Ese subdominio ya está en uso' });

  try {
    const result = await db.query(
      `INSERT INTO empresas (nombre, subdominio, stripe_subscription_id)
       VALUES ($1, $2, $3) RETURNING id, nombre, subdominio, activa`,
      [nombre, revision.valor, subscription]
    );
    res.status(201).json({ empresa: result.rows[0], creada: true });
  } catch (err) {
    if (err.code === '23505') {
      const otra = await buscar(); // dos avisos a la vez para la misma suscripción
      if (otra.rows[0]) return res.json({ empresa: otra.rows[0], creada: false });
      return res.status(409).json({ error: 'Ese subdominio ya está en uso' });
    }
    throw err;
  }
}));

// POST /api/provision/admin { subdominio, stripeSubscriptionId, usuario, password }
// Crea el primer administrador de la empresa. Solo funciona una vez: si ya hay usuarios, responde 409.
router.post('/admin', asyncHandler(async (req, res) => {
  const { subdominio, stripeSubscriptionId, usuario, password } = req.body || {};
  if ([subdominio, stripeSubscriptionId, usuario, password].some((v) => typeof v !== 'string')) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }
  const nombreUsuario = String(usuario || '').trim();
  if (!subdominio || !stripeSubscriptionId || !nombreUsuario || !password) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }
  if (nombreUsuario.length < 3 || nombreUsuario.length > 40) {
    return res.status(400).json({ error: 'El usuario debe tener entre 3 y 40 caracteres' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  const passwordHash = await hashPassword(password);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const empresaResult = await client.query(
      'SELECT id, nombre, subdominio FROM empresas WHERE subdominio = $1 AND stripe_subscription_id = $2 FOR UPDATE',
      [String(subdominio).trim().toLowerCase(), String(stripeSubscriptionId).trim()]
    );
    const empresa = empresaResult.rows[0];
    if (!empresa) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }
    const usuarios = await client.query('SELECT 1 FROM usuarios WHERE empresa_id = $1 LIMIT 1', [empresa.id]);
    if (usuarios.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Esta cuenta ya fue configurada', codigo: 'ya-configurada' });
    }
    await client.query(
      'INSERT INTO usuarios (empresa_id, usuario, password_hash) VALUES ($1, $2, $3)',
      [empresa.id, nombreUsuario, passwordHash]
    );
    await client.query('COMMIT');
    res.status(201).json({ empresa });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

// POST /api/provision/estado { stripeSubscriptionId, activa }
// Suspende o reactiva la empresa según el estado de su suscripción. No borra ningún dato.
router.post('/estado', asyncHandler(async (req, res) => {
  const { stripeSubscriptionId, activa } = req.body || {};
  if (!stripeSubscriptionId || typeof activa !== 'boolean') {
    return res.status(400).json({ error: 'Faltan stripeSubscriptionId o activa (true/false)' });
  }
  const result = await db.query(
    'UPDATE empresas SET activa = $1 WHERE stripe_subscription_id = $2 RETURNING id, subdominio, activa',
    [activa, String(stripeSubscriptionId)]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'No hay una empresa para esa suscripción' });
  res.json({ empresa: result.rows[0] });
}));

// POST /api/provision/demo/reiniciar
router.post('/demo/reiniciar', asyncHandler(async (req, res) => {
  await reiniciarDemo();
  res.json({ ok: true });
}));

module.exports = router;
