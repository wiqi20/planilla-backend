// Fechas de negocio. Costa Rica es UTC-6 todo el año (no tiene horario de verano).
// Usar toISOString() directo da la fecha de Greenwich: después de las 6:00 p. m. hora de
// Costa Rica ya "es mañana" y las reglas de fechas fallarían. Aquí siempre se usa la zona del negocio.
const ZONA = 'America/Costa_Rica';

const formato = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit'
});

// Fecha de "hoy" en Costa Rica como AAAA-MM-DD. `ahora` solo se pasa en las pruebas.
function hoyCR(ahora = new Date()) {
  return formato.format(ahora); // en-CA da AAAA-MM-DD
}

// Convierte AAAA-MM-DD a número de día (para restar fechas sin problemas de zona horaria).
function diaNumero(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, d) / 86400000;
}

// ¿Es una fecha AAAA-MM-DD que existe de verdad en el calendario? (rechaza 2026-02-30)
function esFechaISOValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [a, m, d] = valor.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

module.exports = { ZONA, hoyCR, diaNumero, esFechaISOValida };
