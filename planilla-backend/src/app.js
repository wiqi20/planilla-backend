// Construye la aplicación Express (sin abrir el puerto, para poder probarla).
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const requireAuth = require('./middleware/requireAuth');
const authRoutes = require('./routes/auth.routes');
const empleadosRoutes = require('./routes/empleados.routes');
const colillasRoutes = require('./routes/colillas.routes');
const reportesRoutes = require('./routes/reportes.routes');
const boletasRoutes = require('./routes/boletas.routes');
const adminRoutes = require('./routes/admin.routes');
const provisionRoutes = require('./routes/provision.routes');
const { opcionesCors } = require('./cors');
const { decidirProxy } = require('./proxy');
const { formatoError, manejadorErrores, rutaNoEncontrada, rechazarNul } = require('./errores');
const { crearSalud } = require('./salud');
const db = require('./db');

function configurarProxy(app, env = process.env) {
  const decision = decidirProxy(env);
  app.set('trust proxy', decision.valor);
  return decision;
}

function crearApp({ estaCerrando = () => false } = {}) {
  const app = express();
  app.locals.proxy = configurarProxy(app);

  // API JSON: nada de contenido activo ni de ser incrustada en marcos. helmet también quita X-Powered-By.
  // CORP "cross-origin" porque los frontends (otros subdominios) leen las respuestas con fetch.
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.use(cors(opcionesCors()));
  app.use(formatoError); // todo error sale como { error, mensaje }

  // Salud real (consulta la base). Público y antes de todo lo demás: sin sesión ni límite de intentos.
  app.get('/health', crearSalud({ consultar: () => db.query('SELECT 1'), estaCerrando }));

  app.use(express.json());
  app.use(rechazarNul); // N-11: el byte NUL en cualquier texto es un 400, nunca un 500

  // Rutas públicas (registro de empresa, login)
  app.use('/api/auth', authRoutes);

  // Rutas para el sitio sticr.app (crear/suspender empresas al comprar). Exigen PROVISION_SECRET.
  app.use('/api/provision', provisionRoutes);

  // A partir de aquí, toda ruta exige un JWT válido y queda aislada por empresa
  app.use('/api/empleados', requireAuth, empleadosRoutes);
  app.use('/api/colillas', requireAuth, colillasRoutes);
  app.use('/api/reportes', requireAuth, reportesRoutes);
  app.use('/api/boletas', requireAuth, boletasRoutes);
  app.use('/api/admin', requireAuth, adminRoutes);

  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);

  return app;
}

module.exports = { crearApp, configurarProxy };
