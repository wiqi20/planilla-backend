const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword, verificarPassword, firmarToken } = require('../auth');
const asyncHandler = require('../utils/asyncHandler');

const { validarSubdominio } = require('../subdominios');
const bcrypt = require('bcryptjs');
const { crearLimitador } = require('../limiteIntentos');

// Límite de intentos de login. El intento se RESERVA al entrar (antes de la base y de bcrypt) y solo se
// devuelve si el login acierta; así una ráfaga simultánea no pasa de `max` verificaciones por clave.
// Tres claves, a propósito con umbrales distintos (ver entrega, hallazgo N-02):
//  - PAR IP+usuario (estricta, 10): frena a un atacante sin bloquear a la víctima, que entra desde su IP.
//  - IP sola (laxa, 40): frena el rociado de muchos usuarios desde una misma IP.
//  - Usuario solo (alta, 100): freno a la fuerza bruta distribuida; umbral alto para que unos pocos
//    fallos ajenos nunca bloqueen a la víctima.
// La demo (demo/demo, clave pública) queda fuera del par y del usuario: nadie puede dejarla fuera; solo cuenta la IP.
// En memoria: sirve con UNA instancia (Railway hoy). Con varias réplicas cada una contaría por separado
// (el límite efectivo se multiplicaría): habría que mover los contadores a Postgres o Redis.
const VENTANA_MS = (Number(process.env.LOGIN_VENTANA_MINUTOS) || 15) * 60 * 1000;
const MAX_PAR = Number(process.env.LOGIN_MAX_INTENTOS) || 10;
const limitePar = crearLimitador({ max: MAX_PAR, ventanaMs: VENTANA_MS });
const limitePorIp = crearLimitador({ max: Number(process.env.LOGIN_MAX_POR_IP) || 40, ventanaMs: VENTANA_MS });
const limitePorUsuario = crearLimitador({ max: Number(process.env.LOGIN_MAX_POR_USUARIO) || 100, ventanaMs: VENTANA_MS });

// Hash falso para gastar el mismo tiempo de bcrypt cuando la empresa o el usuario no existen
// (así la respuesta tarda parecido y no revela si existen).
const HASH_FALSO = bcrypt.hashSync('contraseña-falsa-para-igualar-tiempos', 10);

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
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
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
    await client.query('ROLLBACK').catch(() => {});
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
  if ([subdominio, usuario, password].some((v) => typeof v !== 'string')) {
    return res.status(400).json({ error: 'Empresa, usuario y contraseña deben ser texto' });
  }

  const claveIp = String(req.ip);
  const claveUsuario = `${subdominio.trim().toLowerCase()}|${usuario.trim().toLowerCase()}`.slice(0, 200);
  const esDemo = claveUsuario === 'demo|demo';
  const claves = [[limitePorIp, claveIp]];
  if (!esDemo) claves.push([limitePar, `${claveIp}|${claveUsuario}`], [limitePorUsuario, claveUsuario]);

  const espera = Math.max(...claves.map(([l, c]) => l.bloqueadoPor(c)));
  if (espera > 0) {
    res.set('Retry-After', String(espera));
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Espera ${Math.ceil(espera / 60)} minuto(s) e inténtalo de nuevo.`
    });
  }
  // Reserva síncrona (sin ningún await antes): esto es lo que hace atómico el límite.
  const recibos = claves.map(([l, c]) => [l, c, l.reservar(c)]);
  const devolverReserva = () => recibos.forEach(([l, c, r]) => l.devolver(c, r));

  try {
    const empresaResult = await db.query(
      'SELECT id, nombre, subdominio, activa FROM empresas WHERE subdominio = $1',
      [subdominio.trim().toLowerCase()]
    );
    const empresa = empresaResult.rows[0];
    if (!empresa) {
      await verificarPassword(password, HASH_FALSO);
      return res.status(401).json({ error: 'Empresa, usuario o contraseña incorrectos' });
    }
    if (!empresa.activa) {
      devolverReserva(); // no se probó ninguna contraseña
      return res.status(403).json({ error: 'Esta cuenta está suspendida. Contacta a STI para reactivarla.', codigo: 'suspendida' });
    }

    const usuarioResult = await db.query(
      'SELECT id, usuario, password_hash, token_version FROM usuarios WHERE empresa_id = $1 AND lower(usuario) = lower($2)',
      [empresa.id, usuario]
    );
    const usuarioFila = usuarioResult.rows[0];
    const passwordOk = await verificarPassword(password, usuarioFila ? usuarioFila.password_hash : HASH_FALSO);
    if (!usuarioFila || !passwordOk) {
      return res.status(401).json({ error: 'Empresa, usuario o contraseña incorrectos' });
    }

    devolverReserva(); // acierto: no cuenta
    if (!esDemo) limitePar.olvidar(`${claveIp}|${claveUsuario}`); // quien acierta desde su IP empieza de cero
    const token = firmarToken({ empresaId: empresa.id, usuarioId: usuarioFila.id, usuario: usuarioFila.usuario, tokenVersion: usuarioFila.token_version });
    delete empresa.activa;
    res.json({ token, empresa, usuario: { id: usuarioFila.id, usuario: usuarioFila.usuario } });
  } catch (err) {
    devolverReserva(); // error del servidor, no del usuario
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
// Solo para las pruebas: vacía los contadores de intentos.
module.exports.reiniciarLimites = () => { limitePar.reiniciar(); limitePorIp.reiniciar(); limitePorUsuario.reiniciar(); };
