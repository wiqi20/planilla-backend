// Reglas para los nombres de subdominio (cliente.sticr.app).
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/; // 3 a 30 caracteres

// Subdominios de otros sistemas de STI que comparten el comodín *.sticr.app. Nunca son clientes de Planilla:
// no se pueden vender aquí y GET /api/auth/direccion responde que no existen aunque hubiera una fila con ese nombre.
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

// Nombre que puede corresponder a una empresa de Planilla: uno vendible (validarSubdominio) o la demo.
// Devuelve el nombre normalizado, o null si nunca puede ser una empresa (formato inválido, reservado u otro sistema).
// Solo acepta texto: un parámetro repetido (?valor=a&valor=b) llega como arreglo y da null.
function nombreDeEmpresaPosible(valor, { demo = 'demo' } = {}) {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim().toLowerCase();
  if (limpio === demo) return limpio;
  const revision = validarSubdominio(limpio);
  return revision.ok ? revision.valor : null;
}

module.exports = { validarSubdominio, nombreDeEmpresaPosible, RESERVADOS, OTROS_SISTEMAS };
