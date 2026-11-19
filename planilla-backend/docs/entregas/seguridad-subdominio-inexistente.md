# Entrega: Seguridad · Control de Planilla — subdominio inexistente

- **Fecha:** 17 nov 2026
- **Rama / archivos revisados:** backend `fix/subdominio-inexistente` @ `3c93808` (`src/subdominios.js`, `src/routes/auth.routes.js`, `test/direccion.test.js`, `.env.example`); frontend `fix/subdominio-inexistente` @ `7db6590` (`planilla-frontend/index.html`). Este informe: rama `docs/seguridad-subdominio-inexistente`.
- **Veredicto final (re-revisión del 18 nov 2026, backend `90f5b88` y frontend `287485d`):** **APROBADO**. Ver la sección «Re-revisión» al final.
- **Veredicto de la primera revisión:** **RECHAZADO** (2 hallazgos altos: H-1 y H-2). El resto del cambio está bien hecho y lo que se probó pasa. Para aprobarlo hay que corregir H-1, o demostrar que no aplica, y H-2.

## Resumen
La ruta nueva `GET /api/auth/direccion` da la misma respuesta a todos los casos negativos, tarda lo mismo, valida la entrada, no se guarda en caché, no da permisos de más por CORS y su límite de consultas resiste ráfagas. Ponerle el mismo límite a `/api/auth/subdominio-disponible` mejora lo que había. El script del frontend no tiene XSS y, si la comprobación falla, deja entrar al cliente como antes.

Queda un problema de disponibilidad. `/direccion` usa las reglas de **venta** de nombres (3–30 caracteres, sin `--`, sin reservados) para decidir si una empresa **existe**. Por eso un cliente que ya existe con un nombre heredado (1–2 o 31–63 caracteres, con `--`, o con un nombre que ahora está reservado) recibe `existe:false`, y el frontend le quita el formulario de ingreso. Además, `npm audit --omit=dev` marca un hallazgo alto en `body-parser`, que es anterior a este cambio y el estándar trata como bloqueante.

## Hallazgos

### H-1 · ALTO (bloqueante; hay que corregirlo o demostrar con datos que no aplica) — Clientes existentes con nombre heredado se quedan sin pantalla de ingreso
- **Dónde:** `src/subdominios.js` → `nombreDeEmpresaPosible` (llama a `validarSubdominio`), que usa `src/routes/auth.routes.js` → `GET /direccion`; en el frontend, `comprobarDireccion()` → `mostrarDireccionNoExiste()` en `planilla-frontend/index.html`.
- **Qué pasa:** `/direccion` responde `existe:false` para cualquier fila de `empresas` cuyo nombre no pasa `validarSubdominio`. Hubo nombres así: antes de este cambio, `registrar-empresa` aceptaba de 1 a 63 caracteres y también `--`, y estuvo abierto hasta el commit `39fb0e1`. `seed-admin` sigue aceptando cualquier nombre, y se acaban de reservar `crumble`, `crumble-admin`, `pasteleria-demo` y `pasteleria-demo-admin`. Con `existe:false` el frontend **quita del documento** `#loginGate` y `#appWrap`, así que ese cliente no puede entrar desde `sunombre.sticr.app` aunque su usuario y contraseña sigan siendo válidos.
- **Lo que pide el PM, comprobado:** la validación nueva en `registrar-empresa` solo afecta a la creación. `POST /api/auth/login` no cambió y sigue entrando con esos nombres. El bloqueo viene por otro camino: `/direccion` más el frontend.
- **Cómo reproducirlo (local, base desechable):** sembrar con `seed-admin` las empresas `ab` y `x`×40, más `cliente1`.
  - `POST /api/auth/login` con `ab` → **200** con token. Con `x`×40 → **200** con token.
  - `GET /api/auth/direccion?valor=ab` → `{"existe":false}`. Con `x`×40 → `{"existe":false}`. Con `cliente1` → `{"existe":true}`.
  - Resultado: `ab.sticr.app` mostraría «Esta dirección no existe» a un cliente válido.
