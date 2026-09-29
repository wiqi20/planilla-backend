require('dotenv').config();
const express = require('express');
const cors = require('cors');

const requireAuth = require('./middleware/requireAuth');
const authRoutes = require('./routes/auth.routes');
const empleadosRoutes = require('./routes/empleados.routes');
const colillasRoutes = require('./routes/colillas.routes');
const reportesRoutes = require('./routes/reportes.routes');
const boletasRoutes = require('./routes/boletas.routes');
const adminRoutes = require('./routes/admin.routes');

const app = express();

app.use(cors()); // en producción, restringe esto al dominio de tu frontend (ver README)
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

// Rutas públicas (registro de empresa, login)
app.use('/api/auth', authRoutes);

// A partir de aquí, toda ruta exige un JWT válido y queda aislada por empresa
app.use('/api/empleados', requireAuth, empleadosRoutes);
app.use('/api/colillas', requireAuth, colillasRoutes);
app.use('/api/reportes', requireAuth, reportesRoutes);
app.use('/api/boletas', requireAuth, boletasRoutes);
app.use('/api/admin', requireAuth, adminRoutes);

// Manejo de errores no capturados en rutas async (evita que el server truene)
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Planilla backend escuchando en el puerto ${PORT}`);
});

// Red de seguridad adicional: con asyncHandler en todas las rutas esto no debería
// dispararse nunca, pero si algo se escapa (ej. un error dentro de un middleware),
// preferimos loguearlo y seguir vivos en vez de tumbar el servicio para TODAS las empresas.
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});
