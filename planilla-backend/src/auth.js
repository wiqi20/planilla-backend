require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Sin esto cualquiera podría firmar tokens válidos: mejor detener el arranque.
  throw new Error('Falta la variable de entorno JWT_SECRET. Genera una larga y aleatoria.');
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function verificarPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// `tv` = versión de sesión del usuario (usuarios.token_version). Al cambiar su contraseña sube, y los
// tokens con una versión menor dejan de servir (requireAuth la compara). Un token viejo sin `tv` cuenta como 0.
function firmarToken({ empresaId, usuarioId, usuario, tokenVersion = 0 }) {
  return jwt.sign({ empresaId, usuarioId, usuario, tv: tokenVersion }, JWT_SECRET, { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN });
}

function verificarToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); // lanza si es inválido/expiró
}

module.exports = { hashPassword, verificarPassword, firmarToken, verificarToken };
