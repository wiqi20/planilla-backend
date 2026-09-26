const { verificarToken } = require('../auth');

// Toda ruta protegida pasa por aquí. Extrae el JWT del header Authorization,
// lo valida, y deja req.empresaId / req.usuarioId listos para las queries.
// Esto es lo que garantiza el aislamiento multi-empresa: cada query de cada
// ruta filtra siempre por req.empresaId, nunca por un id que mande el cliente.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [tipo, token] = header.split(' ');

  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const payload = verificarToken(token);
    req.empresaId = payload.empresaId;
    req.usuarioId = payload.usuarioId;
    req.usuarioNombre = payload.usuario;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

module.exports = requireAuth;
