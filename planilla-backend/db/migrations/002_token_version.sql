-- S-05: cambiar la contraseña invalida los tokens (sesiones) anteriores.
-- Cada usuario tiene un contador; el token lo lleva (campo "tv") y requireAuth lo compara en cada petición.
-- Los tokens emitidos antes de esta migración no traen "tv": se tratan como versión 0, que es el valor
-- inicial de todos los usuarios, así que siguen valiendo hasta que se cambie la contraseña de ese usuario.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
