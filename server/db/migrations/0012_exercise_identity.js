/* Identidad canónica de ejercicios.

   Hasta ahora `strength_exercises` se identificaba por `nombre`, texto libre, y
   `findOrCreateExercise()` emparejaba comparando esa cadena. Eso convierte
   "Press banca", "Bench Press" y "Barbell Bench Press" en tres ejercicios
   distintos con tres historiales de carga separados, que es justo lo que hay
   que evitar antes de importar un catálogo externo.

   Dos identidades, deliberadamente distintas:

     externa    (provider, external_id) — la del catálogo de origen. Única.
     interna    canonical_name — nombre normalizado, para los propios.

   Todo lo que ya existe pasa a `provider = 'custom'`: son ejercicios del
   atleta y deben seguir funcionando igual (§33 del encargo).

   Aditiva y sin restricciones que puedan fallar con datos históricos: no se
   impone unicidad sobre `canonical_name` porque una instalación existente
   puede tener duplicados legítimos que nadie ha limpiado todavía. */
export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`ALTER TABLE strength_exercises
    ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'custom',
    ADD COLUMN IF NOT EXISTS external_id text,
    ADD COLUMN IF NOT EXISTS canonical_name text,
    ADD COLUMN IF NOT EXISTS target text,
    ADD COLUMN IF NOT EXISTS secondary_muscles text[],
    ADD COLUMN IF NOT EXISTS equipment text,
    ADD COLUMN IF NOT EXISTS body_part text,
    ADD COLUMN IF NOT EXISTS media_url text,
    ADD COLUMN IF NOT EXISTS last_synced timestamptz;`);

  pgm.sql(`ALTER TABLE strength_exercises
    ADD CONSTRAINT strength_exercises_provider_check
    CHECK (provider IN ('custom', 'exercisedb')) NOT VALID;`);

  /* Un ejercicio externo solo puede existir una vez. PostgreSQL permite varios
     NULL en un índice único, así que esto no afecta a los `custom`, que no
     tienen external_id. */
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_strength_exercises_external
    ON strength_exercises (provider, external_id)
    WHERE external_id IS NOT NULL;`);

  /* Búsqueda por nombre normalizado dentro del ámbito de un perfil. No es
     único: sirve para encontrar candidatos, no para impedir duplicados. */
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_strength_exercises_canonical
    ON strength_exercises (canonical_name, athlete_profile_id);`);

  /* Relleno del nombre canónico de lo ya existente, con la misma normalización
     que aplica el código: minúsculas, sin acentos, sin puntuación, espacios
     colapsados y recortados.

     `translate()` en vez de `unaccent()`: la extensión unaccent no está
     garantizada en todas las instalaciones y una migración no puede depender
     de algo que quizá no esté instalado. */
  pgm.sql(`UPDATE strength_exercises
     SET canonical_name = btrim(regexp_replace(
           translate(lower(nombre), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
           '[^a-z0-9]+', ' ', 'g'))
   WHERE canonical_name IS NULL;`);
}

export async function down(pgm) {
  pgm.sql(`DROP INDEX IF EXISTS idx_strength_exercises_external;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_strength_exercises_canonical;`);
  pgm.sql(`ALTER TABLE strength_exercises DROP CONSTRAINT IF EXISTS strength_exercises_provider_check;`);
  pgm.sql(`ALTER TABLE strength_exercises
    DROP COLUMN IF EXISTS provider,
    DROP COLUMN IF EXISTS external_id,
    DROP COLUMN IF EXISTS canonical_name,
    DROP COLUMN IF EXISTS target,
    DROP COLUMN IF EXISTS secondary_muscles,
    DROP COLUMN IF EXISTS equipment,
    DROP COLUMN IF EXISTS body_part,
    DROP COLUMN IF EXISTS media_url,
    DROP COLUMN IF EXISTS last_synced;`);
}
