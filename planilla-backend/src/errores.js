// Formato único de error de la API: { "error": "<texto>", "mensaje": "<texto en español para mostrar>" }.
// `error` se conserva tal cual lo leía el frontend; `mensaje` es nuevo y siempre está presente.
// Algunos campos extra (codigo, vacacionesDisponibles, faltantes) se mantienen como antes.

// Textos de `error` que son secos o técnicos y merecen un `mensaje` más claro para la persona usuaria.
// Los demás `error` ya son frases completas en español y se usan tal cual como `mensaje`.
const MENSAJES = {
  'No autenticado': 'Debes iniciar sesión para continuar.',
  'Sesión inválida o expirada': 'Tu sesión ya no es válida o expiró. Inicia sesión de nuevo.',
  'No autorizado': 'No tienes permiso para hacer esta acción.',
  'Error interno del servidor': 'Ocurrió un error inesperado. Inténtalo de nuevo en unos minutos.',
  'Empresa no encontrada': 'No se encontró la empresa.',
  'Colaborador no encontrado': 'No se encontró el colaborador.',
  'Usuario no encontrado': 'No se encontró el usuario.',
  'Boleta no encontrada': 'No se encontró la boleta.',
  'Ruta no encontrada': 'La dirección que pediste no existe.',
  'Faltan campos requeridos': 'Faltan datos obligatorios. Revisa el formulario e inténtalo de nuevo.',
  'Falta empleadoId': 'Falta indicar el colaborador.',
  'El aprovisionamiento no está configurado': 'El servicio de alta de empresas no está configurado.',
  'Ese subdominio ya está en uso': 'Ese subdominio ya está en uso. Elige otro.'
};

function mensajeDe(error) {
  return MENSAJES[error] || error;
}

// Envía una respuesta de error con el formato único. `extra` agrega campos adicionales (ej. codigo).
function responderError(res, status, error, mensaje, extra = {}) {
  return res.status(status).json({ error, mensaje: mensaje || mensajeDe(error), ...extra });
}

// Red de seguridad: cualquier res.json con estado >= 400 y { error } sin `mensaje` lo recibe aquí.
// Así ninguna ruta (presente o futura) puede responder un error sin el formato único.
function formatoError(req, res, next) {
  const json = res.json.bind(res);
  res.json = (cuerpo) => {
    if (res.statusCode >= 400 && cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo)
        && typeof cuerpo.error === 'string' && cuerpo.mensaje === undefined) {
      const { error, ...resto } = cuerpo;
      return json({ error, mensaje: mensajeDe(error), ...resto });
    }
    return json(cuerpo);
  };
  next();
}

// Códigos de Postgres que significan "el texto que mandaste no se puede guardar" (culpa del cliente).
// Solo los del byte NUL: otros errores de datos serían un fallo nuestro y deben seguir siendo 500.
const PG_ENTRADA_INVALIDA = new Set([
  '22021', // invalid byte sequence for encoding (incluye el byte NUL en texto)
  '22P05'  // unsupported Unicode escape sequence (\u0000 dentro de jsonb)
]);

function manejadorErrores(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.parse.failed') {
    return responderError(res, 400, 'El cuerpo de la petición no es un JSON válido', 'El cuerpo de la petición no es un JSON válido.');
  }
  if (err && err.type === 'entity.too.large') {
    return responderError(res, 413, 'El cuerpo de la petición es demasiado grande', 'El cuerpo de la petición es demasiado grande.');
  }
  if (err && err.type === 'encoding.unsupported') {
    return responderError(res, 415, 'Codificación no soportada', 'La codificación de la petición no está soportada.');
  }
  if (err && PG_ENTRADA_INVALIDA.has(err.code)) {
    return responderError(res, 400, 'Algún dato enviado no es válido', 'Algún texto enviado contiene caracteres que no se pueden guardar.');
  }
  console.error('Error no manejado:', err);
  return responderError(res, 500, 'Error interno del servidor');
}

function rutaNoEncontrada(req, res) {
  return responderError(res, 404, 'Ruta no encontrada');
}

// N-11: el byte NUL (\u0000) no se puede guardar en Postgres (daba 500). Se rechaza con 400 en cualquier
// texto de la petición: cuerpo (valores y nombres de campo), parámetros de búsqueda y la ruta.
const NUL = '\u0000';
function contieneNul(valor) {
  const pila = [valor];
  let revisados = 0;
  while (pila.length) {
    const v = pila.pop();
    if (typeof v === 'string') { if (v.includes(NUL)) return true; continue; }
    if (v && typeof v === 'object') {
      if (++revisados > 20000) return true; // estructura absurda: se rechaza igual
      for (const k of Object.keys(v)) {
        if (k.includes(NUL)) return true;
        pila.push(v[k]);
      }
    }
  }
  return false;
}

function rechazarNul(req, res, next) {
  if (/%00/i.test(req.url) || contieneNul(req.body) || contieneNul(req.query)) {
    return responderError(res, 400, 'El texto contiene caracteres no permitidos',
      'Algún texto contiene caracteres no permitidos (el carácter nulo). Quítalos e inténtalo de nuevo.');
  }
  next();
}

module.exports = { responderError, formatoError, manejadorErrores, rutaNoEncontrada, rechazarNul, contieneNul, mensajeDe, MENSAJES };
