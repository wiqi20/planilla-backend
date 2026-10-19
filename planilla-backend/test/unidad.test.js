// Pruebas unitarias: no necesitan base de datos ni servidor.
const test = require('node:test');
const assert = require('node:assert/strict');

const { hoyCR, esFechaISOValida } = require('../src/fechas');
const { origenPermitido } = require('../src/cors');
const { crearLimitador } = require('../src/limiteIntentos');
const { validar, colillaSchema, empleadoCrearSchema, FERIADO_REGEX } = require('../src/validacion');

test('hoyCR usa la zona de Costa Rica (UTC-6), no UTC', () => {
  // 20:00 en Costa Rica del 17 de octubre = 02:00 UTC del 18
  assert.equal(hoyCR(new Date('2026-10-18T02:00:00Z')), '2026-10-17');
  // 05:59 UTC = 23:59 del día anterior en Costa Rica
  assert.equal(hoyCR(new Date('2026-10-18T05:59:00Z')), '2026-10-17');
  // 06:00 UTC = medianoche en Costa Rica: ya es el 18
  assert.equal(hoyCR(new Date('2026-10-18T06:00:00Z')), '2026-10-18');
  assert.equal(hoyCR(new Date('2026-01-01T03:00:00Z')), '2025-12-31');
});

test('esFechaISOValida rechaza fechas que no existen', () => {
  assert.equal(esFechaISOValida('2026-02-28'), true);
  assert.equal(esFechaISOValida('2026-02-30'), false);
  assert.equal(esFechaISOValida('2026-13-01'), false);
  assert.equal(esFechaISOValida('26-1-1'), false);
  assert.equal(esFechaISOValida(20260101), false);
});

test('CORS: orígenes por defecto en producción', () => {
  const env = { NODE_ENV: 'production' };
  for (const o of ['https://sticr.app', 'https://planilla.sticr.app', 'https://posadasweet.sticr.app', 'https://demo.sticr.app', 'https://cliente-1.sticr.app']) {
    assert.equal(origenPermitido(o, env), true, o);
  }
  for (const o of ['https://evil.com', 'https://sticr.app.evil.com', 'http://planilla.sticr.app', 'https://a.b.sticr.app',
    'https://evilsticr.app', 'http://localhost:3000', undefined, 'null']) {
    assert.equal(origenPermitido(o, env), false, String(o));
  }
});

test('CORS: localhost solo fuera de producción', () => {
  assert.equal(origenPermitido('http://localhost:3000', { NODE_ENV: 'development' }), true);
  assert.equal(origenPermitido('http://localhost:8080', {}), true);
  assert.equal(origenPermitido('http://localhost:3000', { NODE_ENV: 'production' }), false);
  assert.equal(origenPermitido('http://localhost.evil.com:3000', {}), false);
});

test('CORS: CORS_ORIGINS manda sobre los valores por defecto', () => {
  const env = { NODE_ENV: 'production', CORS_ORIGINS: 'https://uno.com, https://dos.com/' };
  assert.equal(origenPermitido('https://uno.com', env), true);
  assert.equal(origenPermitido('https://dos.com', env), true);
  assert.equal(origenPermitido('https://planilla.sticr.app', env), false);
  assert.equal(origenPermitido('*', env), false);
});

test('limitador: bloquea al llegar al máximo y se libera al vencer la ventana', () => {
  let t = 1000;
  const l = crearLimitador({ max: 3, ventanaMs: 60000, ahora: () => t });
  l.registrarFallo('a'); l.registrarFallo('a');
  assert.equal(l.bloqueadoPor('a'), 0);
  l.registrarFallo('a');
  assert.ok(l.bloqueadoPor('a') > 0);
  assert.equal(l.bloqueadoPor('b'), 0);
  t += 60001;
  assert.equal(l.bloqueadoPor('a'), 0);
  l.registrarFallo('c'); l.olvidar('c');
  assert.equal(l.bloqueadoPor('c'), 0);
});

test('feriadoNombre: acepta los feriados oficiales y rechaza HTML', () => {
  for (const n of ['Año Nuevo (1.° de enero)', 'Jueves Santo', 'Día de Juan Santamaría (11 de abril)', 'Día de la Independencia (15 de setiembre)', 'Navidad (25 de diciembre)', 'Feriado 1/2 - prueba, ñandú']) {
    assert.match(n, FERIADO_REGEX, n);
  }
  for (const n of ['<img src=x onerror=alert(1)>', '"><script>', "a' or 1=1", 'x&amp;', 'a;b', 'a\nb']) {
    assert.doesNotMatch(n, FERIADO_REGEX, n);
  }
});

const colillaBase = { empleadoId: 1, periodoInicio: '2026-10-01', periodoFin: '2026-10-15' };

test('colilla: topes de horas y días', () => {
  assert.equal(validar(colillaSchema, { ...colillaBase, horasExtra: 400, diasVacaciones: 31 }).ok, true);
  for (const mal of [{ horasExtra: 401 }, { horasExtra: -1 }, { horasExtra: 'abc' }, { horasExtra: Infinity },
    { diasVacaciones: 32 }, { diasVacaciones: 1.5 }, { diasIncapacidad: -3 }, { horasSinGoce: {} }, { horasFeriado: [] }]) {
    const r = validar(colillaSchema, { ...colillaBase, ...mal });
    assert.equal(r.ok, false, JSON.stringify(mal));
    assert.match(r.error, /debe ser un número/);
  }
});

test('colilla: valores por defecto, texto numérico y fechas', () => {
  const r = validar(colillaSchema, { ...colillaBase, horasExtra: '2.5' });
  assert.equal(r.ok, true);
  assert.equal(r.datos.horasExtra, 2.5);
  assert.equal(r.datos.diasVacaciones, 0);
  assert.equal(r.datos.feriadoNombre, '');
  assert.equal(validar(colillaSchema, { ...colillaBase, periodoInicio: '2026-10-16' }).ok, false); // inicio > fin
  assert.equal(validar(colillaSchema, { ...colillaBase, periodoInicio: '2026-02-30' }).ok, false);
  assert.equal(validar(colillaSchema, { ...colillaBase, periodoInicio: '2026-01-01', periodoFin: '2026-12-31' }).ok, false); // rango
  assert.equal(validar(colillaSchema, { ...colillaBase, empleadoId: 'abc' }).ok, false);
  assert.equal(validar(colillaSchema, { ...colillaBase, empleadoId: -1 }).ok, false);
});

test('empleado: salario, correo, nombre, fecha y vacaciones', () => {
  const ok = { nombre: 'Ana Mora', correo: 'ana@ejemplo.cr', salario: 500000, fechaIngreso: '2024-01-01', vacacionesDisponibles: 3 };
  assert.equal(validar(empleadoCrearSchema, ok).ok, true);
  for (const mal of [{ salario: -5 }, { salario: 0 }, { salario: 'mucho' }, { salario: 1e12 }, { salario: Infinity },
    { fechaIngreso: '2999-01-01' }, { fechaIngreso: 'ayer' }, { fechaIngreso: '2024-02-31' },
    { correo: 'no-es-correo' }, { correo: 'a'.repeat(250) + '@x.cr' }, { nombre: 'A' }, { nombre: 'N'.repeat(121) },
    { vacacionesDisponibles: -1 }, { vacacionesDisponibles: 91 }, { vacacionesDisponibles: 'x' }]) {
    assert.equal(validar(empleadoCrearSchema, { ...ok, ...mal }).ok, false, JSON.stringify(mal).slice(0, 60));
  }
});
