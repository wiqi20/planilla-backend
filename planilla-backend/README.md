# Backend — Control de Planilla (sticr.com)

Backend multi-empresa para el Control de Planilla. Cada cliente de sticr.com
(cada "empresa") tiene sus propios empleados, colillas, reportes y usuarios,
completamente aislados entre sí dentro de la misma base de datos.

## Qué incluye esta primera fase

- Registro de empresas nuevas (`/api/auth/registrar-empresa`) — cuando vendes
  un subdominio, esto es lo que crea la cuenta del cliente.
- Login con JWT (`/api/auth/login`).
- CRUD de empleados, con las mismas reglas de negocio del frontend
  (correo único, vacaciones bloqueadas si no hay 1 año de antigüedad).
- Cálculo de colillas del lado del servidor (nunca confía en montos que
  mande el navegador) con el flujo de "calcular" (vista previa) vs.
  "guardar" (lo que realmente cuenta para el reporte).
- Reportes generados a partir de las colillas ya guardadas de un período.
- Gestión de usuarios administradores por empresa (crear, editar, eliminar,
  con protección para que nunca te quedes sin ningún usuario).
- Aislamiento multi-empresa verificado: cada request solo puede leer/escribir
  los datos de la empresa a la que pertenece su token.

Lo que falta para la fase 2 (cuando quieras seguir): conectar el frontend
HTML actual a esta API en vez de `localStorage`, y mover el envío de correos
a un proveedor real (Resend, SendGrid, etc.) en vez de `mailto:`.

## Estructura

```
planilla-backend/
├── db/
│   ├── schema.sql       # Tablas (empresas, usuarios, empleados, colillas, reportes)
│   └── migrate.js       # Aplica schema.sql contra DATABASE_URL
├── src/
│   ├── server.js        # Punto de entrada
│   ├── db.js            # Conexión a PostgreSQL
│   ├── auth.js          # bcrypt + JWT
│   ├── calculo.js        # Misma lógica de cálculo que el frontend
│   ├── middleware/
│   │   └── requireAuth.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── empleados.routes.js
│   │   ├── colillas.routes.js
│   │   ├── reportes.routes.js
│   │   └── admin.routes.js
│   └── utils/
│       └── asyncHandler.js
├── .env.example
└── package.json
```

## Desplegar en Railway (recomendado para empezar)

Railway te da PostgreSQL administrado + hosting del backend con muy poca
configuración, y soporta dominios personalizados (lo que necesitas para que
`cliente1.sticr.com` apunte a tu backend).

1. **Crea una cuenta** en [railway.app](https://railway.app) (puedes entrar con GitHub).
2. **Sube este proyecto a un repositorio de GitHub** (si no sabes cómo,
   dímelo y te ayudo con los comandos de git).
3. En Railway: **New Project → Deploy from GitHub repo** y selecciona el repo.
4. En el mismo proyecto: **New → Database → Add PostgreSQL**. Railway crea
   la base y te da automáticamente la variable `DATABASE_URL` — no la copies
   a mano, Railway la conecta sola a tu servicio si están en el mismo proyecto.
5. En tu servicio del backend, pestaña **Variables**, agrega:
   - `JWT_SECRET` → genera uno con:
     ```
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
   - `JWT_EXPIRES_IN` → `12h` (opcional, ese es el default)
6. Pestaña **Settings** de tu servicio → **Deploy** → confirma que el
   *Start Command* sea `npm start` y que corra `npm install` antes (Railway
   lo detecta solo por el `package.json`).
7. **Ejecutar la migración una vez** (crea las tablas): en Railway puedes
   abrir una terminal del servicio (**Settings → Deploy → View Logs** tiene
   un botón de terminal, o usa el CLI de Railway) y corre:
   ```
   npm run migrate
   ```
8. Railway te da una URL pública (`algo.up.railway.app`). Pruébala:
   ```
   curl https://algo.up.railway.app/health
   ```
   Debe responder `{"ok":true}`.
9. **Dominio propio**: en **Settings → Networking → Custom Domain**, agrega
   por ejemplo `api.sticr.com` y sigue las instrucciones para el registro
   CNAME en tu proveedor de DNS. Ahí es donde tu frontend (en cada subdominio
   de cliente) apuntará sus peticiones.

Cuando quieras, en la fase 2 conectamos el HTML actual para que llame a esta
API en vez de guardar todo en el navegador.

## Desarrollo local

```bash
npm install
cp .env.example .env      # y completa DATABASE_URL / JWT_SECRET
npm run migrate           # crea las tablas
npm run dev                # servidor con recarga automática
```

## Seguridad — qué SÍ y qué NO resuelve esto

- Las contraseñas se guardan con `bcrypt` (nunca en texto plano).
- Los tokens son JWT firmados; sin el `JWT_SECRET` correcto nadie puede
  fabricar uno válido.
- Cada tabla de negocio tiene `empresa_id`, y **toda** query filtra por el
  `empresaId` que viene del token — un cliente nunca puede ver datos de otro
  aunque adivine un ID.
- Ningún monto de dinero se calcula ni se confía del lado del navegador: el
  servidor siempre recalcula antes de guardar.

Lo que esto todavía NO incluye (para cuando quieras seguir creciendo):
recuperación de contraseña por correo, roles distintos dentro de una empresa
(hoy todo usuario admin puede todo), límite de intentos de login (rate
limiting) y auditoría de quién hizo qué cambio.
