# Entrega: Frontend (cambio mínimo en backend, excepción acordada con el PM) · Control de Planilla — subdominio inexistente

- **Fecha:** 17 nov 2026
- **Rama / archivos:** `fix/subdominio-inexistente`: `src/subdominios.js`, `src/routes/auth.routes.js`, `test/direccion.test.js`, `docs/api.md`, `README.md`, `.env.example`, este archivo.
- **Veredicto** (solo revisores): pendiente de Seguridad y QA.

## Resumen
Nueva ruta pública `GET /api/auth/direccion?valor=<nombre>` que responde solo `{ existe: boolean }`, para que el frontend (servido en `*.sticr.app`) muestre «Esta dirección no existe» cuando el subdominio no es una empresa. Se reservan los subdominios de otros sistemas de STI y el registro público usa por fin las mismas reglas de nombres que el aprovisionamiento. La parte del frontend está en `planilla-frontend`, rama `fix/subdominio-inexistente`.

## Cambios, uno por uno
1. `src/subdominios.js`
   - `OTROS_SISTEMAS = ['crumble', 'crumble-admin', 'pasteleria-demo', 'pasteleria-demo-admin']`, sumados a `RESERVADOS`. `www`, `admin`, `api`, `planilla` y `planilla-api` ya estaban. Efecto: `POST /api/provision/empresa` y `GET /api/provision/subdominio-disponible` los rechazan («Ese nombre está reservado»).
   - `nombreDeEmpresaPosible(valor)`: devuelve el nombre normalizado si puede ser una empresa (vendible según `validarSubdominio`, o `demo`), o `null` (no es texto, formato inválido, reservado u otro sistema).
2. `src/routes/auth.routes.js`
   - `GET /api/auth/direccion`: `existe` es `true` solo si el nombre es posible **y** hay una fila en `empresas` (activa o suspendida). Siempre hace la misma consulta (`SELECT 1 FROM empresas WHERE subdominio = $1`, con `''` si el nombre no es posible), así que «libre», «inválido», «reservado» y «otro sistema» dan la misma respuesta byte a byte y tardan lo mismo. Nunca devuelve nombre, estado ni id. Una fila con un nombre reservado (datos viejos o un error) igual da `existe:false`.
   - Límite por IP `NOMBRES_MAX_POR_IP` (120 por defecto) en la ventana del login (`LOGIN_VENTANA_MINUTOS`, 15 min), con el limitador en memoria que ya existía (`crearLimitador`). Cuenta **todas** las consultas, se reserva de forma síncrona (una ráfaga no lo supera) y responde `429` con `Retry-After`. `Cache-Control: no-store` en todas sus respuestas.
   - El mismo límite se aplica ahora a `GET /api/auth/subdominio-disponible` (era público y sin límite: hallazgo S-15 de la revisión de seguridad). El sitio sticr.app usa la versión de `/api/provision`, que no cambia.
   - `POST /api/auth/registrar-empresa` (apagado por defecto) valida con `validarSubdominio`: ya no acepta nombres reservados (hallazgo bajo de la revisión de posadasweet). También pasa de 1–63 a 3–30 caracteres, como el aprovisionamiento.
3. `docs/api.md`, `README.md`, `.env.example`: la ruta nueva, el límite y la variable `NOMBRES_MAX_POR_IP`.

## Cómo se comprobó
- `TEST_DATABASE_URL=postgresql://postgres@localhost:55432/planilla_test npm test` (Postgres 16 desechable en local) → **100 de 100** (91 que ya había + 9 nuevas en `test/direccion.test.js`). En `main`, antes del cambio: 91 de 91.
- `npm test` sin base → 30 pasan, 70 se saltan (las de integración), 0 fallan.
- Pruebas nuevas: empresa activa y suspendida → `{existe:true}` y nada más; nombre libre → `false`; demo solo si está creada; los 9 nombres de la lista, formatos inválidos, parámetro ausente o repetido → mismo texto de respuesta que un nombre libre, aunque exista una fila con ese nombre; mediana de tiempo «libre» vs «reservado» con menos de 5 ms de diferencia (medido: 1,67 ms vs 1,56 ms); 429 con `Retry-After` compartido con `subdominio-disponible` y otra IP no afectada; CORS desde `https://crumble.sticr.app`; registro público y aprovisionamiento rechazan los 9 nombres.
- Prueba de mutación: si la ruta deja de filtrar los reservados, falla la prueba 5.
- `curl` contra el servidor local: `existe:true` para una empresa creada, `false` para `crumble`, un nombre libre y `a--b`, con `Cache-Control: no-store` y CORS.

## Decisiones tomadas
- **La respuesta revela si un subdominio es cliente**: es inevitable para esta función y es la misma información que ya da abrir `nombre.sticr.app` (ingreso vs. «no existe»). Se acota con: solo un booleano, misma respuesta y tiempo para todo caso negativo, y límite por IP.
- 120 consultas por IP cada 15 min: el frontend hace una por carga de página; deja holgura a una oficina con muchas personas tras una sola IP.
- Una empresa **suspendida** cuenta como existente: su ingreso ya explica que está suspendida.
- Sin migraciones ni dependencias nuevas.

