// Orígenes que pueden llamar a la API desde un navegador.
// - CORS_ORIGINS (lista separada por comas) manda si está definida. Cada entrada es un origen exacto,
//   por ejemplo https://planilla.sticr.app. No se admite "*".
// - Si no está definida: sticr.app y cualquier https://<algo>.sticr.app de un solo nivel (planilla, demo
//   y las empresas de clientes; no hay entradas por cliente, todo entra por el comodín) y, solo fuera de producción, http://localhost:<puerto>.
// Las peticiones sin cabecera Origin (curl, servidor a servidor, el aprovisionamiento del sitio) no son
// de navegador: no pasan por CORS y siguen funcionando.
const POR_DEFECTO = [/^https:\/\/sticr\.app$/, /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.sticr\.app$/];
const LOCALHOST = /^http:\/\/localhost:\d{1,5}$/;

function origenPermitido(origen, env = process.env) {
  if (!origen) return false;
  const lista = (env.CORS_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  if (lista.length > 0) return lista.includes(origen);
  if (POR_DEFECTO.some((r) => r.test(origen))) return true;
  return env.NODE_ENV !== 'production' && LOCALHOST.test(origen);
}

// Opciones para el paquete `cors`: un origen no permitido simplemente no recibe Access-Control-Allow-Origin.
function opcionesCors(env = process.env) {
  return {
    origin: (origen, cb) => cb(null, origenPermitido(origen, env)),
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600
  };
}

module.exports = { origenPermitido, opcionesCors };
