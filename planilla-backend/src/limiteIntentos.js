// Límite de intentos fallidos en memoria (ventana fija). Sirve para un solo servicio;
// si algún día se corren varias copias, hay que moverlo a la base de datos o a Redis.
const MAX_CLAVES = 20000; // tope de memoria: las claves vienen de lo que escribe el cliente

function crearLimitador({ max, ventanaMs, ahora = () => Date.now() }) {
  const registros = new Map(); // clave -> { cuenta, vence }

  function vigente(clave) {
    const r = registros.get(clave);
    if (!r) return null;
    if (r.vence <= ahora()) { registros.delete(clave); return null; }
    return r;
  }

  function limpiar() {
    const t = ahora();
    for (const [k, r] of registros) if (r.vence <= t) registros.delete(k);
    if (registros.size > MAX_CLAVES) {
      // Aun así hay demasiadas: se descartan las más antiguas (Map conserva el orden de inserción).
      for (const k of registros.keys()) {
        registros.delete(k);
        if (registros.size <= MAX_CLAVES / 2) break;
      }
    }
  }

  return {
    // Segundos que faltan para poder reintentar, o 0 si la clave no está bloqueada.
    bloqueadoPor(clave) {
      const r = vigente(clave);
      return r && r.cuenta >= max ? Math.ceil((r.vence - ahora()) / 1000) : 0;
    },
    registrarFallo(clave) {
      const r = vigente(clave);
      if (r) { r.cuenta += 1; return; }
      if (registros.size >= MAX_CLAVES) limpiar();
      registros.set(clave, { cuenta: 1, vence: ahora() + ventanaMs });
    },
    olvidar(clave) { registros.delete(clave); },
    reiniciar() { registros.clear(); }
  };
}

module.exports = { crearLimitador };
