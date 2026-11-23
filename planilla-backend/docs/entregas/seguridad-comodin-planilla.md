# Entrega: Seguridad · Control de Planilla (mover el comodín a `*.planilla.sticr.app`)

- **Fecha:** 23 nov 2026
- **Rama / archivos:** este informe, `planilla-backend/docs/entregas/seguridad-comodin-planilla.md`, en la rama `docs/seguridad-comodin-planilla` de `wiqi20/planilla-backend` (creada desde `origin/feat/comodin-planilla`).
  Revisado:
  - `wiqi20/planilla-backend`, rama `feat/comodin-planilla`, commit `743be77` (más `d1d3d9f`, que es solo la entrega del backend).
  - `wiqi20/planilla-frontend`, rama `feat/comodin-planilla`, commit `c5bc4b9`.
  - `wiqi20/STICR_landingpage`, rama `feat/tenant-domain-planilla`, commit `329a389`.
  - Contra `docs/estandares/seguridad.md`, `docs/estandares/dominios.md` y `docs/proyectos/planilla/mover-comodin.md` de `origin/docs/comodin-por-sistema` (STICR_landingpage).
- **Veredicto:** **APROBADO**

## Resumen

El CORS nuevo del backend, la clasificación del host del frontend y el cambio de `TENANT_DOMAIN` del sitio cumplen la sección 4 de `dominios.md`. Ataqué el CORS con 87 orígenes (más pruebas por HTTP real, con y sin preflight) y el frontend con 22 hosts desconocidos, cada uno con tres estados de sesión, además de la raíz, mayúsculas, punycode y los intentos de forzar el modo `admin`. Ninguno pasó. No hay hallazgos críticos, altos ni medios. Quedan dos hallazgos bajos, los dos sobre la transición, y cuatro notas informativas. Ninguno bloquea.

## Qué se entrega

- Este informe. No se modificó código de ningún repositorio.

## Cómo se comprobó

Todo en local, en árboles propios (`/home/claude/wt-seg-comodin-be`, `-fe`, `-sitio`). Usé un Postgres desechable en `/var/lib/postgresql/seg-comodin-planilla-b91d`, puerto 55491, y el backend en el puerto 55492 con `NODE_ENV=production`. Al terminar apagué y borré los dos. No hice ninguna prueba contra Railway, Netlify ni otro sistema real.

### Backend (CORS, `src/cors.js`)

- `npm test` con `TEST_DATABASE_URL` local → **115/115 pasan**.
- Batería propia contra `origenPermitido` con `NODE_ENV=production`: 11 orígenes que deben pasar y 76 que no deben pasar → **0 fallos**. Los rechazados incluyen:
  - **Sufijos y prefijos:** `planilla.sticr.app.evil.com`, `demo.planilla.sticr.app.evil.com`, `xplanilla.sticr.app.evil.com`, `evilsticr.app`, `planillasticr.app`, `planilla-sticr.app`, `evil.com/.planilla.sticr.app`, `evil.com?.planilla.sticr.app`, `evil.com#.planilla.sticr.app`, `evil.com\.planilla.sticr.app`, `user@demo.planilla.sticr.app`, `demo.planilla.sticr.app@evil.com`.
  - **Dos niveles:** `a.b.planilla.sticr.app`, `x.demo.planilla.sticr.app`, `a.b.sticr.app`, `x.crumble.sticr.app`.
  - **Mayúsculas:** `DEMO.planilla…`, `demo.PLANILLA…`, `Sticr.app`, `HTTPS://sticr.app`, `CRUMBLE.sticr.app`. Los navegadores mandan el `Origin` en minúsculas, así que rechazarlas no rompe nada.
  - **Puertos:** `:443` y `:8443`, en la raíz, en el comodín y en la forma vieja.
  - **Otros esquemas:** `http://` en todas las formas, `ws://` y `wss://`.
  - **Puntos finales:** `planilla.sticr.app.`, `demo.planilla.sticr.app.`, `sticr.app.`, `crumble.sticr.app.`.
  - **Barras y rutas:** `…/` y `…/x`.
  - **Saltos de línea, espacios y caracteres nulos:** `\n`, `\nhttps://evil.com`, `%0a`, espacio al final y al inicio, `\u0000`. En JavaScript, `$` sin la bandera `m` no acepta un salto de línea al final.
  - **Unicode sin convertir:** `démo…`, y `。` como punto.
  - **Etiquetas mal formadas:** `-x`, `x-`, `-`, `_x`, `x_y`, una etiqueta de 64 caracteres, `.planilla.sticr.app`.
  - **Valores vacíos o especiales:** `null`, `*`, `''`, `undefined`.
  - **Locales en producción:** `http://localhost:3000`, `http://127.0.0.1:3000`, `https://localhost:3000`, `http://localhost.evil.com:3000`, IP privadas y `[::1]`.
  - **Crumble en sus cuatro nombres:** `crumble`, `crumble-admin`, `pasteleria-demo` y `pasteleria-demo-admin` sobre `.sticr.app`.
