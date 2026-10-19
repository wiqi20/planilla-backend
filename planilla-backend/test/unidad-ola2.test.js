// Unidad (sin base ni servidor): N-12, apagado ordenado, tiempo máximo de /health y formato de error.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { crearLimitador } = require('../src/limiteIntentos');
const { crearCierre } = require('../src/cierre');
const { crearSalud } = require('../src/salud');
const { formatoError, contieneNul, mensajeDe, manejadorErrores } = require('../src/errores');

// ---------- N-12 ----------
test('N-12: devolver es idempotente, aunque se repita muchas veces y a la vez', async () => {
  const l = crearLimitador({ max: 100, ventanaMs: 60000 });
  const ajenas = Array.from({ length: 49 }, () => l.reservar('k'));
  const mia = l.reservar('k'); // 50 reservas en total
  await Promise.all(Array.from({ length: 200 }, async () => l.devolver('k', mia)));
  // Solo se descontó UNA: quedan 49. Con 51 reservas más llegaría a 100 y bloquearía; con la fuga anterior ya habría bloqueado antes.
  for (let i = 0; i < 50; i++) l.reservar('k');
  assert.equal(l.bloqueadoPor('k'), 0, 'con 99 reservas vivas aún no debe bloquear');
  l.reservar('k');
  assert.ok(l.bloqueadoPor('k') > 0, 'la 100.ª reserva viva sí bloquea: no se descontó de más');
  assert.equal(ajenas.length, 49);
});

test('N-12: cada recibo es propio; devolver uno no deshace el de otra reserva', () => {
  const l = crearLimitador({ max: 2, ventanaMs: 60000 });
  const r1 = l.reservar('k'); const r2 = l.reservar('k');
  assert.notEqual(r1, r2);
  l.devolver('k', r1); l.devolver('k', r1); l.devolver('k', r1);
  assert.equal(l.bloqueadoPor('k'), 0);
  l.reservar('k'); // r2 sigue viva + esta = 2
  assert.ok(l.bloqueadoPor('k') > 0);
  l.devolver('k', r2);
  assert.equal(l.bloqueadoPor('k'), 0);
  l.devolver('k', undefined); l.devolver('k', null); l.devolver('otra', r1); // entradas raras: sin efecto ni error
});

// ---------- Apagado ordenado ----------
function servidorLento(demoraMs) {
  const servidor = http.createServer((req, res) => {
    setTimeout(() => { res.end('listo'); }, demoraMs);
  });
  return new Promise((resolve) => servidor.listen(0, '127.0.0.1', () => resolve(servidor)));
}
const puerto = (s) => s.address().port;

test('cierre: termina la petición en curso, rechaza las nuevas y cierra el pool una sola vez', async () => {
  const servidor = await servidorLento(300);
  let cierres = 0; let log = [];
  const cierre = crearCierre({ servidor, pool: { end: async () => { cierres++; } }, timeoutMs: 5000, log: (...a) => log.push(a.join(' ')) });
  const url = `http://127.0.0.1:${puerto(servidor)}/`; // el puerto se lee antes: tras cerrar ya no hay dirección
  const enCurso = fetch(url).then((r) => r.text());
  await new Promise((r) => setTimeout(r, 50));
  const p1 = cierre.cerrar('SIGTERM'); const p2 = cierre.cerrar('SIGTERM');
  assert.equal(p1, p2, 'llamar dos veces devuelve la misma promesa');
  assert.equal(cierre.estaCerrando(), true);
  await assert.rejects(fetch(url), 'ya no acepta conexiones nuevas');
  assert.equal(await enCurso, 'listo', 'la petición en curso termina bien');
  assert.deepEqual(await p1, { forzado: false });
  assert.equal(cierres, 1);
});