- **Cómo corregirlo (Backend):** separar «¿se puede vender?» de «¿existe?».
  - En `/direccion`, aceptar para la consulta cualquier texto que pueda ser una etiqueta DNS: `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`, de 1 a 63 caracteres.
  - Excluir solo `OTROS_SISTEMAS` y las direcciones propias (`www`, `api`, `app`, `admin`, `planilla`, `planilla-api`).
  - Responder `existe = hay fila`.
  - Así la respuesta y el tiempo siguen siendo iguales para todos los casos negativos, porque siempre se hace la misma consulta.
  - Agregar una prueba con empresas `ab` y `x`×40 sembradas que espere `existe:true`.
- **Alternativa aceptable:** antes de desplegar, el dueño o DevOps corre en producción una consulta **de solo lectura** que cuente las filas de `empresas` cuyo `subdominio` no cumple la regla de 3–30 caracteres sin `--` o está en la lista de reservados, salvo `demo` y `admin`. Si da 0, H-1 baja a **bajo** (riesgo futuro con `seed-admin`). No ejecuté esa consulta: no tengo acceso a producción y no debo ver datos de clientes.

### H-2 · ALTO (bloqueante según el estándar §6; anterior a este cambio) — `npm audit --omit=dev`: body-parser
- **Dónde:** `package-lock.json` (sin cambios en esta rama): `express@4.22.3` → `body-parser@1.20.8`.
- **Qué pasa:** el aviso GHSA-27r3-jxmh-p828 (alto) es una caída del servicio (DoS) por bytes sobrantes después de un cuerpo comprimido. `express.json()` descomprime por defecto y está delante de rutas públicas como `POST /api/auth/login`, así que se alcanza sin sesión. También hay un hallazgo moderado: `qs@6.16.0`, GHSA-6pq8-jhm2-2vcw.
- **Cómo reproducirlo:** `npm audit --omit=dev` en `planilla-backend` → «2 vulnerabilities (1 moderate, 1 high)». No intenté explotarlo.
- **Cómo corregirlo:** `npm audit fix` (la corrección está dentro del rango semver: body-parser ≥ 1.20.9 y qs > 6.16.0). Después, `npm ci && npm test` con base y versionar el `package-lock.json`. Puede ir en esta rama o en un PR aparte que se fusione antes. Lo que importa es que no se despliegue con el aviso alto.

### M-1 · MEDIO — Enumeración distribuida y límite en memoria
- **Dónde:** `limitarConsultaDeNombres` en `src/routes/auth.routes.js` y `src/limiteIntentos.js`.
- **Qué pasa:**
  - El límite (120 cada 15 min) se cuenta por IP exacta y vive en memoria de una sola instancia.
  - Quien tenga muchas IP (una red de bots, o un bloque IPv6 /64, que trae 2^64 direcciones) puede probar nombres sin freno práctico.
  - Con varias réplicas, cada una cuenta por separado.
  - Contar bien la IP depende de `trust proxy = 1` y de que Railway agregue exactamente un salto en `X-Forwarded-For`. No lo verifiqué en Railway.
- **Contexto:** no empeora la situación; la mejora. Antes `GET /api/auth/subdominio-disponible` ya revelaba lo mismo («disponible:false» para un nombre ocupado), sin límite y para cualquiera. Lo que se revela es solo un booleano por nombre.
- **Cómo corregirlo (recomendación, no bloquea):**
  - Agrupar las IPv6 por /64 en la clave del limitador.
  - Si se escala a varias réplicas, llevar el contador a Postgres o Redis.
  - Considerar un tope global por ventana.

