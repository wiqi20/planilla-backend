// Integración: aislamiento entre empresas (S-08) y validación de reportes/parámetros restantes (N-03).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./soporte/servidor');

const opts = { skip: S.SIN_BASE };
let srv, A, B, empB, empA, colillaB, boletaB, reporteB, usuarioB2;
const periodo = { periodoInicio: '2026-09-01', periodoFin: '2026-09-15' };

test.before(async () => {
  if (S.SIN_BASE) return;
  await S.prepararEsquema();
  srv = await S.iniciarServidor();
  A = await S.crearEmpresa('ia');
  B = await S.crearEmpresa('ib');
  empA = await S.crearEmpleado(A.token);
  empB = await S.crearEmpleado(B.token);
  for (const [E, emp] of [[A, empA], [B, empB]]) {
    const c = await S.api('POST', '/api/colillas/guardar', { token: E.token, body: { empleadoId: emp.id, ...periodo, horasExtra: 4 } });
    assert.equal(c.status, 201, c.texto);
    if (E === B) colillaB = c.body;
  }
  const rep = await S.api('POST', '/api/reportes/generar', { token: B.token, body: periodo });
  assert.equal(rep.status, 201, rep.texto);
  reporteB = rep.body;
  const manana = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const bol = await S.api('POST', '/api/boletas/generar', { token: B.token, body: { empleadoId: empB.id, diasDisfrutar: 1, periodoInicio: manana, periodoFin: manana } });
  // si cae en domingo, probar el día siguiente
  boletaB = bol.status === 201 ? bol.body : (await S.api('POST', '/api/boletas/generar', { token: B.token, body: { empleadoId: empB.id, diasDisfrutar: 1,
    periodoInicio: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), periodoFin: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) } })).body;
  assert.ok(boletaB && boletaB.id, 'la boleta de B debe existir');
  const u = await S.api('POST', '/api/admin/usuarios', { token: B.token, body: { usuario: 'segundo', password: 'segundo-123' } });
  usuarioB2 = u.body;
  // A necesita 2 usuarios para que el borrado llegue a la comprobación de empresa (con 1 solo responde 400 por otra regla)
  assert.equal((await S.api('POST', '/api/admin/usuarios', { token: A.token, body: { usuario: 'otro-a', password: 'otro-a-1234' } })).status, 201);
});
test.after(async () => {
  if (srv) await srv.detener();
  if (!S.SIN_BASE) await S.limpiar();
});

test('A no puede leer, editar, borrar ni calcular recursos de B (siempre 404/403)', opts, async () => {
  const ok = (r, etiqueta) => assert.ok([403, 404].includes(r.status), `${etiqueta}: ${r.status} ${r.texto}`);
  const t = A.token;
  // colaborador de B
  ok(await S.api('PUT', `/api/empleados/${empB.id}`, { token: t, body: { nombre: 'Hackeado', salario: 1 } }), 'editar empleado');
  ok(await S.api('DELETE', `/api/empleados/${empB.id}`, { token: t }), 'borrar empleado');
  ok(await S.api('POST', '/api/colillas/calcular', { token: t, body: { empleadoId: empB.id, ...periodo } }), 'calcular colilla');
  ok(await S.api('POST', '/api/colillas/guardar', { token: t, body: { empleadoId: empB.id, ...periodo } }), 'guardar colilla');
  ok(await S.api('POST', '/api/boletas/generar', { token: t, body: { empleadoId: empB.id, diasDisfrutar: 1, periodoInicio: boletaB.periodo_inicio.slice(0, 10), periodoFin: boletaB.periodo_fin.slice(0, 10) } }), 'generar boleta');
  // boleta de B
  ok(await S.api('GET', `/api/boletas/${boletaB.id}/firma`, { token: t }), 'leer firma');
  ok(await S.api('PUT', `/api/boletas/${boletaB.id}`, { token: t, body: { diasDisfrutar: 1, periodoInicio: boletaB.periodo_inicio.slice(0, 10), periodoFin: boletaB.periodo_fin.slice(0, 10) } }), 'editar boleta');
  ok(await S.api('PUT', `/api/boletas/${boletaB.id}/firma`, { token: t, body: { firmaImagen: 'data:image/png;base64,AAAA' } }), 'firmar boleta');
  // usuarios de B
  ok(await S.api('PUT', `/api/admin/usuarios/${usuarioB2.id}`, { token: t, body: { password: 'hackeada-123' } }), 'cambiar clave');
  ok(await S.api('DELETE', `/api/admin/usuarios/${usuarioB2.id}`, { token: t }), 'borrar usuario');

  // listados de A no contienen nada de B
  const emps = await S.api('GET', '/api/empleados', { token: t });
  assert.ok(!emps.body.some((e) => e.id === empB.id));
  const cols = await S.api('GET', '/api/colillas', { token: t });
  assert.ok(!cols.body.some((c) => c.id === colillaB.id));
  assert.equal((await S.api('GET', `/api/colillas?empleadoId=${empB.id}`, { token: t })).body.length, 0);
  assert.equal((await S.api('GET', `/api/boletas?empleadoId=${empB.id}`, { token: t })).body.length, 0);
  const reps = await S.api('GET', '/api/reportes', { token: t });
  assert.ok(!reps.body.some((r) => r.id === reporteB.id));
  const us = await S.api('GET', '/api/admin/usuarios', { token: t });
  assert.ok(!us.body.some((u) => u.id === usuarioB2.id));
  // un reporte de A para el mismo período no incluye a B
  const repA = await S.api('POST', '/api/reportes/generar', { token: t, body: periodo });
  assert.equal(repA.status, 201);
  assert.ok(repA.body.datos.filas.every((f) => f.empleadoId !== empB.id));
  assert.equal(repA.body.datos.filas.length, 1);

  // B sigue intacto
  const bEmps = await S.api('GET', '/api/empleados', { token: B.token });
  assert.equal(bEmps.body.find((e) => e.id === empB.id).nombre, 'Persona de Prueba');
  assert.equal((await S.api('GET', '/api/admin/usuarios', { token: B.token })).body.length, 2);
});

