// Apagado ordenado: al recibir SIGTERM/SIGINT deja de aceptar conexiones nuevas, espera a que terminen
// las peticiones en curso (hasta `timeoutMs`; pasado ese tope se cortan las que queden) y cierra el pool
// de la base. Devuelve una función `cerrar()` idempotente: llamarla otra vez devuelve la misma promesa.
// `poolMs`: cuánto se espera a que el pool cierre. Una consulta colgada impediría pool.end() para siempre; pasado
// ese plazo se da el cierre por forzado y el proceso sale igual (código 1), así el tope total se respeta.
function crearCierre({ servidor, pool, timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000, poolMs = 1000, log = console.log, antes = () => {} }) {
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
      // Las conexiones keep-alive inactivas no deben retrasar el cierre. Se cierran ahora y, mientras se espera,
      // también las que queden inactivas al terminar su última petición.
      servidor.closeIdleConnections?.();
      const barrido = setInterval(() => servidor.closeIdleConnections?.(), 50);
      let temporizador;
      const tope = new Promise((resolve) => {
        temporizador = setTimeout(() => { forzado = true; resolve(); }, timeoutMs);
      });
      await Promise.race([terminado, tope]);
      clearTimeout(temporizador);
      clearInterval(barrido);
      if (forzado) {
        log('[cierre] se agotó el tiempo: se cortan las peticiones que seguían en curso.');
        servidor.closeAllConnections?.();
      }
      let temporizadorPool;
      const poolCerrado = Promise.race([
        pool.end().then(() => true, (err) => { log('[cierre] error cerrando el pool:', err.message); return true; }),
        new Promise((resolve) => { temporizadorPool = setTimeout(() => resolve(false), poolMs); })
      ]);
      if (!(await poolCerrado)) {
        forzado = true;
        log('[cierre] el pool no cerró a tiempo (consulta colgada): se sale igual.');
      }
      clearTimeout(temporizadorPool);
      log(forzado ? '[cierre] terminado a la fuerza.' : '[cierre] terminado en orden.');
      return { forzado };
    })();
    return promesa;
  }

  return { cerrar, estaCerrando: () => cerrando };
}

module.exports = { crearCierre };
