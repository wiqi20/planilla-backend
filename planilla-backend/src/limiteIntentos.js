const net = require('node:net');
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
    // Devuelve un recibo PROPIO de esa reserva y de un solo uso, para `devolver` (N-12).
    reservar(clave) {
      let r = vigente(clave);
      if (r) { r.cuenta += 1; return { registro: r, devuelto: false }; }
      if (registros.size >= MAX_CLAVES) limpiar();
      r = { cuenta: 1, vence: ahora() + ventanaMs };
      registros.set(clave, r);
      return { registro: r, devuelto: false };
    },
    // Devuelve la reserva (login correcto). Es idempotente: el recibo vale una sola vez, así que repetir
    // la llamada no descuenta la reserva de otro intento. Si la ventana ya venció y se creó otra, no toca la nueva.
    devolver(clave, recibo) {
      if (!recibo || recibo.devuelto) return;
      recibo.devuelto = true;
      const r = recibo.registro;
      if (registros.get(clave) === r && r.cuenta > 0) {
        r.cuenta -= 1;
        if (r.cuenta === 0) registros.delete(clave);
      }
    },
    olvidar(clave) { registros.delete(clave); },
    reiniciar() { registros.clear(); }
  };
}

// Clave de un límite por IP. IPv4 tal cual; IPv6 agrupada por su prefijo /64 (un solo cliente suele tener el /64 entero,
// así que contar cada dirección por separado le daría 2^64 cupos). Las IPv4 escritas como IPv6 (::ffff:1.2.3.4) cuentan
// como IPv4. Si no es una IP reconocible, se usa el texto tal cual.
function claveDeIp(ip) {
  let texto = String(ip || '').trim().toLowerCase();
  const mapeada = texto.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapeada) return mapeada[1];
  texto = texto.split('%')[0]; // sin identificador de zona (fe80::1%eth0)
  if (net.isIPv6(texto)) return expandirIPv6(texto).slice(0, 4).join(':') + '::/64';
  return texto;
}

// '2001:db8::1' -> ['2001','db8','0','0','0','0','0','1'] (8 grupos, sin ceros a la izquierda).
function expandirIPv6(texto) {
  let t = texto;
  const v4 = t.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/); // cola IPv4 (::1.2.3.4)
  if (v4) {
    const n = v4.slice(1).map(Number);
    t = t.slice(0, v4.index) + ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16);
  }
  const [izq, der] = t.includes('::') ? t.split('::') : [t, null];
  const a = izq ? izq.split(':') : [];
  const b = der ? der.split(':') : [];
  const ceros = der === null ? [] : Array(8 - a.length - b.length).fill('0');
  return [...a, ...ceros, ...b].map((g) => parseInt(g, 16).toString(16));
}

module.exports = { crearLimitador, claveDeIp };
