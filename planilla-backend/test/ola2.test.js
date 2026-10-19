// Ola 2: formato de error, byte NUL (N-11), sesiones que se invalidan al cambiar la contraseña (S-05) y /health.
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const S = require('./soporte/servidor');

const opts = { skip: S.SIN_BASE };
const JWT_SECRET = 'jwt-de-pruebas-no-es-un-secreto-real';
const NUL = '\u0000';
let srv, A;

test.before(async () => {
  if (S.SIN_BASE) return;
  await S.prepararEsquema();
  srv = await S.iniciarServidor();
  A = await S.crearEmpresa('a');
});
test.after(async () => {
  if (srv) await srv.detener();
  if (!S.SIN_BASE) await S.limpiar();
});

const ip = () => ({ 'X-Forwarded-For': S.ipFalsa() });
const prov = { 'x-provision-secret': S.PROVISION_SECRET };

function formatoOk(r, estado, errorEsperado) {
  assert.equal(r.status, estado, r.texto);
  assert.equal(typeof r.body.error, 'string', r.texto);
  assert.equal(typeof r.body.mensaje, 'string', r.texto);
  assert.ok(r.body.mensaje.length > 5, r.texto);
  if (errorEsperado) assert.equal(r.body.error, errorEsperado);
}

// ---------- Formato de error ----------

test('todo error trae { error, mensaje } y `error` conserva el texto de siempre', opts, async () => {
  formatoOk(await S.api('GET', '/api/empleados'), 401, 'No autenticado');
  formatoOk(await S.api('GET', '/api/empleados', { token: 'basura' }), 401, 'Sesión inválida o expirada');
  formatoOk(await S.api('POST', '/api/auth/login', { headers: ip(), body: {} }), 400, 'Faltan campos requeridos');
  formatoOk(await S.api('POST', '/api/auth/login', { headers: ip(), body: { subdominio: 'x', usuario: 'y', password: 5 } }), 400,
    'Empresa, usuario y contraseña deben ser texto');
  formatoOk(await S.api('POST', '/api/auth/login', { headers: ip(), body: { subdominio: A.subdominio, usuario: A.usuario, password: 'mala-clave-1' } }), 401,
    'Empresa, usuario o contraseña incorrectos');
  formatoOk(await S.api('POST', '/api/auth/registrar-empresa', { body: {} }), 403, 'El registro público está desactivado');
  formatoOk(await S.api('POST', '/api/provision/empresa', { body: {} }), 403, 'No autorizado');
  formatoOk(await S.api('POST', '/api/provision/estado', { headers: prov, body: {} }), 400);
  formatoOk(await S.api('POST', '/api/provision/estado', { headers: prov, body: { stripeSubscriptionId: 'no-existe', activa: true } }), 404);
  formatoOk(await S.api('PUT', '/api/empleados/999999', { token: A.token, body: {} }), 404, 'Colaborador no encontrado');
  formatoOk(await S.api('POST', '/api/empleados', { token: A.token, body: { nombre: 'x' } }), 400, 'Faltan campos requeridos');
  formatoOk(await S.api('POST', '/api/colillas/calcular', { token: A.token, body: { empleadoId: 'abc', periodoInicio: '2026-10-01', periodoFin: '2026-10-15' } }), 400);
  formatoOk(await S.api('POST', '/api/reportes/generar', { token: A.token, body: { periodoInicio: '2026-10-01', periodoFin: '2026-10-15' } }), 404);
  formatoOk(await S.api('GET', '/api/boletas/999999/firma', { token: A.token }), 404, 'Boleta no encontrada');
  formatoOk(await S.api('DELETE', '/api/admin/usuarios/999999', { token: A.token }), 400); // último administrador
});

test('JSON mal formado, cuerpo enorme y rutas inexistentes también usan el formato único', opts, async () => {
  formatoOk(await S.api('POST', '/api/auth/login', { crudo: '{"a":' }), 400, 'El cuerpo de la petición no es un JSON válido');
  formatoOk(await S.api('POST', '/api/auth/login', { crudo: JSON.stringify({ x: 'a'.repeat(200000) }) }), 413, 'El cuerpo de la petición es demasiado grande');
  formatoOk(await S.api('GET', '/api/no-existe'), 404, 'Ruta no encontrada');
  formatoOk(await S.api('POST', '/nada'), 404, 'Ruta no encontrada');
});

