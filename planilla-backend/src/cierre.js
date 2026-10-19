// Apagado ordenado: al recibir SIGTERM/SIGINT deja de aceptar conexiones nuevas, espera a que terminen
// las peticiones en curso (hasta `timeoutMs`; pasado ese tope se cortan las que queden) y cierra el pool
// de la base. Devuelve una función `cerrar()` idempotente: llamarla otra vez devuelve la misma promesa.
function crearCierre({ servidor, pool, timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000, log = console.log, antes = () => {} }) {
  let promesa = null;
  let cerrando = false;

  function cerrar(motivo = 'cierre') {
    if (promesa) return promesa;
    cerrando = true;
    promesa = (async () => {
      log(`[cierre] ${motivo}: se dejan de aceptar conexiones; se espera a las peticiones en curso (máx. ${timeoutMs} ms).`);
      try { antes(); } catch { /* nada que hacer */ }
      let forzado = false;
      const terminado = new Promise((resolve) => servidor.close(() => resolve()));
      servidor.closeIdleConnections?.(); // las conexiones keep-alive sin petición no deben retrasar el cierre
      let temporizador;
      const tope = new Promise((resolve) => {
        temporizador = setTimeout(() => { forzado = true; resolve(); }, timeoutMs);
      });
      await Promise.race([terminado, tope]);
      clearTimeout(temporizador);
      if (forzado) {
        log('[cierre] se agotó el tiempo: se cortan las peticiones que seguían en curso.');
        servidor.closeAllConnections?.();
      }
      try { await pool.end(); } catch (err) { log('[cierre] error cerrando el pool:', err.message); }
      log(forzado ? '[cierre] terminado a la fuerza.' : '[cierre] terminado en orden.');
      return { forzado };
    })();
    return promesa;
  }

  return { cerrar, estaCerrando: () => cerrando };
}

module.exports = { crearCierre };
