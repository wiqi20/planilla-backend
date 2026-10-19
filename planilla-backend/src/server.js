require('dotenv').config();
const { crearApp } = require('./app');
const { iniciarDemoProgramado } = require('./demo');

const app = crearApp();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Planilla backend escuchando en el puerto ${PORT}`);
  const { valor, motivo } = app.locals.proxy;
  console.log(`[aviso] trust proxy = ${valor} (${motivo}). Con false, el límite de login vería una sola IP detrás de un proxy.`);
  iniciarDemoProgramado();
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
