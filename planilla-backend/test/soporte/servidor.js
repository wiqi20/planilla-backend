// Utilidades de las pruebas de integración: levanta el servidor real como proceso aparte
// (puerto 4501) contra una base de pruebas desechable y lo llama por HTTP.
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const { migrar } = require('../../src/migraciones');
const { Pool } = require('pg');

const RAIZ = path.join(__dirname, '..', '..');
// Puerto del servidor de pruebas: TEST_PORT, o uno derivado del pid del proceso de prueba para que dos corridas
// simultáneas (otro revisor, otra terminal) no choquen. Cada archivo de prueba corre en su propio proceso.
const PUERTO = Number(process.env.TEST_PORT) || 20000 + (process.pid % 20000);
const BASE = `http://127.0.0.1:${PUERTO}`;
const PROVISION_SECRET = 'secreto-de-pruebas-0123456789-abcdef';
const URL_DB = process.env.TEST_DATABASE_URL;

// Seguridad: las pruebas crean y borran datos. Solo corren contra una base cuyo nombre diga "test".
function nombreBase(url) { try { return new URL(url).pathname.replace('/', ''); } catch { return ''; } }
const HAY_BASE = Boolean(URL_DB) && /test/i.test(nombreBase(URL_DB));
const SIN_BASE = HAY_BASE ? false : 'Define TEST_DATABASE_URL con una base desechable cuyo nombre contenga "test"';

let pool;
function db() {
  if (!pool) pool = new Pool({ connectionString: URL_DB, ssl: false });
  return pool;
}

// Deja la base de pruebas al día con las migraciones (lo mismo que hace el servidor al arrancar).
async function prepararEsquema() {
  await migrar(db());
}

async function limpiar() {
  await db().query("DELETE FROM empresas WHERE subdominio LIKE 'o1t%' OR (subdominio = 'demo' AND es_demo)");
  await db().end();
  pool = null;
}

// Lanza el servidor sin esperar a que responda.
function lanzar(env = {}) {
  const proceso = spawn(process.execPath, [
    '--require', path.join(__dirname, 'reloj.js'), path.join(RAIZ, 'src', 'server.js')
  ], {
    cwd: RAIZ,
    env: {
      PATH: process.env.PATH,
      PORT: String(PUERTO),
      NODE_ENV: 'test',
      DATABASE_URL: URL_DB || 'postgresql://postgres@localhost:1/sin_base_test',
      JWT_SECRET: 'jwt-de-pruebas-no-es-un-secreto-real',
      JWT_EXPIRES_IN: '7d',
      PROVISION_SECRET,
      TRUST_PROXY: '1',
      DEMO_ENABLED: 'false',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let salida = '';
  proceso.stdout.on('data', (d) => { salida += d; });
  proceso.stderr.on('data', (d) => { salida += d; });
  let codigoSalida = null;
  proceso.once('exit', (codigo) => { codigoSalida = codigo; });
  return {
    proceso,
    detener: () => (codigoSalida !== null ? Promise.resolve(codigoSalida)
      : new Promise((resolve) => { proceso.once('exit', resolve); proceso.kill(); })),
    // Espera a que el proceso termine solo (por ejemplo tras una señal) y devuelve su código de salida.
    esperarSalida: (ms = 15000) => new Promise((resolve, rechazar) => {
      if (codigoSalida !== null) return resolve(codigoSalida);
      const t = setTimeout(() => rechazar(new Error('El proceso no terminó a tiempo:\n' + salida)), ms);
      proceso.once('exit', (codigo) => { clearTimeout(t); resolve(codigo); });
    }),
    salida: () => salida
  };
}

async function iniciarServidor(env = {}, { esperarOk = true } = {}) {
  const srv = lanzar(env);
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok || !esperarOk) break; } catch { /* aún no arranca */ }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) { srv.proceso.kill(); throw new Error('El servidor no arrancó:\n' + srv.salida()); }
  }
  return srv;
}

// Llama a la API. Devuelve { status, body, headers }.
async function api(metodo, ruta, { token, body, headers = {}, crudo } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined || crudo !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: h,
    body: crudo !== undefined ? crudo : (body !== undefined ? JSON.stringify(body) : undefined)
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* no era JSON */ }
  return { status: r.status, body: json, texto, headers: r.headers };
}

let contador = 0;
const ipFalsa = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${(++contador % 250) + 1}`;

// Crea una empresa como lo hace el sitio al cobrar (aprovisionamiento) y entra con su administrador.
async function crearEmpresa(sufijo = '') {
  const id = crypto.randomBytes(4).toString('hex');
  const subdominio = `o1t${sufijo}${id}`;
  const sub = `sub_${subdominio}`;
  const prov = { 'x-provision-secret': PROVISION_SECRET };
  const e = await api('POST', '/api/provision/empresa', { headers: prov, body: { nombreEmpresa: `Empresa ${subdominio}`, subdominio, stripeSubscriptionId: sub } });
  if (e.status !== 201) throw new Error('No se pudo crear la empresa de prueba: ' + e.texto);
  const usuario = 'admin' + id;
  const password = 'clave-de-prueba-1';
  const a = await api('POST', '/api/provision/admin', { headers: prov, body: { subdominio, stripeSubscriptionId: sub, usuario, password } });
  if (a.status !== 201) throw new Error('No se pudo crear el admin de prueba: ' + a.texto);
  const l = await api('POST', '/api/auth/login', { headers: { 'X-Forwarded-For': ipFalsa() }, body: { subdominio, usuario, password } });
  if (l.status !== 200) throw new Error('No se pudo entrar a la empresa de prueba: ' + l.texto);
  return { subdominio, usuario, password, token: l.body.token, usuarioId: l.body.usuario.id, empresaId: l.body.empresa.id, sub };
}

async function crearEmpleado(token, extra = {}) {
  const id = crypto.randomBytes(4).toString('hex');
  const r = await api('POST', '/api/empleados', { token, body: {
    nombre: 'Persona de Prueba', correo: `p${id}@ejemplo.cr`, salario: 900000, fechaIngreso: '2020-01-15', vacacionesDisponibles: 5, ...extra
  } });
  if (r.status !== 201) throw new Error('No se pudo crear el empleado de prueba: ' + r.texto);
  return r.body;
}

module.exports = { lanzar, BASE, PUERTO, RAIZ, SIN_BASE, PROVISION_SECRET, db, prepararEsquema, limpiar, iniciarServidor, api, ipFalsa, crearEmpresa, crearEmpleado };
