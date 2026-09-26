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

function firmarToken({ empresaId, usuarioId, usuario }) {
  return jwt.sign({ empresaId, usuarioId, usuario }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verificarToken(token) {
  return jwt.verify(token, JWT_SECRET); // lanza si es inválido/expiró
}

module.exports = { hashPassword, verificarPassword, firmarToken, verificarToken };
