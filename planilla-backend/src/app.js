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

// Cuántos proxies hay delante del servicio. En Railway hay uno (su balanceador), que agrega la IP real
// del cliente al final de X-Forwarded-For; con `1` Express toma esa IP y no la del proxy. Sin esto el
// límite de intentos de login contaría a todo el mundo como una sola IP (la del proxy). Si el servicio
// se corre sin proxy (local), es `false` para que nadie pueda inventar su IP con esa cabecera.
// TRUST_PROXY permite cambiarlo (0, 1, 2...) si se agrega otro proxy, por ejemplo un CDN.
function configurarProxy(app, env = process.env) {
  if (env.TRUST_PROXY !== undefined && env.TRUST_PROXY !== '') {
    const n = Number(env.TRUST_PROXY);
    app.set('trust proxy', Number.isInteger(n) && n >= 0 ? (n === 0 ? false : n) : false);
  } else {
    app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);
  }
}

function crearApp() {
  const app = express();
  configurarProxy(app);

  // API JSON: nada de contenido activo ni de ser incrustada en marcos. helmet también quita X-Powered-By.
  // CORP "cross-origin" porque los frontends (otros subdominios) leen las respuestas con fetch.
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.use(cors(opcionesCors()));
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true }));

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

  // Errores: JSON mal formado o demasiado grande son culpa del cliente (400/413), no del servidor.
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido' });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'El cuerpo de la petición es demasiado grande' });
    }
    console.error('Error no manejado:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}

module.exports = { crearApp, configurarProxy };