test('N-03: reportes/generar valida las fechas (400, nunca 500)', opts, async () => {
  for (const mal of [{ periodoInicio: 'abc', periodoFin: 'abc' }, { periodoInicio: 123, periodoFin: 456 }, { periodoInicio: [1], periodoFin: { a: 1 } },
    { periodoInicio: '2026-02-30', periodoFin: '2026-03-01' }, { periodoInicio: '2026-09-16', periodoFin: '2026-09-01' },
    { periodoInicio: '2020-01-01', periodoFin: '2026-12-31' }, { periodoInicio: true, periodoFin: true }, { periodoInicio: '2026-09-01' }]) {
    const r = await S.api('POST', '/api/reportes/generar', { token: A.token, body: mal });
    assert.equal(r.status, 400, JSON.stringify(mal));
    assert.equal(typeof r.body.error, 'string');
  }
  assert.equal((await S.api('POST', '/api/reportes/generar', { token: A.token, body: periodo })).status, 201);
});

test('otras rutas: entradas de tipo equivocado dan 400/404, nunca 500', opts, async () => {
  const prov = { 'x-provision-secret': S.PROVISION_SECRET };
  const casos = [
    ['PUT', '/api/admin/empresa', A.token, { nombre: { a: 1 }, correoAdmin: ['x'] }, {}],
    ['PUT', '/api/admin/empresa', A.token, { nombre: 'x'.repeat(500) }, {}],
    ['PUT', `/api/admin/usuarios/${A.usuarioId}`, A.token, { usuario: { a: 1 } }, {}],
    ['PUT', `/api/admin/usuarios/${A.usuarioId}`, A.token, { password: { a: 1 } }, {}],
    ['POST', '/api/admin/usuarios', A.token, { usuario: { a: 1 }, password: '12345678' }, {}],
    ['POST', '/api/admin/usuarios', A.token, { usuario: 'zz', password: { a: 1 } }, {}],
    ['POST', '/api/boletas/generar', A.token, { empleadoId: { a: 1 }, diasDisfrutar: 1 }, {}],
    ['POST', '/api/boletas/generar', A.token, { empleadoId: empA.id, diasDisfrutar: { a: 1 }, periodoInicio: [], periodoFin: {} }, {}],
    ['PUT', `/api/boletas/${boletaB.id}/firma`, A.token, { firmaImagen: 5 }, {}],
    ['GET', '/api/boletas?periodoInicio=hola', A.token, undefined, {}],
    ['POST', '/api/provision/admin', null, { subdominio: 'x', stripeSubscriptionId: 'y', usuario: 'abc', password: { a: 1 } }, prov],
    ['POST', '/api/provision/admin', null, { subdominio: { a: 1 }, stripeSubscriptionId: [], usuario: 'abc', password: '12345678' }, prov],
    ['POST', '/api/provision/empresa', null, { nombreEmpresa: { a: 1 }, subdominio: 'abc123', stripeSubscriptionId: 'z' }, prov],
    ['POST', '/api/provision/estado', null, { stripeSubscriptionId: { a: 1 }, activa: true }, prov],
    ['POST', '/api/colillas/calcular', A.token, [], {}],
    ['POST', '/api/empleados', A.token, 'texto', {}]
  ];
  for (const [m, ruta, token, body, headers] of casos) {
    const r = await S.api(m, ruta, { token, body, headers });
    assert.ok(r.status >= 400 && r.status < 500, `${m} ${ruta} ${JSON.stringify(body)} -> ${r.status} ${r.texto}`);
  }
});
