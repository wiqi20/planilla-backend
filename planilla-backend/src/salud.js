// GET /health: confirma que el servicio responde Y que la base contesta (SELECT 1 con tiempo máximo).
// Público (sin sesión) y fuera del límite de intentos. No revela versiones, direcciones ni mensajes de error.
const { responderError } = require('./errores');

// Una sola comprobación a la vez: las llamadas simultáneas comparten la que está en curso, y su resultado
// (bueno o malo) se reutiliza `cacheMs` (3 s). Así /health, que es público y sin límite de intentos, no puede
// usarse para agotar el pool de la base.
function crearSalud({ consultar, timeoutMs = Number(process.env.HEALTH_TIMEOUT_MS) || 2000, cacheMs = 3000, estaCerrando = () => false, ahora = () => Date.now() }) {
  let enCurso = null;
  let ultimo = null; // { ok, hasta }

  function comprobar() {
    if (ultimo && ultimo.hasta > ahora()) return Promise.resolve(ultimo.ok);
    if (enCurso) return enCurso;
    enCurso = (async () => {
      let temporizador;
      try {
        await Promise.race([
          consultar(),
          new Promise((_, rechazar) => { temporizador = setTimeout(() => rechazar(new Error('timeout')), timeoutMs); })
        ]);
        return true;
      } catch (err) {
        console.error('[health] la base no respondió:', err && err.code ? err.code : err && err.message);
        return false;
      } finally {
        clearTimeout(temporizador);
      }
    })().then((ok) => { ultimo = { ok, hasta: ahora() + cacheMs }; enCurso = null; return ok; });
    return enCurso;
  }

  return async function salud(req, res) {
    res.set('Cache-Control', 'no-store');
    const noDisponible = (estado) => responderError(res, 503, 'Servicio no disponible',
      'El servicio no está disponible en este momento.', { estado });
    if (estaCerrando()) return noDisponible('apagando');

    return (await comprobar()) ? res.json({ estado: 'ok' }) : noDisponible('sin-base');
  };
}

module.exports = { crearSalud };