test('los campos extra de antes se conservan (codigo, vacacionesDisponibles, faltantes)', opts, async () => {
  const B = await S.crearEmpresa('b');
  await S.api('POST', '/api/provision/estado', { headers: prov, body: { stripeSubscriptionId: B.sub, activa: false } });
  const l = await S.api('POST', '/api/auth/login', { headers: ip(), body: { subdominio: B.subdominio, usuario: B.usuario, password: B.password } });
  formatoOk(l, 403);
  assert.equal(l.body.codigo, 'suspendida');
  const t = await S.api('GET', '/api/empleados', { token: B.token });
  formatoOk(t, 403);
  assert.equal(t.body.codigo, 'suspendida');
  const ya = await S.api('POST', '/api/provision/admin', { headers: prov, body: { subdominio: A.subdominio, stripeSubscriptionId: A.sub, usuario: 'otro-admin', password: 'clave-de-prueba-1' } });
  formatoOk(ya, 409);
  assert.equal(ya.body.codigo, 'ya-configurada');
  const emp = await S.crearEmpleado(A.token);
  const v = await S.api('POST', '/api/colillas/calcular', { token: A.token, body: { empleadoId: emp.id, periodoInicio: '2026-10-01', periodoFin: '2026-10-15', diasVacaciones: 30 } });
  formatoOk(v, 400);
  assert.equal(typeof v.body.vacacionesDisponibles, 'number');
});

// ---------- N-11: byte NUL ----------

test('N-11: un byte NUL en cualquier texto da 400 y nunca 500', opts, async () => {
  const empleado = await S.crearEmpleado(A.token);
  const casos = [
    ['POST', '/api/auth/login', { headers: ip(), body: { subdominio: A.subdominio, usuario: `a${NUL}b`, password: 'clave-de-prueba-1' } }],
    ['POST', '/api/auth/login', { headers: ip(), body: { subdominio: `a${NUL}`, usuario: 'x', password: 'clave-de-prueba-1' } }],
    ['POST', '/api/auth/login', { headers: ip(), body: { subdominio: A.subdominio, usuario: 'x', password: `clave${NUL}1234` } }],
    ['POST', '/api/admin/usuarios', { token: A.token, body: { usuario: `n${NUL}`, password: 'clave-larga-123' } }],
    ['PUT', `/api/admin/usuarios/${A.usuarioId}`, { token: A.token, body: { usuario: `n${NUL}` } }],
    ['PUT', '/api/admin/empresa', { token: A.token, body: { nombre: `Empresa${NUL}`, correoAdmin: null } }],
    ['POST', '/api/provision/empresa', { headers: prov, body: { nombreEmpresa: `X${NUL}Y`, subdominio: 'o1tnul', stripeSubscriptionId: 'sub_nul' } }],
    ['POST', '/api/provision/empresa', { headers: prov, body: { nombreEmpresa: 'Nombre ok', subdominio: 'o1tnul', stripeSubscriptionId: `sub${NUL}` } }],
    ['POST', '/api/provision/estado', { headers: prov, body: { stripeSubscriptionId: `s${NUL}`, activa: true } }],
    ['POST', '/api/empleados', { token: A.token, body: { nombre: `Ana${NUL}`, correo: 'nul@ejemplo.cr', salario: 1000, fechaIngreso: '2020-01-01' } }],
    ['PUT', `/api/empleados/${empleado.id}`, { token: A.token, body: { correo: `a${NUL}@ejemplo.cr` } }],
    ['POST', '/api/colillas/guardar', { token: A.token, body: { empleadoId: empleado.id, periodoInicio: '2026-10-01', periodoFin: '2026-10-15', horasFeriado: 2, feriadoNombre: `Feriado${NUL}` } }],
    ['PUT', '/api/boletas/1/firma', { token: A.token, body: { firmaImagen: `data:image/png;base64,AAA${NUL}` } }],
    ['POST', '/api/empleados', { token: A.token, crudo: '{"nombre":"x\\u0000y","correo":"a@b.cr","salario":1,"fechaIngreso":"2020-01-01"}' }],
    ['POST', '/api/empleados', { token: A.token, crudo: '{"campo\\u0000raro":1}' }],
    ['POST', '/api/empleados', { token: A.token, body: { anidado: [{ profundo: { x: `a${NUL}` } }] } }],
    ['GET', '/api/auth/subdominio-disponible?valor=a%00b', {}],
    ['GET', '/api/provision/subdominio-disponible?valor=a%00b', { headers: prov }],
    ['GET', '/api/colillas?periodoInicio=2026-10-01%00', { token: A.token }],
    ['GET', '/api/empleados/%00', { token: A.token }],
    ['GET', '/api/boletas?empleadoId=1%00', { token: A.token }]
  ];
  for (const [metodo, ruta, o] of casos) {
    const r = await S.api(metodo, ruta, o);
    assert.equal(r.status, 400, `${metodo} ${ruta} => ${r.status} ${r.texto}`);
    formatoOk(r, 400);
  }
  // Nada se guardó por el camino.
  const lista = await S.api('GET', '/api/empleados', { token: A.token });
  assert.ok(!lista.body.some((e) => /nul|Ana\u0000/.test(e.correo)));
  assert.equal(srv.salida().includes('Error no manejado'), false, 'el servidor no debe registrar errores no manejados');
});

