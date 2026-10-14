// Reglas para los nombres de subdominio (cliente.sticr.app).
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/; // 3 a 30 caracteres

// Nombres que no se pueden vender: los usa STI, el correo o el sistema.
const RESERVADOS = new Set([
  'www', 'api', 'app', 'admin', 'demo', 'planilla', 'planilla-api', 'posadasweet', 'sticr',
  'mail', 'correo', 'smtp', 'ftp', 'ns1', 'ns2', 'cdn', 'static', 'assets',
  'dev', 'test', 'staging', 'status', 'soporte', 'ayuda', 'docs', 'blog',
  'login', 'cuenta', 'panel', 'dashboard', 'billing', 'pagos', 'stripe', 'sistema', 'sistemas',
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

module.exports = { validarSubdominio, RESERVADOS };
