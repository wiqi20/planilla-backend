// Integración: validación de entradas en la API real (puntos 1, 3 y parte del 2 de la Ola 1).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./soporte/servidor');

const opts = { skip: S.SIN_BASE };
let srv, A, emp;

test.before(async () => {
  if (S.SIN_BASE) return;
  await S.prepararEsquema();
  srv = await S.iniciarServidor();
  A = await S.crearEmpresa('a');
  emp = await S.crearEmpleado(A.token);
});
test.after(async () => {
  if (srv) await srv.detener();
  if (!S.SIN_BASE) await S.limpiar();
});

const colilla = (extra = {}) => ({ empleadoId: emp.id, periodoInicio: '2026-10-01', periodoFin: '2026-10-15', ...extra });

for (const ruta of ['calcular', 'guardar']) {
  test(`XSS almacenado: feriadoNombre con HTML da 400 en ${ruta}`, opts, async () => {
    for (const nombre of ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '"><svg/onload=1>', 'x'.repeat(61)]) {
      const r = await S.api('POST', `/api/colillas/${ruta}`, { token: A.token, body: colilla({ horasFeriado: 4, feriadoNombre: nombre }) });
      assert.equal(r.status, 400, nombre);
      assert.match(r.body.error, /feriado/i);
    }
    const noTexto = await S.api('POST', `/api/colillas/${ruta}`, { token: A.token, body: colilla({ horasFeriado: 4, feriadoNombre: { a: 1 } }) });
    assert.equal(noTexto.status, 400);
  });

  test(`feriadoNombre legítimo (con ° y tildes) se acepta en ${ruta}`, opts, async () => {
    const r = await S.api('POST', `/api/colillas/${ruta}`, { token: A.token, body: colilla({
      periodoInicio: ruta === 'guardar' ? '2026-05-01' : '2026-10-01', periodoFin: ruta === 'guardar' ? '2026-05-15' : '2026-10-15',
      horasFeriado: 8, feriadoNombre: 'Día Internacional del Trabajo (1.° de mayo)' } ) });
    assert.ok(r.status === 200 || r.status === 201, r.texto);
  });

  test(`${ruta}: horas y días fuera de rango, negativos o no numéricos dan 400`, opts, async () => {
    for (const mal of [{ horasExtra: -5 }, { horasExtra: 401 }, { horasExtra: 'abc' }, { horasSinGoce: -1 },
      { diasVacaciones: -2 }, { diasVacaciones: 32 }, { diasVacaciones: 1.5 }, { diasIncapacidad: -1 }, { diasSinGoceCompletos: 9999 },
      { diasLicenciaMP: -1 }, { diasLicenciaCuido: 'x' }, { horasFeriado: -3 }]) {
      const r = await S.api('POST', `/api/colillas/${ruta}`, { token: A.token, body: colilla(mal) });
      assert.equal(r.status, 400, JSON.stringify(mal));
      assert.equal(typeof r.body.error, 'string');
    }
  });

  test(`${ruta}: fechas inválidas, invertidas o con rango enorme dan 400`, opts, async () => {
    for (const mal of [{ periodoInicio: '2026-10-16' }, { periodoInicio: '2026-02-30' }, { periodoFin: 'mañana' },
      { periodoInicio: '2026-01-01', periodoFin: '2026-12-31' }, { periodoInicio: 12345 }, { empleadoId: 'abc' }, { empleadoId: -1 }, { empleadoId: 1.5 }]) {
      const r = await S.api('POST', `/api/colillas/${ruta}`, { token: A.token, body: colilla(mal) });
      assert.equal(r.status, 400, JSON.stringify(mal));
    }
  });
}

test('GET /api/colillas?empleadoId=abc da 400 (no 500) y los filtros válidos funcionan', opts, async () => {
  for (const q of ['empleadoId=abc', 'empleadoId=-1', 'periodoInicio=hola', 'periodoFin=2026-99-99']) {
    const r = await S.api('GET', `/api/colillas?${q}`, { token: A.token });
    assert.equal(r.status, 400, q);
  }
  const ok = await S.api('GET', `/api/colillas?empleadoId=${emp.id}`, { token: A.token });
  assert.equal(ok.status, 200);
});

test('GET /api/boletas?empleadoId=abc y ids de ruta no numéricos no dan 500', opts, async () => {
  assert.equal((await S.api('GET', '/api/boletas?empleadoId=abc', { token: A.token })).status, 400);
  assert.equal((await S.api('GET', '/api/empleados/abc', { token: A.token, headers: {} })).status, 404);
  assert.equal((await S.api('PUT', '/api/empleados/abc', { token: A.token, body: { nombre: 'Zeta' } })).status, 404);
  assert.equal((await S.api('DELETE', '/api/empleados/abc', { token: A.token })).status, 404);
  assert.equal((await S.api('DELETE', '/api/admin/usuarios/abc', { token: A.token })).status, 404);
  assert.equal((await S.api('PUT', '/api/boletas/abc', { token: A.token, body: {} })).status, 404);
});