### B-1 · BAJO — La lista de nombres «nunca cliente» está en tres lugares
- **Dónde:** el script del `<head>` y `NUNCA_CLIENTE` en `index.html`, más `OTROS_SISTEMAS`/`RESERVADOS` en `src/subdominios.js`.
- **Riesgo:** si se olvida actualizar una de las tres al sumar otro sistema, se ve un ingreso donde no corresponde, o «no existe» para un nombre que sí es cliente. Esto último tiene el mismo efecto que H-1.
- **Corrección:** tener una sola fuente de verdad (el backend) o una prueba que compare las listas.

### B-2 · BAJO — `admin.sticr.app` pasa a «no existe»
- **Qué pasa:** antes, `admin.sticr.app`, `www`, `api` y `app` mostraban el ingreso de la empresa `admin`, la que crea `seed-admin`. Ahora muestran «no existe» y el backend responde `false` para `admin`. El dueño conserva el acceso por `planilla.sticr.app`.
- **Pendiente:** es un cambio de comportamiento que debe confirmar el PM (ya está en las preguntas del frontend). No es un problema de seguridad; lo dejo anotado porque afecta el acceso de STI.

### Información (sin hallazgo)
- Los rastreadores sin JavaScript ven el HTML con el formulario y sin `noindex`, como antes. No se sirve un 404 real. Es un tema de SEO e imagen, no de seguridad.

## Cómo se comprobó
Todo se probó en local, con Postgres 16 desechable en `localhost:55471`, un directorio propio en el scratchpad y el servidor en `localhost:55480`. No usé Railway, producción ni datos reales.

- **Suite completa:** `TEST_DATABASE_URL=postgresql://postgres@localhost:55471/planilla_test npm test` → **100 de 100**, 0 se saltan.
- **Respuesta uniforme:** con el script de sondas, `GET /direccion` respondió `200 {"existe":false}` con `Cache-Control: no-store` para:
  - `libre123`, `crumble`, `admin`, `www`, `a--b`, `xn--bcher-kva`
  - `''`, `%00`, `<script>`, `..%2F..`, `cliente1.evil`
  - `demo` (con la demo apagada)
  - sin parámetro, `valor=a&valor=b`, `valor[x]=cliente1` y `valor[]=cliente1`

  `cliente1`, `CLIENTE1` y `" cliente1 "` → `{"existe":true}`. Con un `valor` de 100 000 caracteres, Node corta antes con 431. Ninguna respuesta trae nombre, estado ni id.
- **Tiempo:** mediana de 200 peticiones: existe 1,34 ms; libre 1,24 ms; reservado 1,31 ms; inválido 1,25 ms. No se distinguen.
- **Límite:**
  - 300 peticiones **concurrentes** desde una misma IP, alternando `/direccion` y `/subdominio-disponible`: exactamente **120** con 200 y **180** con 429, con `Retry-After: 900` y `Cache-Control: no-store`. El límite es compartido entre las dos rutas y no se rebasa en ráfaga.
  - Las respuestas 500 también cuentan para el límite, lo cual está bien.
- **CORS:**
  - `https://evil.com` y `https://a.b.sticr.app` (dos niveles) no reciben `Access-Control-Allow-Origin`.
  - `https://crumble.sticr.app` sí lo recibe. Es aceptable porque la respuesta es pública.
  - Ninguna respuesta lleva `Access-Control-Allow-Credentials`.
  - `http://localhost` solo se permite fuera de producción (comportamiento que ya existía).
