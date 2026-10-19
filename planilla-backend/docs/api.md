# API de planilla-backend

Servicio multi-empresa del Control de Planilla (sticr.app). Todas las respuestas son JSON (salvo `204`).
Los montos están en colones, como números decimales (la conversión a centavos enteros está pendiente de una decisión del dueño y no forma parte de esta versión).

## Convenciones

### Quién puede usar cada ruta

| Etiqueta | Significado |
|---|---|
| **Público** | Sin credenciales. |
| **Sitio** | Solo el sitio sticr.app: encabezado `x-provision-secret` igual a `PROVISION_SECRET`. |
| **Sesión** | Usuario administrador de una empresa: encabezado `Authorization: Bearer <token>` (el token sale de `POST /api/auth/login`). Toda consulta queda limitada a la empresa del token. |
| **Sesión (no demo)** | Como **Sesión**, pero la empresa demo recibe `403`. |

Lo que no está listado aquí no existe (`404`). Hoy todo usuario de una empresa es administrador y puede todo dentro de su empresa.

### Formato de error (todas las rutas)

```json
{ "error": "Texto corto de siempre", "mensaje": "Texto en español claro para mostrar a la persona" }
```

- `error` es el texto que el frontend ya leía; no cambia.
- `mensaje` siempre está presente en cualquier respuesta con estado 4xx o 5xx.
- Algunas respuestas agregan campos extra, que se conservan: `codigo` (`suspendida`, `ya-configurada`), `vacacionesDisponibles`, `faltantes`, `estado` (en `/health`).
- Nunca incluyen trazas, consultas ni rutas internas.

Errores que puede dar cualquier ruta:

| Estado | `error` | Cuándo |
|---|---|---|
| 400 | `El cuerpo de la petición no es un JSON válido` | JSON mal formado |
| 400 | `El texto contiene caracteres no permitidos` | Algún texto (cuerpo, parámetros de búsqueda o ruta) contiene el byte NUL (`\u0000` / `%00`) |
| 404 | `Ruta no encontrada` | La ruta no existe |
| 413 | `El cuerpo de la petición es demasiado grande` | Cuerpo mayor a 100 kB |
| 500 | `Error interno del servidor` | Fallo inesperado |

Errores de las rutas con **Sesión** (todas las de `/api/empleados`, `/api/colillas`, `/api/reportes`, `/api/boletas`, `/api/admin`):

| Estado | `error` | Cuándo |
|---|---|---|
| 401 | `No autenticado` | Falta el encabezado `Authorization: Bearer ...` |
| 401 | `Sesión inválida o expirada` | Token inválido, vencido, de un usuario borrado, o emitido antes de un cambio de contraseña (ver más abajo) |
| 403 | `Esta cuenta está suspendida. Contacta a STI para reactivarla.` (`codigo: "suspendida"`) | La empresa está suspendida |

### Sesiones y cambio de contraseña (S-05)

El token es un JWT HS256 que lleva `tv` (la "versión de sesión" del usuario). Cada petición compara `tv` con `usuarios.token_version`.
Cambiar la contraseña de un usuario sube su `token_version` en 1 y **todos** los tokens anteriores de ese usuario dejan de servir (`401`).

Regla para tokens anteriores a esta versión: un token sin `tv` cuenta como versión 0, que es el valor inicial de todos los usuarios. Esos tokens siguen valiendo hasta que se cambie la contraseña de su usuario (entonces dejan de valer). Nadie es desconectado por el despliegue.

### Salud

#### `GET /health` — Público, sin límite de intentos
Hace `SELECT 1` a la base con un tiempo máximo (`HEALTH_TIMEOUT_MS`, 2 s por defecto). No devuelve versiones, direcciones ni detalles.

- `200` `{ "estado": "ok" }`
- `503` `{ "estado": "sin-base" | "apagando", "error": "Servicio no disponible", "mensaje": "El servicio no está disponible en este momento." }` — la base no contestó a tiempo o falló, o el servicio está apagándose (SIGTERM/SIGINT).

## Autenticación — `/api/auth`

#### `POST /api/auth/login` — Público (con límite de intentos)
Cuerpo: `{ "subdominio": string, "usuario": string, "password": string }` (los tres son texto).
- `200` `{ "token": string, "empresa": { "id", "nombre", "subdominio" }, "usuario": { "id", "usuario" } }`
- `400` `Faltan campos requeridos` · `Empresa, usuario y contraseña deben ser texto` · NUL en algún texto
- `401` `Empresa, usuario o contraseña incorrectos`
- `403` `Esta cuenta está suspendida...` (`codigo: "suspendida"`)
- `429` `Demasiados intentos fallidos. Espera N minuto(s) e inténtalo de nuevo.` con encabezado `Retry-After` (segundos). Límites por ventana de 15 min: 10 por IP+usuario, 40 por IP, 100 por usuario; los aciertos no cuentan; la demo solo cuenta por IP.