test('colilla guardada correctamente conserva el cálculo', opts, async () => {
  const r = await S.api('POST', '/api/colillas/guardar', { token: A.token, body: colilla({ horasExtra: 10, diasVacaciones: 2 }) });
  assert.equal(r.status, 201, r.texto);
  assert.equal(r.body.datos.horasExtra, 10);
  assert.equal(r.body.datos.feriadoNombre, '');
});

test('empleados: crear con datos inválidos da 400', opts, async () => {
  const ok = { nombre: 'Ana Mora', correo: 'ana.valida@ejemplo.cr', salario: 500000, fechaIngreso: '2024-01-01', vacacionesDisponibles: 3 };
  for (const mal of [{ salario: -100 }, { salario: 'texto' }, { salario: 1e12 }, { fechaIngreso: '2999-01-01' }, { fechaIngreso: 'x' },
    { correo: 'sin-arroba' }, { correo: 'a'.repeat(300) + '@x.cr' }, { nombre: 'N'.repeat(500) }, { nombre: 123 },
    { vacacionesDisponibles: -4 }, { vacacionesDisponibles: 5000 }]) {
    const r = await S.api('POST', '/api/empleados', { token: A.token, body: { ...ok, ...mal } });
    assert.equal(r.status, 400, JSON.stringify(mal).slice(0, 80));
    assert.equal(typeof r.body.error, 'string');
  }
  const bueno = await S.api('POST', '/api/empleados', { token: A.token, body: ok });
  assert.equal(bueno.status, 201, bueno.texto);
});

test('empleados: editar con datos inválidos da 400 y con datos válidos funciona', opts, async () => {
  for (const mal of [{ salario: -1 }, { salario: 0 }, { fechaIngreso: '2999-12-31' }, { correo: 'x' }, { vacacionesDisponibles: -1 }, { vacacionesDisponibles: 91 }, { activo: 'si' }]) {
    const r = await S.api('PUT', `/api/empleados/${emp.id}`, { token: A.token, body: mal });
    assert.equal(r.status, 400, JSON.stringify(mal));
  }
  const ok = await S.api('PUT', `/api/empleados/${emp.id}`, { token: A.token, body: { salario: 950000, nombre: 'Persona Editada' } });
  assert.equal(ok.status, 200, ok.texto);
  assert.equal(Number(ok.body.salario), 950000);
});

test('JSON malformado en cualquier ruta da 400 en español (no 500)', opts, async () => {
  const rutas = [
    ['POST', '/api/auth/login', null], ['POST', '/api/empleados', A.token], ['PUT', `/api/empleados/${emp.id}`, A.token],
    ['POST', '/api/colillas/calcular', A.token], ['POST', '/api/admin/usuarios', A.token],
    ['POST', '/api/provision/empresa', null], ['POST', '/api/provision/estado', null]
  ];
  for (const [metodo, ruta, token] of rutas) {
    const headers = ruta.includes('provision') ? { 'x-provision-secret': S.PROVISION_SECRET } : {};
    const r = await S.api(metodo, ruta, { token, headers, crudo: '{"a": ' });
    assert.equal(r.status, 400, `${metodo} ${ruta}`);
    assert.match(r.body.error, /JSON/);
  }
});

test('contraseña mínima de 8 caracteres al crear y cambiar usuarios', opts, async () => {
  const corta = await S.api('POST', '/api/admin/usuarios', { token: A.token, body: { usuario: 'nuevo1', password: '1234567' } });
  assert.equal(corta.status, 400);
  assert.match(corta.body.error, /8 caracteres/);
  const ok = await S.api('POST', '/api/admin/usuarios', { token: A.token, body: { usuario: 'nuevo1', password: '12345678' } });
  assert.equal(ok.status, 201, ok.texto);
  const cambioCorto = await S.api('PUT', `/api/admin/usuarios/${ok.body.id}`, { token: A.token, body: { password: 'abc' } });
  assert.equal(cambioCorto.status, 400);
  const cambioOk = await S.api('PUT', `/api/admin/usuarios/${ok.body.id}`, { token: A.token, body: { password: 'abcdefgh' } });
  assert.equal(cambioOk.status, 200);
  // sin contraseña en el cuerpo, solo se renombra
  const renombre = await S.api('PUT', `/api/admin/usuarios/${ok.body.id}`, { token: A.token, body: { usuario: 'nuevo1b' } });
  assert.equal(renombre.status, 200);
});
