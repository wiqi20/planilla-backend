# Entrega: Backend · Control de Planilla (mover el comodín a `*.planilla.sticr.app`)

- **Fecha:** 23 nov 2026
- **Rama / archivos:** `feat/comodin-planilla` en `wiqi20/planilla-backend` (commit `743be77`): `src/cors.js`, `src/subdominios.js` (solo comentarios), `src/routes/auth.routes.js` (solo comentario), `db/seed-admin.js` (texto de un aviso), `.env.example`, `README.md`, `docs/api.md`, `test/unidad.test.js`, `test/seguridad.test.js`, `test/direccion.test.js`
- **Plan:** `docs/proyectos/planilla/mover-comodin.md`, sección 2.2, y `docs/estandares/dominios.md` (STICR_landingpage, rama `docs/comodin-por-sistema`, PR #49)

## Resumen
El CORS de la API acepta ahora `https://sticr.app`, `https://planilla.sticr.app` y `https://<etiqueta>.planilla.sticr.app` de un solo nivel. Durante la transición sigue aceptando la forma vieja `https://<etiqueta>.sticr.app` de un nivel, **salvo los nombres de otros sistemas de STI**, así que `https://crumble.sticr.app` queda rechazado. Es el paso 1 del orden de despliegue; falta revisión de Seguridad y QA.

## Qué se entrega
- `src/cors.js`: lista por defecto nueva (`POR_DEFECTO`) y la forma de transición aparte (`TRANSICION_COMODIN_VIEJO` y `permitidoEnTransicion`), marcada para quitar en el paso 8. `CORS_ORIGINS` sigue mandando sobre todo (orígenes exactos, sin comodines). Localhost solo fuera de producción, sin cambios.
- `src/subdominios.js`: sin cambios de lógica. Comentarios: `cliente.planilla.sticr.app`; `OTROS_SISTEMAS` y `NUNCA_CLIENTE` ya no se explican por compartir comodín sino por no vender nombres que confundan; `planilla.sticr.app` es la raíz y el frontend la manda a la ficha.
- `db/seed-admin.js`: el aviso para nombres de `NUNCA_CLIENTE` ya no dice que se entra por `planilla.sticr.app` con la empresa `admin` (ese modo se elimina en el frontend).
- `.env.example`, `README.md`, `docs/api.md`: direcciones nuevas, ejemplo de `CORS_ORIGINS=https://planilla.sticr.app,https://demo.planilla.sticr.app` y una sección «Desde qué páginas se puede llamar (CORS)» en la API.
- Pruebas:
  - Unidad: casos de 3.2 (acepta `sticr.app`, la raíz, `minegocio.planilla.sticr.app` y etiquetas de 1 y 63 caracteres; rechaza `http://`, dos niveles, `planilla.sticr.app.ejemplo.com`, `-x.`, `x-.`, 64 caracteres, barra final, puerto y mayúsculas), transición (acepta `demo.sticr.app` y similares; rechaza los 4 nombres de otros sistemas, dos niveles y `http://`) y `CORS_ORIGINS` exacta y sin comodines.
  - Integración: `seguridad.test.js` con orígenes nuevos y de transición, rechazo de `crumble.sticr.app`, y preflight desde `minegocio.planilla.sticr.app`. `direccion.test.js`: la respuesta se puede leer desde `crumble.planilla.sticr.app` (con `existe:false`, sin cambios) y **no** desde `crumble.sticr.app` (misma respuesta 200, sin `Access-Control-Allow-Origin`).

## Cómo se comprobó
- Postgres 16 desechable en `/var/lib/postgresql/pg-comodin-planilla-be-526`, puerto 55437 en localhost, base `planilla_test`. Se apagó y se borró al terminar.
- `TEST_DATABASE_URL=postgres://postgres@localhost:55437/planilla_test npm test`, primera corrida: 113 de 115. Fallaron `xplanilla.sticr.app` (ver la segunda decisión) y `las peticiones en vuelo durante SIGTERM...` (`ECONNRESET`).
- `node --test test/cierre-arranque.test.js` tres veces: falló 1 de 3 y pasó 2 de 3. Depende de tiempos y no toca CORS ni direcciones.
- `npm test` completo tras el ajuste: **115 de 115, 0 fallos, 0 omitidas**.
- `npm audit --omit=dev`: **found 0 vulnerabilities**.
- `npm ci`: 102 paquetes, sin cambios en `package.json` ni en `package-lock.json`.

## Decisiones tomadas
- **La transición excluye `crumble`, `crumble-admin`, `pasteleria-demo` y `pasteleria-demo-admin`** (`OTROS_SISTEMAS`), aunque el plan (3.2) dice que en la transición se acepta `crumble.sticr.app`. Así lo pidió el Project Manager en este encargo: esos orígenes son de otro sistema y no tienen por qué leer la API de Planilla. Es más estricto y no afecta a la demo ni a ningún cliente.
- **`https://xplanilla.sticr.app` se acepta mientras dure la transición.** El plan (3.2) lo pone entre los rechazados, pero es un primer nivel bajo `sticr.app` y lo cubre la forma vieja, que el mismo plan exige mantener. La prueba lo marca así y pasa a «rechazado» en el paso 8.
- Las etiquetas del comodín nuevo siguen la regla de etiqueta DNS (1 a 63 caracteres), igual que `/api/auth/direccion`. Las reglas de venta (3 a 30 caracteres) no se aplican aquí porque existen empresas heredadas fuera de ellas.
- `/api/auth/direccion`, `src/demo.js`, el aprovisionamiento, el inicio de sesión y la base de datos no cambian.

## Pendientes y riesgos
- **Paso 8 (limpieza):** en `src/cors.js`, borrar `TRANSICION_COMODIN_VIEJO`, `permitidoEnTransicion`, la línea marcada `TRANSICIÓN` en `origenPermitido` y, si nadie más lo usa, el `require` de `OTROS_SISTEMAS`. En `test/unidad.test.js`, convertir la prueba «CORS (transición)» en rechazos: todo `*.sticr.app` de un nivel, incluidos `demo.sticr.app` y `xplanilla.sticr.app`. En `test/seguridad.test.js`, pasar `demo.sticr.app` y `cliente9.sticr.app` a la lista de rechazados. Quitar las líneas de transición de `.env.example`, `README.md` y `docs/api.md`.
- `CORS_ORIGINS` en Railway (`planilla-api`): si está definida, manda y dejaría fuera los orígenes nuevos. Lo revisa DevOps en el paso 0.
- La prueba de SIGTERM (`test/cierre-arranque.test.js`) falla a veces por tiempos (`ECONNRESET`). Este cambio no toca esa prueba ni lo que comprueba; no se verificó si en `main` falla con la misma frecuencia. Puede pintar de rojo el CI.

## Preguntas para el Project Manager
- ¿Se actualiza el plan 3.2 para que diga que en la transición se rechazan los 4 nombres de otros sistemas y se acepta `xplanilla.sticr.app` hasta el paso 8?

## Dependencias nuevas
- Ninguna.