test('N-11: un NUL no vuelve a consumir el límite de login ni tumba el servidor', opts, async () => {
  const ipFija = S.ipFalsa();
  for (let i = 0; i < 15; i++) {
    const r = await S.api('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': ipFija }, body: { subdominio: A.subdominio, usuario: `x${NUL}`, password: 'zzzzzzzzz' } });
    assert.equal(r.status, 400);
  }
  const ok = await S.api('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': ipFija }, body: { subdominio: A.subdominio, usuario: A.usuario, password: A.password } });
  assert.equal(ok.status, 200);
});

// ---------- S-05: cambiar la contraseña invalida las sesiones ----------

async function crearSegundoUsuario(nombre) {
  const password = 'segunda-clave-1';
  const c = await S.api('POST', '/api/admin/usuarios', { token: A.token, body: { usuario: nombre, password } });
  assert.equal(c.status, 201, c.texto);
  const l = await S.api('POST', '/api/auth/login', { headers: ip(), body: { subdominio: A.subdominio, usuario: nombre, password } });
  assert.equal(l.status, 200, l.texto);
  return { id: c.body.id, usuario: nombre, password, token: l.body.token };
}

test('S-05: el administrador cambia la contraseña de otro usuario y los tokens anteriores de ese usuario dejan de servir', opts, async () => {
  const u = await crearSegundoUsuario('segundo' + Date.now() % 100000);
  const segundoToken = (await S.api('POST', '/api/auth/login', { headers: ip(), body: { subdominio: A.subdominio, usuario: u.usuario, password: u.password } })).body.token;
  assert.equal((await S.api('GET', '/api/empleados', { token: u.token })).status, 200);

  const cambio = await S.api('PUT', `/api/admin/usuarios/${u.id}`, { token: A.token, body: { password: 'clave-nueva-123' } });
  assert.equal(cambio.status, 200, cambio.texto);
  assert.equal(cambio.body.token, undefined, 'solo se entrega token nuevo a quien cambia su propia clave');
  assert.equal(cambio.body.token_version, undefined, 'el contador no se expone');

  for (const viejo of [u.token, segundoToken]) {
    formatoOk(await S.api('GET', '/api/empleados', { token: viejo }), 401, 'Sesión inválida o expirada');
  }
  // La sesión del administrador que hizo el cambio sigue valiendo, y la clave nueva abre una sesión nueva.
  assert.equal((await S.api('GET', '/api/empleados', { token: A.token })).status, 200);
  const nuevo = await S.api('POST', '/api/auth/login', { headers: ip(), body: { subdominio: A.subdominio, usuario: u.usuario, password: 'clave-nueva-123' } });
  assert.equal(nuevo.status, 200);
  assert.equal((await S.api('GET', '/api/empleados', { token: nuevo.body.token })).status, 200);
  // La clave vieja ya no entra.
  assert.equal((await S.api('POST', '/api/auth/login', { headers: ip(), body: { subdominio: A.subdominio, usuario: u.usuario, password: u.password } })).status, 401);
});