- Punycode: `https://xn--80ak6aa92e.planilla.sticr.app` se acepta. Es correcto: es una etiqueta ASCII válida dentro del comodín propio, y ese host lo sirve `planilla-web`.
- `CORS_ORIGINS`: con una lista exacta (con espacios, una barra final y una coma de más) solo pasan esos orígenes. No pasan ni el comodín, ni `sticr.app`, ni la forma de transición, ni Crumble. Si la variable solo tiene comas o espacios, se usa la lista por defecto (comportamiento razonable). Fuera de producción, `localhost` exige un puerto y rechaza `localhost:3000.evil.com`, `localhost:123456` y la barra final.
- Por HTTP real (`curl` contra el backend en producción local), con `GET /api/auth/direccion` y un preflight `OPTIONS /api/empleados` (`PUT`, `authorization,content-type`):
  - Los orígenes permitidos reciben `Access-Control-Allow-Origin` con su propio origen, `Vary: Origin` y preflight 204. Son `demo.planilla`, `planilla`, `sticr.app`, `demo.sticr.app` (transición) y `crumble.planilla`.
  - Los rechazados no reciben `Access-Control-Allow-Origin` y su preflight cae en 401. Son los cuatro nombres de Crumble sobre `.sticr.app`, `planilla.sticr.app.evil.com`, `a.b.planilla…`, `DEMO.planilla…`, `:443`, `http://` y el punto final.
  - Nunca se envía `Access-Control-Allow-Credentials`. La API usa un token Bearer guardado por cada origen, no cookies.
- **Nombres de Crumble en `/api/auth/direccion`:** inserté filas `crumble`, `pasteleria-demo` y una empresa ficticia `segexiste1` directo en la base desechable, y las borré al terminar. `crumble`, `CRUMBLE`, `crumble-admin`, `pasteleria-demo` y `pasteleria-demo-admin` responden `{"existe":false}` aunque la fila exista. `segexiste1` responde `true`. `segexiste1.planilla`, `a.b`, vacío, `valor` repetido e inyección SQL (`' OR 1=1--`) responden `false`. La consulta está parametrizada (`$1`).

### Frontend (`planilla-frontend/index.html`)