#### `POST /api/auth/registrar-empresa` — Público, **apagada por defecto**
Solo funciona con `ALLOW_PUBLIC_REGISTRATION=true` (instalaciones individuales antiguas). Cuerpo: `{ "nombreEmpresa", "subdominio", "usuario", "password" (mín. 8) }`.
- `201` `{ "token", "empresa": { "id", "nombre", "subdominio" }, "usuario": { "id", "usuario" } }`
- `400` `Faltan campos requeridos` · formato de subdominio · contraseña corta
- `403` `El registro público está desactivado`
- `409` `Ese subdominio ya está en uso`

#### `GET /api/auth/subdominio-disponible?valor=<texto>` — Público
- `200` `{ "disponible": boolean, "motivo"?: string }` (`motivo` solo si no es válido o está reservado)

## Aprovisionamiento — `/api/provision` (Sitio)

Sin `PROVISION_SECRET` configurado (mínimo 24 caracteres) todas responden `503 El aprovisionamiento no está configurado`. Con un encabezado incorrecto, `403 No autorizado`.

#### `GET /api/provision/subdominio-disponible?valor=<texto>`
- `200` `{ "disponible": boolean, "valor"?: string, "motivo"?: string }`

#### `POST /api/provision/empresa`
Cuerpo: `{ "nombreEmpresa": string (2–120), "subdominio": string, "stripeSubscriptionId": string }`. Idempotente: la misma suscripción devuelve siempre la misma empresa.
- `201` `{ "empresa": { "id", "nombre", "subdominio", "activa" }, "creada": true }`
- `200` igual, con `"creada": false` (ya existía para esa suscripción)
- `400` `Faltan nombreEmpresa o stripeSubscriptionId` · motivo del subdominio inválido · NUL
- `409` `Ese subdominio ya está en uso`

#### `POST /api/provision/admin`
Crea el primer administrador. Cuerpo: `{ "subdominio", "stripeSubscriptionId", "usuario" (3–40), "password" (mín. 8) }`.
- `201` `{ "empresa": { "id", "nombre", "subdominio" } }`
- `400` `Faltan campos requeridos` · largo de usuario · contraseña corta
- `404` `Empresa no encontrada`
- `409` `Esta cuenta ya fue configurada` (`codigo: "ya-configurada"`)

#### `POST /api/provision/estado`
Suspende o reactiva sin borrar datos. Cuerpo: `{ "stripeSubscriptionId": string, "activa": boolean }`.
- `200` `{ "empresa": { "id", "subdominio", "activa" } }`
- `400` `Faltan stripeSubscriptionId o activa (true/false)`
- `404` `No hay una empresa para esa suscripción`

#### `POST /api/provision/demo/reiniciar`
Borra y recrea la empresa demo con datos de ejemplo. `200` `{ "ok": true }`.

## Colaboradores — `/api/empleados` (Sesión)

Objeto colaborador: `{ id, nombre, correo, salario, fecha_ingreso, vacaciones_disponibles, activo }`.

#### `GET /api/empleados`
`200` lista de colaboradores de la empresa, ordenada por nombre.

#### `POST /api/empleados`
Cuerpo: `{ "nombre" (2–120), "correo", "salario" (> 0, ≤ 100 000 000), "fechaIngreso" (AAAA-MM-DD, no futura), "vacacionesDisponibles"? (0–90) }`. Sin 1 año de antigüedad las vacaciones quedan en 0.
- `201` colaborador · `400` `Faltan campos requeridos` o el motivo de validación · `409` `Ya existe un colaborador con ese correo`

#### `PUT /api/empleados/:id`
Cuerpo: cualquiera de `nombre, correo, salario, fechaIngreso, vacacionesDisponibles, activo` (`null` = no cambiar).
- `200` colaborador · `400` validación · `404` `Colaborador no encontrado` (también si es de otra empresa) · `409` correo repetido

#### `DELETE /api/empleados/:id`
`204` · `404` `Colaborador no encontrado`.

## Colillas — `/api/colillas` (Sesión)

Cuerpo común: `{ "empleadoId", "periodoInicio", "periodoFin" (AAAA-MM-DD, máx. 62 días), "feriadoNombre"?, "horasExtra"?, "horasSinGoce"?, "horasFeriado"? (0–400), "diasVacaciones"?, "diasSinGoceCompletos"?, "diasIncapacidad"?, "diasLicenciaMP"?, "diasLicenciaCuido"? (enteros 0–31) }`.

#### `POST /api/colillas/calcular`
Vista previa; no guarda nada.
- `200` `{ "empleado": { id, nombre, correo }, "inputs": {...}, "feriadoNombre", "resultado": { salarioQuincenal, brutoQuincenal, ccss, renta, neto, ... } }`
- `400` `Faltan empleadoId, periodoInicio o periodoFin` · validación · `El colaborador solo tiene N día(s) de vacaciones disponibles` (con `vacacionesDisponibles`) · `Indica a cuál feriado corresponden esas horas`
- `404` `Colaborador no encontrado`

