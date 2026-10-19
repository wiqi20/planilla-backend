require('dotenv').config();
const { crearApp } = require('./app');
const { iniciarDemoProgramado } = require('./demo');
const { migrar } = require('./migraciones');
const { crearCierre } = require('./cierre');
const db = require('./db');

const PORT = process.env.PORT || 3000;

async function main() {
  // El esquema se actualiza solo al arrancar (migraciones versionadas). Si falla, el servicio no inicia.
  // MIGRAR_AL_ARRANCAR=false lo apaga (solo para casos especiales; `npm run migrate` sigue disponible).
  if (process.env.MIGRAR_AL_ARRANCAR !== 'false') {
    const r = await migrar(db.pool, { log: console.log });
    console.log(r.aplicadas.length ? `Migraciones aplicadas: ${r.aplicadas.length}` : 'Base de datos al día.');
  }

  let cierre;
  const app = crearApp({ estaCerrando: () => (cierre ? cierre.estaCerrando() : false) });
  const servidor = app.listen(PORT, () => {
    console.log(`Planilla backend escuchando en el puerto ${PORT}`);
    const { valor, motivo } = app.locals.proxy;
    console.log(`[aviso] trust proxy = ${valor} (${motivo}). Con false, el límite de login vería una sola IP detrás de un proxy.`);
    iniciarDemoProgramado();
  });

  cierre = crearCierre({ servidor, pool: db.pool });
  let yaRecibida = false;
  for (const senal of ['SIGTERM', 'SIGINT']) {
    process.on(senal, () => {
      if (yaRecibida) { console.log(`[cierre] ${senal} repetida: salida inmediata.`); process.exit(1); }
      yaRecibida = true;
      cierre.cerrar(senal).then(({ forzado }) => process.exit(forzado ? 1 : 0));
    });
  }
}

main().catch((err) => {
  console.error('No se pudo iniciar el servicio:', err.message);
  process.exit(1);
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