- La prueba del equipo, `pruebas/direccion-inexistente.mjs` (Playwright con Chrome y API simulada), pasa completa.
- Batería propia con Playwright y API simulada, que registra cada llamada a `planilla-api.sticr.app`:
  - **Hosts desconocidos.** Probé 22 hosts, cada uno sin sesión, con un token plantado en `localStorage` y con una sesión plantada de la empresa `admin` (**66/66 bien**). Todos quedan en `tipo: 'desconocida'` con «Esta dirección no existe» y `noindex`. **Ninguno hace llamadas a la API**, ninguno muestra el formulario ni la app, y ninguno entra en modo local. Los hosts:
    - con punto final: `planilla.sticr.app.`, `demo.planilla.sticr.app.`, `localhost.`;
    - de dos niveles: `a.b.planilla…`, `x.demo.planilla…`;
    - con sufijo ajeno: `planilla.sticr.app.evil.com`, `xplanilla.sticr.app.evil.com`, `demo.planilla.sticr.app.evil.com`, `www.sticr.app.evil.com`;
    - que imitan lo local: `localhost.evil.com`, `127.0.0.1.nip.io`, `[::1]`, `0.0.0.0`, `10.0.0.1`;
    - otros dominios: `sticr.app`, `evil.com`, `planillasticr.app`, `cliente.up.railway.app`, `planilla-web-production.up.railway.app`;
    - con etiqueta mal formada: una de 64 caracteres, `-x.planilla…`, `x-.planilla…`.
  - **Mayúsculas:** el navegador las normaliza (`DEMO.PLANILLA.STICR.APP` da `demo`; `CLIENTE.Planilla.Sticr.App` da `cliente`).
  - **Punycode y homógrafos:** `démo.planilla…` se convierte en `xn--dmo-bma`, y `аdmin` escrito con «а» cirílica se convierte en `xn--dmin-43d`. Los dos consultan la API como cualquier etiqueta y muestran «no existe». No caen en la demo ni en `admin`.
  - **Raíz `planilla.sticr.app`:** probé `?next=https://evil.com`, `?redirect=//evil.com#https://evil.com`, `//evil.com/`, `/%2F%2Fevil.com`, `#//evil.com`, mayúsculas y `:443`, con y sin sesión `admin` plantada. Siempre termina en `https://sticr.app/proyectos/control-de-planilla`, sin ninguna llamada a la API y sin mostrar el formulario. El destino es una constante (`FICHA`) y `location.replace` no lee nada de la URL, así que **no es una redirección abierta**.
  - **Forzar el modo `admin`:** probé `cliente.planilla…?modo=admin&empresa=admin&tipo=local`, `#local`, `admin.planilla…`, `localhost.planilla…`, `admin.sticr.app` y `localhost.sticr.app`, todos con una sesión `admin` plantada. Ninguno entra en `tipo: 'local'`. `admin.*` cae en `NUNCA_CLIENTE` y muestra «no existe» sin llamadas a la API. El modo local depende solo de `location.hostname === 'localhost' | '127.0.0.1'`, que una página remota no puede falsificar.
  - **`window.PLANILLA_DIRECCION` no se puede cambiar.** Intenté asignarla, volver a definirla y cambiar `.tipo`, y sigue en `desconocida`. Se define en el primer script del `<head>` con `writable:false`, `configurable:false` y `Object.freeze`.
  - **XSS por el nombre del host:** la etiqueta del host solo admite `[a-z0-9-]`, que es lo que exigen la expresión del comodín y la forma vieja. La pantalla «no existe» escribe el host con `textContent`. Una prueba con un host punycode no abrió diálogos y el texto salió literal. No hay ningún `innerHTML` con el host.
  - **Sesión de otra empresa:** `cargarSesionGuardada` descarta una sesión de otra empresa. En hosts desconocidos y en la raíz ni se lee, porque `comprobarDireccion` corta antes.

### Sitio (`STICR_landingpage`, `feat/tenant-domain-planilla`)

- El diff solo cambia el valor por defecto de `TENANT_DOMAIN` (`"planilla.sticr.app"`), comentarios, el ejemplo del campo de la demo, tres ejemplos en los textos legales, la fecha de revisión y pruebas. No hay datos nuevos ni rutas nuevas, y la variable no se manda al navegador (no es `NEXT_PUBLIC_*`; `lib/planilla.ts` es `server-only`). `PurchaseForm` solo recibe el texto del dominio.
- Revisé `tenantUrl` en todos los lugares donde se usa:
  - En `/configurar`, `s` se valida con `/^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/`: sin puntos ni barras, así que el enlace «Abrir mi sistema» siempre queda en `https://<etiqueta>.planilla.sticr.app` y no se puede usar para mandar a otro dominio.
  - En `/gracias`, la etiqueta viene del proveedor de pagos, no de la URL.
  - En `/admin` está detrás de `requireOwner`.
  - En el correo, la etiqueta viene de la compra validada.