- **Errores:** con la base apagada, `/direccion` → `500 {"error":"Error interno del servidor", ...}`, sin traza ni consulta. La traza solo queda en el log del servidor. El frontend trata ese 500 como «no se sabe» y deja el ingreso.
- **SQL:** es parametrizado (`$1`); no se concatena texto.
- **`registrar-empresa`** (encendido solo para la prueba): `ab` y `x`×40 → 400 «Debe tener entre 3 y 30 caracteres»; `crumble` → 400 «Ese nombre está reservado»; `nuevo-ok` → 201. El login de `ab` y de `x`×40 sigue en 200, así que el cambio solo afecta a la creación.
- **Frontend (lectura del código):**
  - El nombre sale de `location.hostname`, que ya está limitado por `/^([a-z0-9-]+)\.sticr\.app$/`, y se escribe con `textContent`.
  - `document.title` es fijo y no se usa `innerHTML` con el nombre.
  - La consulta usa `encodeURIComponent`, `credentials: 'omit'` y `cache: 'no-store'`, con un tiempo límite de 8 s.
  - Solo se acepta `existe` si es booleano.
  - El formulario solo se quita con `existe === false`. Con red caída, 429, 5xx, tiempo agotado o una respuesta rara, se sigue con el ingreso de siempre.
  - La API responde a un subdominio cualquiera que la llame (sin credenciales), así que un tercero no puede forzar un `false` para un cliente real. Llenarle el límite de consultas a su IP solo provoca 429, que deja el ingreso.
- **Secretos:** no hay gitleaks en el entorno. Busqué con expresiones regulares (claves de Stripe, `whsec_`, JWT, URL de Postgres con contraseña, `secret`/`password` literales) en el diff de las dos ramas y en todo el historial del backend. Solo aparecen valores de prueba (`clave-larga-1` y una URL falsa `localhost:1` en las pruebas). `.env.example` solo agrega el nombre `NOMBRES_MAX_POR_IP`.
- **Dependencias:** `npm audit --omit=dev` → 1 alto y 1 moderado (ver H-2). El `package-lock.json` está versionado y esta rama no lo cambia.

## Qué no pude revisar
- **Producción:** si existen empresas con nombres heredados (H-1). Requiere una consulta de solo lectura que debe correr el dueño o DevOps.
- **Cómo Railway arma `X-Forwarded-For`** y si el servicio recibe tráfico IPv6.
- **El frontend en un navegador:** no lo ejecuté yo. Me baso en la lectura del código y en la prueba Playwright de la entrega (17/17).
- **Cabeceras de `planilla-web`** (CSP, HSTS) al servir `index.html`: el cambio no las toca y no las verifiqué.
- **Escaneo de secretos con gitleaks:** solo hice la búsqueda por expresiones regulares descrita arriba.

## Decisiones tomadas
- **No marco la enumeración como alta.** Ya era posible, sin límite, por `/api/auth/subdominio-disponible`; el cambio la reduce.
- **H-2 es anterior a este cambio, pero lo marco como bloqueante.** El estándar no distingue y el aviso se alcanza sin sesión.

## Pendientes y riesgos
- Para pasar a APROBADO:
  - **H-1:** corregirlo y agregar la prueba, o mostrar el conteo 0 de producción.
  - **H-2:** `npm audit fix`, con la suite completa pasando.
- Con eso, vuelvo a revisar solo los archivos tocados.

## Preguntas para el Project Manager
- ¿Prefieres corregir H-1 en el código (recomendado) o conseguir la consulta de solo lectura en producción?
- ¿`npm audit fix` va en esta rama o en un PR aparte que se fusione antes?

## Dependencias nuevas
- Ninguna en el cambio revisado.

## Re-revisión (18 nov 2026)

- **Qué se revisó:** solo lo corregido. En el backend, el commit `90f5b88` sobre `3c93808`, con `src/subdominios.js`, `src/routes/auth.routes.js`, `src/limiteIntentos.js`, `db/seed-admin.js` y `package-lock.json`, más las pruebas nuevas. En el frontend, el commit `287485d` sobre `7db6590`.
- **Entorno:** worktrees propios. Postgres 16 desechable en `/var/lib/postgresql/seg-rr2-subdom-7c41`, puerto 55491, y el servidor local en el 55492. Todo fue en local, sin Railway ni datos reales.
- **Veredicto:** **APROBADO**. Ya no quedan hallazgos críticos ni altos.

