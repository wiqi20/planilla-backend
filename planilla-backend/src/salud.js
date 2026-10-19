// GET /health: confirma que el servicio responde Y que la base contesta (SELECT 1 con tiempo máximo).
// Público (sin sesión) y fuera del límite de intentos. No revela versiones, direcciones ni mensajes de error.
const { responderError } = require('./errores');

function crearSalud({ consultar, timeoutMs = Number(process.env.HEALTH_TIMEOUT_MS) || 2000, estaCerrando = () => false }) {
  return async function salud(req, res) {
    res.set('Cache-Control', 'no-store');
    const noDisponible = (estado) => responderError(res, 503, 'Servicio no disponible',
      'El servicio no está disponible en este momento.', { estado });
    if (estaCerrando()) return noDisponible('apagando');

    let temporizador;
    try {
      await Promise.race([
        consultar(),
        new Promise((_, rechazar) => { temporizador = setTimeout(() => rechazar(new Error('timeout')), timeoutMs); })
      ]);
      return res.json({ estado: 'ok' });
    } catch (err) {
      console.error('[health] la base no respondió:', err && err.code ? err.code : err && err.message);
      return noDisponible('sin-base');
    } finally {
      clearTimeout(temporizador);
    }
  };
}

module.exports = { crearSalud };