- `npm test` → 269 pasan (96 se omiten sin base). Con `TEST_DATABASE_URL` local → **365/365 pasan**. `npm run typecheck` → sin errores.

### Secretos y dependencias

- Busqué secretos con expresiones (claves de Stripe y `whsec_`, de Resend, URL de base con contraseña, AWS, llaves privadas, tokens de GitHub, JWT y asignaciones `SECRET`, `PASSWORD`, `TOKEN` o `API_KEY`) en:
  - las líneas añadidas de los tres diffs → **0 coincidencias**;
  - todo el historial de `planilla-backend` y `planilla-frontend` → **0 coincidencias**;
  - la rama del sitio → **0 coincidencias**.
  No hay gitleaks instalado en este entorno: la revisión se hizo con expresiones, no con un escáner completo.
- `.env.example` del backend y del sitio: solo nombres y valores de ejemplo públicos (dominios), sin secretos.
- `npm audit --omit=dev` → **0 vulnerabilidades** en `planilla-backend` y en el sitio. Las dos ramas tienen `package-lock.json` versionado. El cambio no agrega dependencias.
- `docs/comodin-planilla/qa-capturas/resultados.json` (frontend) no tiene tokens, correos ni datos personales.

## Hallazgos

### Críticos, altos y medios

Ninguno.

### B1 (bajo). La transición del CORS acepta cualquier nombre de primer nivel `*.sticr.app` que no sea de Crumble

- **Dónde:** `planilla-backend/src/cors.js`, `TRANSICION_COMODIN_VIEJO` y `permitidoEnTransicion`. En el frontend, `COMODIN_VIEJO` en el `<head>` de `index.html`.
- **Qué pasa:** durante la transición se aceptan `https://xplanilla.sticr.app`, `https://www.sticr.app`, `https://planilla-api.sticr.app` y cualquier nombre de primer nivel que se cree antes del paso 8, salvo los cuatro de `OTROS_SISTEMAS`. Es una lista de exclusión, así que depende de que alguien actualice `OTROS_SISTEMAS` cada vez que el registro de `dominios.md` sume un nombre. El plan (3.2) pide rechazar `xplanilla.sticr.app`. La entrega del backend lo reconoce y lo deja para el paso 8.
- **Reproducir:** `node -e "console.log(require('./src/cors').origenPermitido('https://xplanilla.sticr.app',{NODE_ENV:'production'}))"` → `true`. Por HTTP, `curl -H 'Origin: https://xplanilla.sticr.app' …/api/auth/direccion?valor=demo` devuelve `Access-Control-Allow-Origin: https://xplanilla.sticr.app`.
- **Por qué es bajo:** la API no usa cookies ni `Allow-Credentials`, y el token Bearer vive en el `localStorage` de cada origen. Un origen permitido que no es de Planilla solo puede leer lo que ya podría leer con `curl`. Mientras exista el registro `*` del DNS, esos nombres los sirve `planilla-web` de todos modos. Después del paso 7 solo existen los nombres del registro, que son todos de STI.
- **Corregir:** Planilla no tiene clientes, así que la transición solo necesita la demo. Mejor reemplazar la expresión por el origen exacto `https://demo.sticr.app`, en el backend y, si se quiere, también en el frontend. Si se mantiene la expresión, que el paso 8 tenga fecha y responsable y que no se agregue ningún nombre de primer nivel al registro sin sumarlo antes a `OTROS_SISTEMAS`.

### B2 (bajo, de proceso). La limpieza del paso 8 y el orden del sitio dependen solo del plan

