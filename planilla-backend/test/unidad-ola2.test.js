// Unidad (sin base ni servidor): N-12, apagado ordenado, tiempo máximo de /health y formato de error.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { crearLimitador } = require('../src/limiteIntentos');
const { crearCierre } = require('../src/cierre');
const { crearSalud } = require('../src/salud');
const { formatoError, contieneNul, mensajeDe } = require('../src/errores');

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