## Pendientes y riesgos
- El límite está en memoria (una instancia, como el del login). Con varias réplicas, cada una contaría por separado.
- Un atacante con muchas IP puede enumerar nombres a 120 por IP cada 15 min; la existencia de clientes ya es visible abriendo cada subdominio.
- `seed-admin` sigue pudiendo crear la empresa `admin` a mano (la usa `planilla.sticr.app`); `/direccion` responde `false` para `admin` igualmente.
- **Orden de despliegue:** este backend antes o junto con el frontend de la misma rama. Si el frontend sale primero, nadie queda bloqueado (fallo abierto), pero no aparece «no existe» salvo para la lista fija.
- Quien llame a `GET /api/auth/subdominio-disponible` más de 120 veces cada 15 min desde una IP ahora recibe 429. En los repositorios revisados nadie la usa.

## Dependencias nuevas
- Ninguna.

---

## Correcciones tras la revisión (Seguridad: RECHAZADO por H-1 y H-2; QA: RECHAZADO por QA-01)

Informes: `docs/entregas/seguridad-subdominio-inexistente.md` (rama `docs/seguridad-subdominio-inexistente`) y `docs/subdominio-inexistente/qa.md` (frontend, rama `docs/qa-subdominio-inexistente`).

1. **H-1 / QA-01 (alto): una empresa existente ya no puede recibir `existe:false`.** `/direccion` dejó de usar las reglas de venta. Ahora consulta cualquier texto con formato de etiqueta DNS (1 a 63 caracteres, `nombreParaConsultar` en `src/subdominios.js`) y descarta solo los 8 de `NUNCA_CLIENTE` (`crumble`, `crumble-admin`, `pasteleria-demo`, `pasteleria-demo-admin`, `www`, `admin`, `api`, `app`). `existe` = hay fila. Los casos negativos siguen haciendo la misma consulta y dando la misma respuesta. `nombreDeEmpresaPosible` se reemplazó por `nombreParaConsultar`. `planilla` y `planilla-api` ya no están excluidos: si hubiera una fila con ese nombre, existe (el frontend igual no consulta para esas direcciones).
2. **H-2 (alto): `npm audit fix`** dentro del rango semver: `body-parser` 1.20.8 → 1.20.9 y `qs` 6.16.0 → 6.16.2. `package.json` no cambia; el `package-lock.json` queda versionado. `npm audit --omit=dev` y `npm audit` → 0 vulnerabilidades.
3. **M-1 (medio): IPv6 por /64** en el límite de `/direccion` y `/subdominio-disponible` (`claveDeIp` en `src/limiteIntentos.js`). Las IPv4 escritas como IPv6 (`::ffff:a.b.c.d`) cuentan como IPv4 y se ignora el identificador de zona. El límite del login no cambia: sigue con la IP exacta. Sigue en memoria, en una sola instancia.
4. **seed-admin:** exige que `--subdominio` sea una etiqueta DNS de 1 a 63 caracteres (si no, sale con 1 sin tocar la base). Si el nombre no cumple las reglas de venta, avisa y lo crea igual. Si está en `NUNCA_CLIENTE` (por ejemplo `admin`), avisa que esa dirección muestra «no existe».
5. **Pruebas de QA traídas a la rama:** `test/direccion-qa.test.js` (copia de `qa-subdominio-inexistente/direccion-qa.test.js`, solo cambia la ruta del `require`). Corre con `npm test`.

### Cómo se comprobó (correcciones)
- `TEST_DATABASE_URL=postgresql://postgres@localhost:56717/subdomc7_test TEST_PORT=56718 npm test` (Postgres 16 desechable) → **113 de 113**: las 91 de antes, 14 en `test/direccion.test.js` y las 8 de QA.
- Las pruebas nuevas cubren:
  - Empresas heredadas `ab`, `q8`, una de 40 y otra de 63 caracteres, `ayuda` y una con `--` → `existe:true`, también en mayúsculas.
  - QA-B4 (antes fallaba) y QA-B3 → ok.
  - Filas sembradas con `crumble`, `pasteleria-demo`, `www` y `app` → misma respuesta que un nombre libre.
  - Tiempo: libre 1,61 ms y reservado 1,54 ms de mediana.
  - IPv6: 3 direcciones del mismo /64 agotan un límite de 3, una cuarta del mismo /64 da 429 y otro /64 da 200.
  - `claveDeIp` como prueba unitaria.
  - seed-admin: 64 caracteres, `-abc`, `a.b` y un nombre con espacio salen con 1; `o1` se crea con el aviso «no cumple las reglas de venta» y `/direccion` lo ve.
- `npm test` sin base → 32 pasan, 81 se saltan, 0 fallan.
- `npm audit --omit=dev` → `found 0 vulnerabilities`.

### Riesgos que siguen
- La lista `NUNCA_CLIENTE` está repetida en el frontend (`index.html`, dos lugares). Ninguna prueba automática compara los dos repositorios; la prueba del backend fija la lista exacta y el frontend la repite igual.
- El límite sigue en memoria. Con varias réplicas, cada una cuenta por separado (M-1, parte no corregida).
