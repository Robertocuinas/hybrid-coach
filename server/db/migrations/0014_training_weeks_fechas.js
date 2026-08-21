/* El planificador semanal (server/domain/planning/application.js) necesita la
   fecha canónica de cada semana maestra (training_weeks.inicio) para generar
   propuestas. La migración 0010 la añadió y luego la eliminó al reescribirse,
   dejando el código y el esquema inconsistentes: el planner semanal fallaba
   con MASTER_WEEK_DATE_REQUIRED. Se recrea la columna y su pareja `fin`. */

export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`ALTER TABLE training_weeks ADD COLUMN IF NOT EXISTS inicio date;`);
  pgm.sql(`ALTER TABLE training_weeks ADD COLUMN IF NOT EXISTS fin date;`);
}

export async function down(pgm) {
  pgm.sql(`ALTER TABLE training_weeks DROP COLUMN IF EXISTS inicio;`);
  pgm.sql(`ALTER TABLE training_weeks DROP COLUMN IF EXISTS fin;`);
}
