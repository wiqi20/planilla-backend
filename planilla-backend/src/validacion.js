// Validación de entradas con zod. Cada función devuelve { ok:true, datos } o { ok:false, error }
// donde `error` es un texto en español listo para mostrar (la API responde { error }).
const { z } = require('zod');
const { esFechaISOValida, diaNumero, hoyCR } = require('./fechas');

// ---- Topes (ver entrega: cómo se eligieron) ----
const TOPES = {
  horas: 400,            // un mes completo tiene como máximo ~744 h; 400 cubre cualquier jornada extra real
  dias: 31,              // un período de colilla no pasa de un mes
  rangoPeriodoDias: 62,  // quincena o mes, con margen para ajustes
  salarioMax: 100_000_000,   // colones por mes; muy por encima de cualquier salario real
  vacacionesMax: 90,     // saldo acumulado; las vacaciones de ley son 2 semanas por año
  nombreMax: 120,
  correoMax: 254,
  anioMin: 1950
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Letras (con tildes y ñ), números, espacios y . , - ( ) /. También ° y º porque los
// feriados oficiales se escriben "1.° de mayo".
const FERIADO_REGEX = /^[\p{L}\p{N} .,\-()/°º]+$/u;

// Acepta número o texto numérico ("12", "1.5"). Vacío/nulo cuenta como "no enviado".
function aNumero(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'string' && v.trim() !== '' && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(v.trim())) return Number(v.trim());
  return v;
}

function numero(etiqueta, { min = 0, max, entero = false, minExclusivo = false, porDefecto } = {}) {
  const rango = minExclusivo ? `mayor que ${min}` : `entre ${min} y ${max}`;
  const msg = `${etiqueta} debe ser un número${entero ? ' entero' : ''} ${minExclusivo ? `${rango} y como máximo ${max}` : rango}`;
  const base = z.number({ error: msg }).refine(
    (v) => Number.isFinite(v)
      && (minExclusivo ? v > min : v >= min)
      && v <= max
      && (!entero || Number.isInteger(v)),
    { error: msg }
  );
  return z.preprocess((v) => { const n = aNumero(v); return n === undefined ? porDefecto : n; }, base);
}

const fechaISO = (etiqueta) => z.string({ error: `${etiqueta} debe ser una fecha válida (AAAA-MM-DD)` })
  .refine((v) => esFechaISOValida(v) && Number(v.slice(0, 4)) >= TOPES.anioMin && Number(v.slice(0, 4)) <= 2100,
    { error: `${etiqueta} debe ser una fecha válida (AAAA-MM-DD)` });

const idPositivo = (etiqueta) => z.preprocess(aNumero,
  z.number({ error: `${etiqueta} debe ser un número entero positivo` })
    .refine((v) => Number.isInteger(v) && v > 0 && v <= 2147483647, { error: `${etiqueta} debe ser un número entero positivo` }));

const feriadoNombre = z.preprocess((v) => (v === null || v === undefined ? '' : v),
  z.string({ error: 'El nombre del feriado debe ser texto' })
    .trim()
    .max(60, { error: 'El nombre del feriado no puede pasar de 60 caracteres' })
    .refine((v) => v === '' || FERIADO_REGEX.test(v),
      { error: 'El nombre del feriado solo puede tener letras, números, espacios y . , - ( ) /' }));

// Rango de fechas de un período: inicio <= fin y no más de `rangoPeriodoDias`.
function revisarRango(d, ctx) {
  if (d.periodoInicio > d.periodoFin) {
    ctx.addIssue({ code: 'custom', message: 'El período no es válido: la fecha de inicio es posterior a la de fin' });
  } else if (diaNumero(d.periodoFin) - diaNumero(d.periodoInicio) + 1 > TOPES.rangoPeriodoDias) {
    ctx.addIssue({ code: 'custom', message: `El período no puede pasar de ${TOPES.rangoPeriodoDias} días` });
  }
}