test('S-05: quien cambia su propia contraseña recibe un token nuevo y el anterior deja de servir', opts, async () => {
  const B = await S.crearEmpresa('s05');
  const r = await S.api('PUT', `/api/admin/usuarios/${B.usuarioId}`, { token: B.token, body: { password: 'otra-clave-1234' } });
  assert.equal(r.status, 200, r.texto);
  assert.equal(typeof r.body.token, 'string');
  assert.equal(r.body.usuario, B.usuario);
  assert.equal((await S.api('GET', '/api/empleados', { token: B.token })).status, 401);
  assert.equal((await S.api('GET', '/api/empleados', { token: r.body.token })).status, 200);
  // Cambiar solo el nombre no cierra sesiones.
  const n = await S.api('PUT', `/api/admin/usuarios/${B.usuarioId}`, { token: r.body.token, body: { usuario: B.usuario + 'x' } });
  assert.equal(n.status, 200);
  assert.equal(n.body.token, undefined);
  assert.equal((await S.api('GET', '/api/empleados', { token: r.body.token })).status, 200);
});

test('S-05: un token emitido antes de la migración (sin "tv") sigue valiendo hasta que se cambie la contraseña', opts, async () => {
  const B = await S.crearEmpresa('legado');
  const legado = jwt.sign({ empresaId: B.empresaId, usuarioId: B.usuarioId, usuario: B.usuario }, JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await S.api('GET', '/api/empleados', { token: legado })).status, 200);
  // Un token con una versión distinta a la del usuario no sirve (ni mayor ni menor).
  for (const tv of [1, 5, -1, '0', 0.5]) {
    const t = jwt.sign({ empresaId: B.empresaId, usuarioId: B.usuarioId, usuario: B.usuario, tv }, JWT_SECRET, { expiresIn: '1h' });
    assert.equal((await S.api('GET', '/api/empleados', { token: t })).status, 401, `tv=${JSON.stringify(tv)}`);
  }
  const cambio = await S.api('PUT', `/api/admin/usuarios/${B.usuarioId}`, { token: B.token, body: { password: 'clave-despues-1' } });
  assert.equal(cambio.status, 200);
  assert.equal((await S.api('GET', '/api/empleados', { token: legado })).status, 401);
});

test('S-05: el algoritmo del token está fijado (HS512 y alg=none se rechazan)', opts, async () => {
  const base = { empresaId: A.empresaId, usuarioId: A.usuarioId, usuario: A.usuario, tv: 0 };
  const hs512 = jwt.sign(base, JWT_SECRET, { algorithm: 'HS512', expiresIn: '1h' });
  assert.equal((await S.api('GET', '/api/empleados', { token: hs512 })).status, 401);
  const none = jwt.sign(base, '', { algorithm: 'none' });
  assert.equal((await S.api('GET', '/api/empleados', { token: none })).status, 401);
});

test('S-05: cambiar la contraseña de un usuario no afecta a los de otra empresa', opts, async () => {
  const B = await S.crearEmpresa('aisl');
  const C = await S.crearEmpresa('aisl2');
  // El administrador de B intenta cambiar el usuario de C: 404 y C sigue entrando.
  const r = await S.api('PUT', `/api/admin/usuarios/${C.usuarioId}`, { token: B.token, body: { password: 'intento-ajeno-123' } });
  assert.equal(r.status, 404);
  assert.equal((await S.api('GET', '/api/empleados', { token: C.token })).status, 200);
});

// ---------- /health ----------

test('/health: 200 { estado: "ok" } con la base viva, sin sesión y sin límite de intentos', opts, async () => {
  for (let i = 0; i < 60; i++) {
    const r = await S.api('GET', '/health', { headers: { 'X-Forwarded-For': '10.99.99.99' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { estado: 'ok' });
  }
  const r = await S.api('GET', '/health');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(r.texto, /postgres|localhost|5532|version/i);
});

test('/health: 503 sin datos sensibles cuando la base no responde', opts, async () => {
  await srv.detener();
  // Servidor con una base inalcanzable (puerto cerrado) y sin migrar al arrancar: debe levantar y decir 503.
  const roto = await S.iniciarServidor({ DATABASE_URL: 'postgresql://secreto:clavesecreta@localhost:1/base_secreta_test', MIGRAR_AL_ARRANCAR: 'false' }, { esperarOk: false });
  try {
    const r = await S.api('GET', '/health');
    assert.equal(r.status, 503);
    formatoOk(r, 503);
    assert.equal(r.body.estado, 'sin-base');
    assert.doesNotMatch(r.texto, /secreto|clavesecreta|base_secreta|ECONNREFUSED|localhost/i);
  } finally {
    await roto.detener();
    srv = await S.iniciarServidor();
  }
});
