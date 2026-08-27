/* Migración 0015 — tabla ai_query_logs para observabilidad (Fase 10).

   Esquema definido en docs/03-modelo-datos.md §9:
     id, athlete_profile_id FK, tipo (coach|razonamiento|ingesta),
     consulta_original, consulta_ampliada, chunks_recuperados (jsonb: ids+scores),
     chunks_finales (jsonb), provider, model, tokens_in, tokens_out, coste_estimado,
     latencia_ms, citas_descartadas (jsonb), created_at.

   Reglas duras (docs/09-evaluacion-observabilidad.md, docs/03-modelo-datos.md):
     - No duplicar datos de salud: guardar athlete_profile_id y referenciar, no copiar.
     - Purga automática a los 90 días (ver repo aiQueryLogs en server/db/repositories/).
     - El provider/model identifican la configuración usada (no datos sensibles).

   Esta tabla construyeSWEP sobre la biblioteca (document_chunks) y persiste el
   protocolo de una consulta al RAG para poder auditarla a posteriori y ejecutar
   la evaluación completa en un comando (npm run eval). */
export const shorthands = undefined;
export async function up(pgm) {
  /* idempotente: las migraciones de node-pg-migrate se reintentan si un deploy
     se cortó a mitad; IF NOT EXISTS protege contra que falle por tabla ya existente. */
  pgm.sql(`CREATE TABLE IF NOT EXISTS ai_query_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    tipo text NOT NULL CHECK (tipo IN ('coach', 'razonamiento', 'ingesta')),
    consulta_original text,
    consulta_ampliada text,
    chunks_recuperados jsonb,
    chunks_finales jsonb,
    provider text NOT NULL,
    model text NOT NULL,
    tokens_in bigint,
    tokens_out bigint,
    coste_estimado numeric,
    latencia_ms bigint,
    citas_descartadas jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );`);

  /* Índice en el camino caliente: auditar las consultas de un atleta por fecha. */
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_ai_query_logs_perfil_fecha
    ON ai_query_logs (athlete_profile_id, created_at DESC);`);
}
export async function down(pgm) {
  pgm.sql(`DROP TABLE IF EXISTS ai_query_logs;`);
}
