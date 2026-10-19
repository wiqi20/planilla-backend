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
    // RESERVA un intento al entrar (antes de consultar la base y de bcrypt). Es síncrono y Node corre
    // un solo hilo, así que 1000 peticiones simultáneas no pueden colarse: la 11.ª ya ve el contador lleno.
    // Devuelve un recibo para `devolver`.
    reservar(clave) {
      const r = vigente(clave);
      if (r) { r.cuenta += 1; return r; }
      if (registros.size >= MAX_CLAVES) limpiar();
      const nuevo = { cuenta: 1, vence: ahora() + ventanaMs };
      registros.set(clave, nuevo);
      return nuevo;
    },
    // Devuelve la reserva (login correcto). Si la ventana ya venció y se creó otra, no toca la nueva.
    devolver(clave, recibo) {
      if (recibo && registros.get(clave) === recibo && recibo.cuenta > 0) {
        recibo.cuenta -= 1;
        if (recibo.cuenta === 0) registros.delete(clave);
      }
    },
    olvidar(clave) { registros.delete(clave); },
    reiniciar() { registros.clear(); }
  };
}

module.exports = { crearLimitador };