#### `POST /api/colillas/guardar`
Recalcula en el servidor, descuenta vacaciones y guarda (sobrescribe la del mismo colaborador y período). Mismos errores que `calcular`.
- `201` `{ id, periodo_inicio, periodo_fin, datos, creado_por, creado_en }`
- `500` `No se pudo guardar la colilla`

#### `GET /api/colillas?empleadoId=&periodoInicio=&periodoFin=`
`200` lista `{ id, empleado_id, empleado_nombre, periodo_inicio, periodo_fin, datos, creado_por, creado_en }` · `400` filtros inválidos.

## Reportes — `/api/reportes` (Sesión)

#### `POST /api/reportes/generar`
Cuerpo: `{ "periodoInicio", "periodoFin" }`. Arma el reporte con las colillas ya guardadas de ese período exacto.
- `201` `{ id, periodo_inicio, periodo_fin, datos: { filas, totales, faltantes }, creado_por, creado_en }`
- `400` `Faltan periodoInicio o periodoFin` · validación · `404` `No hay ninguna colilla guardada todavía para ese período exacto` (con `faltantes`)

#### `GET /api/reportes`
`200` historial de reportes de la empresa.

## Boletas de vacaciones — `/api/boletas` (Sesión)

#### `POST /api/boletas/generar`
Cuerpo: `{ "empleadoId", "diasDisfrutar" (entero > 0), "periodoInicio", "periodoFin" }`. Descuenta los días del saldo.
- `201` boleta + `empleado_nombre`, `empleado_correo`
- `400` `Falta empleadoId` · `empleadoId debe ser un número entero positivo` · reglas de fechas y saldo · `404` `Colaborador no encontrado` · `500` `No se pudo generar la boleta`

#### `GET /api/boletas?empleadoId=&periodoInicio=&periodoFin=`
`200` lista (con `tiene_firma`, sin la imagen) · `400` filtros inválidos.

#### `GET /api/boletas/:id/firma`
`200` `{ "firmaImagen": string | null }` · `404` `Boleta no encontrada`.

#### `PUT /api/boletas/:id`
Corrige la boleta; ajusta el saldo solo por la diferencia. Cuerpo como `generar` (sin `empleadoId`). `200` boleta · `400` · `404` `Boleta no encontrada` / `Colaborador no encontrado`.

#### `PUT /api/boletas/:id/firma`
Cuerpo: `{ "firmaImagen": "data:image/(png|jpeg|jpg|webp);base64,..." }` (máx. 2 000 000 caracteres). `200` boleta · `400` falta, formato o tamaño · `404`.

## Administración de la empresa — `/api/admin` (Sesión)

En la empresa demo, todo lo que no sea `GET` en `/api/admin/usuarios` y `/api/admin/empresa` responde `403 Esta acción no está disponible en la demo.`

#### `GET /api/admin/empresa`
`200` `{ id, nombre, subdominio, correo_admin }` · `404`.

#### `PUT /api/admin/empresa`
Cuerpo: `{ "nombre"?: string (≤120), "correoAdmin"?: string (≤254, formato de correo) }`. `200` empresa · `400`.

#### `GET /api/admin/usuarios`
`200` `[ { id, usuario, creado_en } ]`.

#### `POST /api/admin/usuarios`
Cuerpo: `{ "usuario": string (≤40), "password": string (mín. 8) }`.
- `201` `{ id, usuario, creado_en }` · `400` · `409` `Ya existe un usuario con ese nombre`

#### `PUT /api/admin/usuarios/:id`
Cuerpo: `{ "usuario"?: string (≤40), "password"?: string (mín. 8) }`.
- `200` `{ id, usuario, creado_en }`. Si se envió `password`, **se cierran todas las sesiones de ese usuario** (ver "Sesiones y cambio de contraseña"). Si quien cambia la contraseña es el propio usuario, la respuesta trae además `"token"` (un token nuevo válido) para que su sesión actual no se corte; si la cambia otro administrador, no.
- `400` · `404` `Usuario no encontrado` (también si es de otra empresa) · `409` nombre repetido

#### `DELETE /api/admin/usuarios/:id`
`204` · `400` `Debe existir al menos un usuario administrador` · `404` `Usuario no encontrado`.

## Operación

- **Migraciones:** `db/migrations/NNN_nombre.sql`, aplicadas en orden y cada una en su transacción; se registran en `schema_migrations` con checksum. Corren solas al arrancar (si fallan, el servicio no inicia) o con `npm run migrate`.
- **Apagado ordenado:** con `SIGTERM`/`SIGINT` deja de aceptar conexiones (y `/health` responde 503 `apagando`), termina las peticiones en curso hasta `SHUTDOWN_TIMEOUT_MS` (10 s por defecto), cierra el pool y sale con código 0 (1 si tuvo que cortar peticiones). Una segunda señal sale de inmediato.
- Variables de entorno: ver `.env.example`.
