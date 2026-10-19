// Integración: la fecha de "hoy" es la de Costa Rica (UTC-6), no la de Greenwich.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./soporte/servidor');
const { hoyCR } = require('../src/fechas');

const opts = { skip: S.SIN_BASE };

function sumarDias(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Un día D (lunes a sábado) y el instante en que en Costa Rica son las 20:00 de D (= 02:00 UTC de D+1).
let D = hoyCR();
while (new Date(D + 'T00:00:00Z').getUTCDay() === 0) D = sumarDias(D, 1);
const AHORA_FALSO = `${sumarDias(D, 1)}T02:00:00.000Z`;

test('a las 20:00 de Costa Rica, "hoy" sigue siendo D y no D+1', opts, async (t) => {
  await S.prepararEsquema();
  const srv = await S.iniciarServidor({ FAKE_NOW: AHORA_FALSO });
  t.after(async () => { await srv.detener(); await S.limpiar(); });

  const A = await S.crearEmpresa('h');
  const emp = await S.crearEmpleado(A.token);

  // Boleta para el mismo día: con la fecha UTC (D+1) se rechazaba por "anterior a la fecha actual".
  const r = await S.api('POST', '/api/boletas/generar', { token: A.token, body: { empleadoId: emp.id, diasDisfrutar: 1, periodoInicio: D, periodoFin: D } });
  assert.equal(r.status, 201, r.texto);
  assert.equal(String(r.body.fecha_generacion).slice(0, 10), D, 'la fecha de generación debe ser la de Costa Rica');

  // Un día antes sí es pasado.
  const ayer = await S.api('POST', '/api/boletas/generar', { token: A.token, body: { empleadoId: emp.id, diasDisfrutar: 1, periodoInicio: sumarDias(D, -2), periodoFin: sumarDias(D, -2) } });
  assert.equal(ayer.status, 400);

  // Ingreso "mañana" en Costa Rica es futuro (con la fecha UTC se aceptaba).
  const futuro = await S.api('POST', '/api/empleados', { token: A.token, body: {
    nombre: 'Ingreso Futuro', correo: 'futuro@ejemplo.cr', salario: 500000, fechaIngreso: sumarDias(D, 1) } });
  assert.equal(futuro.status, 400);
  assert.match(futuro.body.error, /futura/);
  const hoy = await S.api('POST', '/api/empleados', { token: A.token, body: {
    nombre: 'Ingreso Hoy', correo: 'hoy@ejemplo.cr', salario: 500000, fechaIngreso: D } });
  assert.equal(hoy.status, 201, hoy.texto);
});