- **Dónde:** el plan, pasos 6 a 8. Afecta las tres ramas.
- **Qué pasa:** la forma vieja (B1) se quita en un PR posterior que todavía no existe. En el sitio, si la rama se une y se despliega antes del paso 5 sin `TENANT_DOMAIN` en Netlify, `/gracias`, `/configurar` y el correo darían direcciones `*.planilla.sticr.app` que todavía no resuelven. No es un riesgo de toma de dominio, porque la zona es de STI. Pero un correo con un enlace roto le enseña al cliente a no confiar en los enlaces oficiales.
- **Corregir:** el Project Manager crea ya la tarea del paso 8, con responsables en backend y frontend. DevOps confirma en el paso 0 qué valor tiene hoy `TENANT_DOMAIN` en Netlify, y el PR del sitio se une solo en el paso 6, como dice el plan.

### Informativos (no requieren cambio)

- **I1.** `https://planilla.sticr.app` está en la lista del CORS aunque la raíz nunca llama a la API, porque redirige antes. Lo pide el plan y es inofensivo, pero por mínimo privilegio podría quitarse en el paso 8.
- **I2.** `https://crumble.planilla.sticr.app` pasa el CORS. Es correcto según `dominios.md` 4: es una etiqueta del comodín propio y la sirve `planilla-web`. El frontend muestra «no existe» sin llamar a la API, y el backend responde `existe:false`. Los nombres de Crumble que sí son de Crumble (`*.sticr.app`) están siempre rechazados.
- **I3.** Sin JavaScript, cualquier host muestra el formulario de ingreso, porque la clasificación se hace en un script. Ya pasaba antes de este cambio y es inerte: los campos no tienen `name`, así que el formulario no envía nada.
- **I4.** `npm run lint` del sitio da 3 errores en `docs/proyectos/crumble/logo/fuentes/render5.js`, que ya estaban en `main` (commit `e679329`) y no tocó esta rama. No es de seguridad, pero el estándar pide lint sin errores antes del PR.

## Qué no revisé

- **Producción.** No miré las cabeceras reales de `planilla-web` ni de `planilla-api` (CSP, HSTS, `frame-ancestors`), ni el certificado del comodín, ni el DNS de Netlify, ni los dominios de Railway. Eso es el humo de DevOps (plan 3.4), después de cada paso. Hay que confirmar allí que `demo.planilla.sticr.app` recibe `Access-Control-Allow-Origin` y que `planilla.sticr.app` redirige.
- **`CORS_ORIGINS` en Railway.** Tomo el dato del PM: `planilla-api` no la define, así que manda la lista por defecto. No lo comprobé. Si llegara a existir con valores viejos, la API quedaría cerrada al origen nuevo (falla cerrada, no abierta).
- **Partes del sitio sin cambios.** No revisé de nuevo el webhook, los pagos, la sesión, CSRF ni los límites de intentos: este cambio no los toca. Tampoco corrí `npm run build` del sitio.
- **Historial completo del sitio.** No escaneé todo su historial; solo la rama nueva.

## Decisiones tomadas

- APROBADO con B1 y B2 abiertos: los dos son bajos, se quitan con el paso 8 o con el orden del plan y no exponen datos ni permiten entrar a una empresa.
- No pedí cambiar la expresión del comodín para aceptar mayúsculas o puntos finales: los navegadores no los mandan así en `Origin`, y rechazarlos falla cerrado.

## Pendientes y riesgos

- B1 y B2 (arriba).
- El humo de DevOps del plan 3.4 es la única prueba de las cabeceras y del CORS reales en producción.
- Recomendación general, que no bloquea: cuando Planilla tenga clientes reales con datos de planilla (datos personales y salariales, Ley 8968), conviene una prueba de penetración externa de `planilla-api` y del aislamiento entre empresas.

## Preguntas para el Project Manager

- ¿Se acepta acortar la transición a solo `https://demo.sticr.app` (B1) o se deja la expresión hasta el paso 8?
- ¿Quién lleva la tarea del paso 8 y para qué fecha?

## Dependencias nuevas

- Ninguna.
