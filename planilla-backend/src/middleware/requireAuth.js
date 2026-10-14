const { verificarToken } = require('../auth');
const db = require('../db');

// Toda ruta protegida pasa por aquí. Extrae el JWT del header Authorization,
// lo valida, y deja req.empresaId / req.usuarioId listos para las queries.
// Esto es lo que garantiza el aislamiento multi-empresa: cada query de cada
// ruta filtra siempre por req.empresaId, nunca por un id que mande el cliente.
//
// También confirma en cada petición que la empresa siga activa: una cuenta suspendida
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
    const result = await db.query('SELECT activa, es_demo FROM empresas WHERE id = $1', [payload.empresaId]);
    const empresa = result.rows[0];
    if (!empresa) return res.status(401).json({ error: 'Sesión inválida o expirada' });
    if (!empresa.activa) {
      return res.status(403).json({ error: 'Esta cuenta está suspendida. Contacta a STI para reactivarla.', codigo: 'suspendida' });
    }
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
