// Reglas para los nombres de subdominio (cliente.planilla.sticr.app).
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/; // 3 a 30 caracteres

// Nombres de otros sistemas de STI (tienen sus propios nombres fijos en sticr.app, como crumble.sticr.app). Ya no
// comparten comodín con Planilla (cada sistema usa el suyo: *.planilla.sticr.app), pero siguen sin venderse para no
// crear direcciones que confundan, como crumble.planilla.sticr.app. GET /api/auth/direccion responde que no existen
// (ver NUNCA_CLIENTE) y el CORS de transición los rechaza (src/cors.js).
const OTROS_SISTEMAS = ['crumble', 'crumble-admin', 'pasteleria-demo', 'pasteleria-demo-admin'];

// Nombres que no se pueden vender: los usa STI, el correo, el sistema u otros sistemas de STI.
// 'demo' está aquí porque no se vende, pero la empresa demo sí existe (la crea src/demo.js).
const RESERVADOS = new Set([
  'www', 'api', 'app', 'admin', 'demo', 'planilla', 'planilla-api', 'sticr',
  'mail', 'correo', 'smtp', 'ftp', 'ns1', 'ns2', 'cdn', 'static', 'assets',
  'dev', 'test', 'staging', 'status', 'soporte', 'ayuda', 'docs', 'blog',
  'login', 'cuenta', 'panel', 'dashboard', 'billing', 'pagos', 'stripe', 'sistema', 'sistemas',
  ...OTROS_SISTEMAS,
]);

function validarSubdominio(valor) {
  const limpio = String(valor || '').trim().toLowerCase();
  if (limpio.length < 3 || limpio.length > 30) {
    return { ok: false, motivo: 'Debe tener entre 3 y 30 caracteres' };
  }
  if (!SLUG_REGEX.test(limpio) || limpio.includes('--')) {
    return { ok: false, motivo: 'Solo letras minúsculas, números y guiones (no al inicio ni al final)' };
  }
  if (RESERVADOS.has(limpio)) {
    return { ok: false, motivo: 'Ese nombre está reservado' };
  }
  return { ok: true, valor: limpio };
}

// Etiqueta DNS válida (1 a 63 caracteres). Es la regla para saber si un nombre PUEDE EXISTIR como empresa, distinta
// de las reglas de VENTA (validarSubdominio): hay empresas heredadas con nombres de 1–2 o 31–63 caracteres, con '--'
// o con nombres que después se reservaron (registro público anterior, seed-admin), y siguen siendo clientes.
const ETIQUETA_DNS = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Subdominios que nunca son una empresa de Planilla aunque hubiera una fila con ese nombre: los nombres de otros
// sistemas de STI y las direcciones generales, para no vender nombres que confundan. El frontend (index.html) tiene
// la misma lista; test/direccion.test.js las compara.
// 'planilla' y 'planilla-api' NO están: planilla.sticr.app es la raíz de Planilla y el frontend la manda a la ficha
// del sistema en sticr.app (no entra a ninguna empresa); planilla-api.sticr.app es la API.
const NUNCA_CLIENTE = [...OTROS_SISTEMAS, 'www', 'admin', 'api', 'app'];

function esEtiquetaDns(valor) {
  return typeof valor === 'string' && ETIQUETA_DNS.test(valor);
}

// Nombre a consultar en GET /api/auth/direccion: normalizado si tiene formato de etiqueta DNS y no es de NUNCA_CLIENTE;
// null en cualquier otro caso (no es texto, formato inválido, otro sistema). No aplica las reglas de venta.
function nombreParaConsultar(valor) {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim().toLowerCase();
  if (!esEtiquetaDns(limpio) || NUNCA_CLIENTE.includes(limpio)) return null;
  return limpio;
}

module.exports = { validarSubdominio, nombreParaConsultar, esEtiquetaDns, RESERVADOS, OTROS_SISTEMAS, NUNCA_CLIENTE };
