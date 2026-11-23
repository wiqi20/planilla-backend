// Orígenes que pueden llamar a la API desde un navegador.
// - CORS_ORIGINS (lista separada por comas) manda si está definida. Cada entrada es un origen exacto,
//   por ejemplo https://demo.planilla.sticr.app. No se admite "*" ni comodines.
// - Si no está definida: https://sticr.app, https://planilla.sticr.app (la raíz de Planilla) y cualquier
//   https://<etiqueta>.planilla.sticr.app de un solo nivel (la demo y las empresas de clientes; no hay entradas por
//   cliente, todo entra por el comodín) y, solo fuera de producción, http://localhost:<puerto>.
//   Regla de un comodín por sistema: docs/estandares/dominios.md de STICR_landingpage.
// Las peticiones sin cabecera Origin (curl, servidor a servidor, el aprovisionamiento del sitio) no son
// de navegador: no pasan por CORS y siguen funcionando.
const { OTROS_SISTEMAS } = require('./subdominios');

const POR_DEFECTO = [
  /^https:\/\/sticr\.app$/,
  /^https:\/\/planilla\.sticr\.app$/,
  /^https:\/\/[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.planilla\.sticr\.app$/, // un solo nivel
];

// TRANSICIÓN (quitar en el paso 8 de docs/proyectos/planilla/mover-comodin.md): la forma vieja
// https://<etiqueta>.sticr.app de un solo nivel, para que demo.sticr.app siga funcionando mientras se mueve el DNS.
// Los nombres de otros sistemas de STI (crumble, crumble-admin, pasteleria-demo, pasteleria-demo-admin) quedan
// fuera: son de otro servicio y nunca deben leer la API de Planilla desde el navegador.
const TRANSICION_COMODIN_VIEJO = /^https:\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?)\.sticr\.app$/;

const LOCALHOST = /^http:\/\/localhost:\d{1,5}$/;

function permitidoEnTransicion(origen) {
  const m = TRANSICION_COMODIN_VIEJO.exec(origen);
  return Boolean(m) && !OTROS_SISTEMAS.includes(m[1]);
}

function origenPermitido(origen, env = process.env) {
  if (!origen) return false;
  const lista = (env.CORS_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  if (lista.length > 0) return lista.includes(origen);
  if (POR_DEFECTO.some((r) => r.test(origen))) return true;
  if (permitidoEnTransicion(origen)) return true; // TRANSICIÓN: quitar en el paso 8
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