### Estado de cada hallazgo
| Hallazgo | Estado | Evidencia |
|---|---|---|
| H-1 (alto) — clientes con nombre heredado sin ingreso | **Corregido** | `nombreParaConsultar` acepta cualquier etiqueta DNS de 1 a 63 caracteres y solo excluye los 8 de `NUNCA_CLIENTE`, sin reglas de venta. Sembré empresas `ab`, `a`, `x`×40, `y`×63 y `a--b`: todas dan `{"existe":true}`, y `" AB "` también. `crumble` y `www`, aunque tengan fila, dan `false`. También dan `false`: `admin`, `api`, `app`, `pasteleria-demo`, un nombre libre, `z`×64, `-ab`, `ab-`, `a.b`, `''`, `%00`, punycode inexistente, el parámetro sin valor, repetido, `valor[]` y `valor[x]`. Todos los `false` son idénticos byte a byte y llevan `Cache-Control: no-store`. |
| H-1 — tiempo uniforme | **Se mantiene** | Mediana de 300 peticiones: existe 1,49 ms, libre 1,46 ms, `crumble` con fila 1,36 ms, inválido 1,29 ms. Todos los casos hacen la misma consulta parametrizada. La diferencia de ~0,2 ms queda dentro del ruido de red y no permite distinguir los casos de forma útil. |
| H-2 (alto) — `npm audit` | **Corregido** | `npm ci` con el lock nuevo da body-parser 1.20.9 y qs 6.16.2. `npm audit --omit=dev` → **found 0 vulnerabilities**. |
| M-1 (medio) — enumeración, IPv6 | **Mitigado** | `claveDeIp` agrupa IPv6 por /64 y normaliza `::ffff:a.b.c.d` a IPv4. Con 200 direcciones distintas del mismo /64: 120 respuestas 200 y 80 respuestas 429. La forma larga del mismo /64 recibe 429 (comparte la clave). Otro /64 da 200. `::ffff:198.51.100.5` y `198.51.100.5` comparten cupo (120 y luego 429), y la IP vecina no se ve afectada. Queda como **recomendación**: si hay varias réplicas, el límite tiene que ir a un almacén compartido. |
| `seed-admin` | **Correcto** | Rechaza con código de salida 1 los nombres que no son etiqueta DNS (`a.b`, `-ab`, 64 caracteres, con espacio). Con un nombre que no cumple las reglas de venta o que está en `NUNCA_CLIENTE` solo avisa y lo crea, lo cual tiene sentido para `admin`. |
| B-1 (bajo) — lista repetida | **Abierto (bajo)** | Hoy las tres copias coinciden: los 8 nombres en el `<head>`, en `NUNCA_CLIENTE` de `index.html` y en `src/subdominios.js`. La prueba del backend compara contra una copia fija, no contra el HTML del frontend, así que un cambio en un solo repositorio no lo detecta. |
| B-2 (bajo) — `admin.sticr.app` | **Abierto (decisión del PM)** | Sin cambios. |
| Frontend `287485d` | **Sin impacto en seguridad** | Solo agrega 4 líneas de CSS de contraste en el ingreso con tema claro. No cambia el script. |

### Pruebas
- **Suite completa del backend:** `TEST_DATABASE_URL=… npm test` → 113 pruebas, 112 pasan y 1 falla: «las peticiones en vuelo durante SIGTERM se completan antes de salir».
  - Esa prueba depende del tiempo y está en `test/cierre-arranque.test.js`, que el commit no toca.
  - Al correr ese archivo solo 3 veces, pasó 6 de 6 en cada corrida.
  - La tomo como intermitente y ajena a este cambio. Se lo anoto a QA.

### Observación (no bloquea)
- El límite del **login** sigue contando por `String(req.ip)`, sin agrupar IPv6 por /64. No era parte de este cambio. Recomiendo usar también ahí `claveDeIp` en una próxima ola.

### Qué sigue sin revisarse
- **Producción:** con H-1 corregido, la consulta de solo lectura ya no hace falta.
- **Railway:** no verifiqué cómo arma `X-Forwarded-For` ni si llega tráfico IPv6.
- **Frontend en navegador:** no lo ejecuté yo.
