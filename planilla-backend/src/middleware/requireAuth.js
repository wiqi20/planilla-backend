const { verificarToken } = require('../auth');
const db = require('../db');

// Toda ruta protegida pasa por aquí. Extrae el JWT del header Authorization,
// lo valida, y deja req.empresaId / req.usuarioId listos para las queries.
// Esto es lo que garantiza el aislamiento multi-empresa: cada query de cada
// ruta filtra siempre por req.empresaId, nunca por un id que mande el cliente.
//
// También confirma en cada petición que el usuario siga existiendo y que la empresa siga activa: una cuenta suspendida
// (suscripción cancelada o sin pago) deja de funcionar aunque su token no haya expirado.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [tipo, token] = header.split(' ');

  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  let payload;
  try {
    payload = verificarToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }

  try {
    // Un solo viaje: la empresa y, si existe, el usuario del token (del mismo tenant).
    const result = await db.query(
      `SELECT e.activa, e.es_demo, u.id AS usuario_id
       FROM empresas e LEFT JOIN usuarios u ON u.id = $2 AND u.empresa_id = e.id
       WHERE e.id = $1`,
      [payload.empresaId, payload.usuarioId]
    );
    const empresa = result.rows[0];
    if (!empresa) return res.status(401).json({ error: 'Sesión inválida o expirada' });
    if (!empresa.activa) {
      return res.status(403).json({ error: 'Esta cuenta está suspendida. Contacta a STI para reactivarla.', codigo: 'suspendida' });
    }
    // Si el usuario fue borrado, su token deja de servir aunque no haya expirado.
    if (!empresa.usuario_id) return res.status(401).json({ error: 'Sesión inválida o expirada' });
    req.empresaId = payload.empresaId;
    req.usuarioId = payload.usuarioId;
    req.usuarioNombre = payload.usuario;
    req.esDemo = empresa.es_demo;
    next();
  } catch (err) {
    console.error('Error verificando la empresa:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

module.exports = requireAuth;
