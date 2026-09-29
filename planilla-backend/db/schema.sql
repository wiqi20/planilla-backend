-- Esquema de base de datos para Control de Planilla (sticr.com)
-- Multi-empresa: todo dato de negocio cuelga de una fila en "empresas".

CREATE TABLE IF NOT EXISTS empresas (
  id               SERIAL PRIMARY KEY,
  nombre           TEXT NOT NULL,
  subdominio       TEXT NOT NULL UNIQUE,        -- ej. 'cliente1' para cliente1.sticr.com
  correo_admin     TEXT,                        -- correo administrativo (remitente de referencia)
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuarios (
  id               SERIAL PRIMARY KEY,
  empresa_id       INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario          TEXT NOT NULL,
  password_hash    TEXT NOT NULL,               -- bcrypt
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, usuario)
);

CREATE TABLE IF NOT EXISTS empleados (
  id                      SERIAL PRIMARY KEY,
  empresa_id              INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre                  TEXT NOT NULL,
  correo                  TEXT NOT NULL,
  salario                 NUMERIC(12,2) NOT NULL,
  fecha_ingreso           DATE NOT NULL,
  vacaciones_disponibles  NUMERIC(6,2) NOT NULL DEFAULT 0,
  activo                  BOOLEAN NOT NULL DEFAULT true,
  creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, correo)
);

CREATE TABLE IF NOT EXISTS colillas (
  id               SERIAL PRIMARY KEY,
  empresa_id       INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  empleado_id      INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  periodo_inicio   DATE NOT NULL,
  periodo_fin      DATE NOT NULL,
  datos            JSONB NOT NULL,              -- horas, dias, montos calculados (ver calculo.js)
  creado_por       TEXT,                        -- usuario administrativo que la generó/editó
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE colillas ADD COLUMN IF NOT EXISTS creado_por TEXT;

-- Una sola colilla "vigente" por empleado y período (se puede recalcular/sobreescribir
-- mientras no se haya cerrado el período, pero solo existe un registro guardado a la vez).
CREATE UNIQUE INDEX IF NOT EXISTS colillas_empleado_periodo_idx
  ON colillas (empleado_id, periodo_inicio, periodo_fin);

CREATE TABLE IF NOT EXISTS reportes (
  id               SERIAL PRIMARY KEY,
  empresa_id       INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo_inicio   DATE NOT NULL,
  periodo_fin      DATE NOT NULL,
  datos            JSONB NOT NULL,              -- snapshot de filas + totales al momento de generarlo
  creado_por       TEXT,                        -- usuario administrativo que lo generó
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE reportes ADD COLUMN IF NOT EXISTS creado_por TEXT;

CREATE TABLE IF NOT EXISTS boletas_vacaciones (
  id               SERIAL PRIMARY KEY,
  empresa_id       INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  empleado_id      INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  dias_disfrutar   NUMERIC(6,2) NOT NULL,
  periodo_inicio   DATE NOT NULL,
  periodo_fin      DATE NOT NULL,
  fecha_generacion DATE NOT NULL,
  creado_por       TEXT,
  actualizado_por  TEXT,
  firma_imagen     TEXT,                        -- foto/escaneo de la boleta firmada, como data URL base64
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE boletas_vacaciones ADD COLUMN IF NOT EXISTS firma_imagen TEXT;

CREATE INDEX IF NOT EXISTS empleados_empresa_idx ON empleados (empresa_id);
CREATE INDEX IF NOT EXISTS colillas_empresa_idx ON colillas (empresa_id);
CREATE INDEX IF NOT EXISTS reportes_empresa_idx ON reportes (empresa_id);
CREATE INDEX IF NOT EXISTS boletas_vacaciones_empresa_idx ON boletas_vacaciones (empresa_id);