test('cierre: si una petición no termina, pasado el tope se corta y aun así se cierra el pool', async () => {
  const servidor = await servidorLento(60000);
  let cierres = 0;
  const cierre = crearCierre({ servidor, pool: { end: async () => { cierres++; } }, timeoutMs: 200, log: () => {} });
  const colgada = fetch(`http://127.0.0.1:${puerto(servidor)}/`).then(() => 'terminó', () => 'cortada');
  await new Promise((r) => setTimeout(r, 50));
  const t0 = Date.now();
  assert.deepEqual(await cierre.cerrar('SIGINT'), { forzado: true });
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(await colgada, 'cortada');
  assert.equal(cierres, 1);
});

test('cierre: un fallo al cerrar el pool no impide terminar', async () => {
  const servidor = await servidorLento(0);
  const cierre = crearCierre({ servidor, pool: { end: async () => { throw new Error('boom'); } }, timeoutMs: 1000, log: () => {} });
  assert.deepEqual(await cierre.cerrar('SIGTERM'), { forzado: false });
});

// ---------- /health ----------
function llamarSalud(salud) {
  return new Promise((resolve) => {
    const res = { headers: {}, statusCode: 200, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
    formatoError({}, res, () => {});
    salud({}, res);
  });
}

test('/health: ok, base caída, base lenta (tiempo máximo) y apagando', async () => {
  assert.deepEqual(await llamarSalud(crearSalud({ consultar: async () => ({}) })), { status: 200, body: { estado: 'ok' } });

  const caida = await llamarSalud(crearSalud({ consultar: async () => { throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' }); } }));
  assert.equal(caida.status, 503);
  assert.equal(caida.body.estado, 'sin-base');
  assert.doesNotMatch(JSON.stringify(caida.body), /10\.0\.0\.5|ECONNREFUSED/);

  const t0 = Date.now();
  const lenta = await llamarSalud(crearSalud({ consultar: () => new Promise(() => {}), timeoutMs: 100 }));
  assert.equal(lenta.status, 503);
  assert.ok(Date.now() - t0 < 1500, 'respondió dentro del tiempo máximo');

  const apagando = await llamarSalud(crearSalud({ consultar: async () => ({}), estaCerrando: () => true }));
  assert.equal(apagando.status, 503);
  assert.equal(apagando.body.estado, 'apagando');
});

// ---------- Errores ----------
test('contieneNul revisa valores, claves y estructuras anidadas', () => {
  assert.equal(contieneNul('a\u0000b'), true);
  assert.equal(contieneNul({ a: { b: ['x', { c: 'y\u0000' }] } }), true);
  assert.equal(contieneNul({ 'k\u0000': 1 }), true);
  assert.equal(contieneNul({ a: 'normal', n: 5, ok: true, nada: null, lista: [1, 'dos'] }), false);
  assert.equal(contieneNul(undefined), false);
});

test('formatoError agrega "mensaje" a cualquier error sin tocar "error" ni los campos extra, y no a las respuestas buenas', async () => {
  const salida = [];
  const res = { statusCode: 400, json(b) { salida.push(b); return this; } };
  formatoError({}, res, () => {});
  res.json({ error: 'Faltan campos requeridos', codigo: 'x' });
  res.statusCode = 200; res.json({ error: 'esto no es un error HTTP' }); res.json({ ok: true });
  res.statusCode = 500; res.json({ error: 'Texto propio', mensaje: 'Ya traía mensaje' });
  assert.deepEqual(salida[0], { error: 'Faltan campos requeridos', mensaje: mensajeDe('Faltan campos requeridos'), codigo: 'x' });
  assert.deepEqual(salida[1], { error: 'esto no es un error HTTP' });
  assert.deepEqual(salida[2], { ok: true });
  assert.deepEqual(salida[3], { error: 'Texto propio', mensaje: 'Ya traía mensaje' });
});

// ---------- H-3: /health con una sola comprobación y resultado reutilizado ----------
test('/health: las llamadas simultáneas comparten una sola consulta y el resultado se reutiliza ~3 s', async () => {
  let consultas = 0; let t = 1000; let falla = false;
  let liberar;
  const consultar = () => { consultas++; return falla ? Promise.reject(new Error('x')) : new Promise((r) => { liberar = r; }); };
  const salud = crearSalud({ consultar, cacheMs: 3000, timeoutMs: 5000, ahora: () => t });

  const rafaga = Array.from({ length: 200 }, () => llamarSalud(salud));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(consultas, 1, 'ráfaga de 200: una sola consulta a la base');
  liberar();
  assert.ok((await Promise.all(rafaga)).every((r) => r.status === 200));

  t += 2000; // dentro de los 3 s: no consulta otra vez
  assert.equal((await llamarSalud(salud)).status, 200);
  assert.equal(consultas, 1);

  t += 1500; // ya pasaron más de 3 s: consulta otra vez (y ahora la base falla)
  falla = true;
  assert.equal((await llamarSalud(salud)).status, 503);
  assert.equal(consultas, 2);
  t += 1000; // el fallo también se reutiliza
  assert.equal((await llamarSalud(salud)).status, 503);
  assert.equal(consultas, 2);
  t += 3000;
  falla = false;
  const otra = llamarSalud(salud);
  await new Promise((r) => setTimeout(r, 10));
  liberar();
  assert.equal((await otra).status, 200, 'se recupera cuando la base vuelve');
  assert.equal(consultas, 3);
});

test('/health: «apagando» tiene prioridad sobre el resultado guardado', async () => {
  let cerrando = false;
  const salud = crearSalud({ consultar: async () => ({}), estaCerrando: () => cerrando });
  assert.equal((await llamarSalud(salud)).status, 200);
  cerrando = true;
  const r = await llamarSalud(salud);
  assert.equal(r.status, 503);
  assert.equal(r.body.estado, 'apagando');
});

// ---------- B1: conexiones keep-alive inactivas ----------
test('cierre: una conexión keep-alive que queda inactiva no retrasa el apagado', async () => {
  const servidor = await servidorLento(250);
  const agente = new http.Agent({ keepAlive: true });
  const url = `http://127.0.0.1:${puerto(servidor)}/`;
  const peticion = new Promise((resolve, rechazar) => {
    http.get(url, { agent: agente }, (res) => { res.resume(); res.on('end', resolve); }).on('error', rechazar);
  });
  await new Promise((r) => setTimeout(r, 50)); // la petición está en vuelo
  const cierre = crearCierre({ servidor, pool: { end: async () => {} }, timeoutMs: 8000, log: () => {} });
  const t0 = Date.now();
  const cerrado = cierre.cerrar('SIGTERM');
  await peticion; // termina bien; su conexión queda abierta (keep-alive) pero inactiva
  assert.deepEqual(await cerrado, { forzado: false });
  assert.ok(Date.now() - t0 < 2000, `tardó ${Date.now() - t0} ms: no debe esperar el tiempo de inactividad (varios segundos)`);
  agente.destroy();
});

// ---------- B2: respaldo de los códigos de Postgres del byte NUL ----------
test('manejadorErrores: los códigos 22021 y 22P05 de Postgres son 400; cualquier otro error de datos sigue siendo 500', () => {
  const llamar = (err) => {
    let salida;
    const res = { headersSent: false, statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { salida = { status: this.statusCode, body: b }; return this; } };
    const silencio = console.error; console.error = () => {};
    try { manejadorErrores(err, {}, res, () => {}); } finally { console.error = silencio; }
    return salida;
  };
  for (const code of ['22021', '22P05']) {
    const r = llamar(Object.assign(new Error('detalle interno de postgres'), { code }));
    assert.equal(r.status, 400, code);
    assert.equal(typeof r.body.mensaje, 'string');
    assert.doesNotMatch(JSON.stringify(r.body), /postgres|detalle/i);
  }
  for (const code of ['22P02', '23505', '42P01', undefined]) {
    assert.equal(llamar(Object.assign(new Error('x'), { code })).status, 500, String(code));
  }
});
