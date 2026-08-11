export const shorthands = undefined;

/* La relevancia de una cita forma parte de su trazabilidad. Si solo guardamos
   el número, al volver a cargarla no sabemos si procede del reranker, de la
   similitud coseno o si entró como relleno para completar el contexto. */
export async function up(pgm) {
  pgm.sql(`ALTER TABLE plan_decision_citations
    ADD COLUMN IF NOT EXISTS score_type text,
    ADD COLUMN IF NOT EXISTS es_relleno boolean NOT NULL DEFAULT false;`);
}

export async function down(pgm) {
  pgm.sql(`ALTER TABLE plan_decision_citations
    DROP COLUMN IF EXISTS es_relleno,
    DROP COLUMN IF EXISTS score_type;`);
}