const horas = (etiqueta) => numero(etiqueta, { max: TOPES.horas, porDefecto: 0 });
const dias = (etiqueta) => numero(etiqueta, { max: TOPES.dias, entero: true, porDefecto: 0 });

const colillaSchema = z.object({
  empleadoId: idPositivo('empleadoId'),
  periodoInicio: fechaISO('periodoInicio'),
  periodoFin: fechaISO('periodoFin'),
  feriadoNombre,
  horasExtra: horas('Las horas extra'),
  horasSinGoce: horas('Las horas sin goce'),
  horasFeriado: horas('Las horas de feriado'),
  diasVacaciones: dias('Los días de vacaciones'),
  diasSinGoceCompletos: dias('Los días sin goce'),
  diasIncapacidad: dias('Los días de incapacidad'),
  diasLicenciaMP: dias('Los días de licencia de maternidad/paternidad'),
  diasLicenciaCuido: dias('Los días de licencia de cuido')
}).superRefine(revisarRango);

const periodoSchema = z.object({
  periodoInicio: fechaISO('periodoInicio'),
  periodoFin: fechaISO('periodoFin')
}).superRefine(revisarRango);

const colillaFiltroSchema = z.object({
  empleadoId: idPositivo('empleadoId').optional(),
  periodoInicio: fechaISO('periodoInicio').optional(),
  periodoFin: fechaISO('periodoFin').optional()
});

const nombre = z.string({ error: 'El nombre es obligatorio' }).trim()
  .min(2, { error: 'El nombre debe tener al menos 2 caracteres' })
  .max(TOPES.nombreMax, { error: `El nombre no puede pasar de ${TOPES.nombreMax} caracteres` });
const correo = z.string({ error: 'El correo no tiene un formato válido' }).trim()
  .max(TOPES.correoMax, { error: `El correo no puede pasar de ${TOPES.correoMax} caracteres` })
  .refine((v) => EMAIL_REGEX.test(v), { error: 'El correo no tiene un formato válido' });
const salario = numero('El salario', { min: 0, minExclusivo: true, max: TOPES.salarioMax });
const vacaciones = numero('Las vacaciones disponibles', { max: TOPES.vacacionesMax });
const fechaIngreso = fechaISO('La fecha de ingreso').refine((v) => v <= hoyCR(),
  { error: 'La fecha de ingreso no puede ser futura' });

// En PUT los campos pueden venir como null (= no cambiar).
const sinNulo = (schema) => z.preprocess((v) => (v === null ? undefined : v), schema.optional());

const empleadoCrearSchema = z.object({
  nombre, correo, salario, fechaIngreso,
  vacacionesDisponibles: z.preprocess((v) => (v === null || v === '' ? undefined : v), vacaciones.optional())
});

const empleadoEditarSchema = z.object({
  nombre: sinNulo(nombre),
  correo: sinNulo(correo),
  salario: sinNulo(salario),
  fechaIngreso: sinNulo(fechaIngreso),
  vacacionesDisponibles: sinNulo(vacaciones),
  activo: sinNulo(z.boolean({ error: 'El campo activo debe ser verdadero o falso' }))
});

function validar(schema, entrada) {
  const r = schema.safeParse(entrada && typeof entrada === 'object' ? entrada : {});
  if (r.success) return { ok: true, datos: r.data };
  return { ok: false, error: r.error.issues[0].message };
}

// Id numérico de una ruta (/:id) o de un filtro. Devuelve el número o null.
function idDeRuta(valor) {
  const r = idPositivo('id').safeParse(valor);
  return r.success ? r.data : null;
}

module.exports = {
  TOPES, FERIADO_REGEX, validar, idDeRuta, fechaISO, idPositivo,
  colillaSchema, colillaFiltroSchema, periodoSchema, empleadoCrearSchema, empleadoEditarSchema
};
