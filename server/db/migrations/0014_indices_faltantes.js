/* Índices que faltaban en las tablas que cuelgan de athlete_profile_id o de
   una FK de sesión, y que se consultan por esas columnas en el camino caliente.

   La política declarada en 0001_init.js dice que toda tabla colgada de
   athlete_profile_id lleva un índice compuesto; routines y meal_catalog eran
   las dos excepciones. strength_sessions se filtra por completed_session_id
   (la FK del ON DELETE CASCADE) y plan_decisions por training_plan_id, ambas
   sin índice: cada mensaje del Coach y cada regeneración de plan escaneaban
   secuencialmente. Cuatro sentencias cierran el hueco.

   IF NOT EXISTS porque node-pg-migrate reintenta el up si un deploy anterior
   se cortó a mitad; no queremos que falle por índice ya existente. */
export const shorthands = undefined;

export async function up(pgm) {
  /* Editor de rutinas: se lee por (perfil, código) al abrir y se borra por
     (perfil, código) en cada guardado (server/routes/api.js). */
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_routines_perfil_codigo
    ON routines (athlete_profile_id, codigo_sesion, orden);`);

  /* Catálogo de comidas: listado por (perfil, categoría) en cada carga de
     nutrición (server/db/repositories/nutrition.js). */
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_meal_catalog_perfil_categoria
    ON meal_catalog (athlete_profile_id, categoria);`);

  /* Sesiones de fuerza: export y borrado en cascada por completed_session_id
     (server/domain/account/export.js, FK en 0001_init.js). */
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_strength_sessions_completed
    ON strength_sessions (completed_session_id);`);

  /* Decisiones de plan: se consulta dentro de cada mensaje del Coach y en cada
     regeneración de plan por training_plan_id (server/db/repositories/*.js). */
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_plan_decisions_plan
    ON plan_decisions (training_plan_id);`);
}

export async function down(pgm) {
  pgm.sql(`DROP INDEX IF EXISTS idx_routines_perfil_codigo;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_meal_catalog_perfil_categoria;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_strength_sessions_completed;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_plan_decisions_plan;`);
}
