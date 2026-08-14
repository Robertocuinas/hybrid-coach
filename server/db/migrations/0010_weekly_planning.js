/* Persistencia auditable del planificador semanal IA + RAG.

   `training_plans` sigue siendo el plan maestro. Estas tablas almacenan cada
   ejecución del planificador, sus propuestas inmutables y la decisión humana
   posterior. Una revisión no se convierte en activa hasta que su estado pasa
   a `accepted`; el índice parcial impide dos aceptadas para la misma semana. */
export const shorthands = undefined;

export async function up(pgm) {
  /* Canonización mínima del plan maestro. El hash permite distinguir un plan
     regenerado de una mera resincronización del mismo snapshot sin comparar
     un JSON completo. `inicio` fija la semana natural a la que pertenecen las
     sesiones del maestro. */
  pgm.sql(`ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS structure_hash text;`);
  pgm.sql(`ALTER TABLE training_plans ADD CONSTRAINT training_plans_structure_hash_check
    CHECK (structure_hash IS NULL OR structure_hash ~ '^[0-9a-f]{64}$') NOT VALID;`);
  pgm.sql(`ALTER TABLE training_weeks ADD COLUMN IF NOT EXISTS inicio date;`);
  pgm.sql(`ALTER TABLE athlete_profiles
    ADD COLUMN IF NOT EXISTS current_complaints jsonb NOT NULL DEFAULT '[]'::jsonb;`);

  pgm.sql(`ALTER TABLE planned_sessions
    ADD CONSTRAINT planned_sessions_day_check CHECK (dia_semana IS NULL OR dia_semana BETWEEN 0 AND 6) NOT VALID,
    ADD CONSTRAINT planned_sessions_duration_check CHECK (duracion_min IS NULL OR duracion_min >= 0) NOT VALID;`);
  /* Permite dos sesiones el mismo día si tienen códigos distintos, pero evita
     duplicar la misma sesión durante una resincronización. PostgreSQL permite
     varias filas con codigo_sesion NULL; esas filas no son identificables de
     forma estable y se validarán en el repositorio que las escriba. */
  pgm.sql(`WITH ranked AS (
      SELECT id,
             first_value(id) OVER (
               PARTITION BY training_week_id, codigo_sesion ORDER BY id::text
             ) AS keep_id,
             row_number() OVER (
               PARTITION BY training_week_id, codigo_sesion ORDER BY id::text
             ) AS duplicate_number
        FROM planned_sessions
       WHERE codigo_sesion IS NOT NULL
    )
    UPDATE completed_sessions cs
       SET planned_session_id = ranked.keep_id
      FROM ranked
     WHERE ranked.duplicate_number > 1 AND cs.planned_session_id = ranked.id;`);
  pgm.sql(`WITH ranked AS (
      SELECT id, row_number() OVER (
        PARTITION BY training_week_id, codigo_sesion ORDER BY id::text
      ) AS duplicate_number
        FROM planned_sessions
       WHERE codigo_sesion IS NOT NULL
    )
    DELETE FROM planned_sessions ps USING ranked
     WHERE ranked.duplicate_number > 1 AND ps.id = ranked.id;`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_planned_sessions_week_code
    ON planned_sessions (training_week_id, codigo_sesion);`);

  /* NOT VALID protege despliegues con datos históricos fuera de rango; desde
     esta migración toda escritura nueva sí queda sometida a los checks. */
  pgm.sql(`ALTER TABLE recovery_logs
    ADD CONSTRAINT recovery_logs_calidad_check CHECK (calidad_sueno IS NULL OR calidad_sueno BETWEEN 0 AND 10) NOT VALID,
    ADD CONSTRAINT recovery_logs_fatiga_check CHECK (fatiga IS NULL OR fatiga BETWEEN 0 AND 10) NOT VALID,
    ADD CONSTRAINT recovery_logs_agujetas_check CHECK (agujetas IS NULL OR agujetas BETWEEN 0 AND 10) NOT VALID,
    ADD CONSTRAINT recovery_logs_estres_check CHECK (estres IS NULL OR estres BETWEEN 0 AND 10) NOT VALID,
    ADD CONSTRAINT recovery_logs_motivacion_check CHECK (motivacion IS NULL OR motivacion BETWEEN 0 AND 10) NOT VALID,
    ADD CONSTRAINT recovery_logs_dolor_check CHECK (dolor IS NULL OR dolor BETWEEN 0 AND 10) NOT VALID;`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS planning_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    training_plan_id uuid REFERENCES training_plans(id) ON DELETE SET NULL,
    week_number int,
    kind text NOT NULL,
    status text NOT NULL DEFAULT 'running',
    prompt_version text,
    schema_version text,
    rules_version text,
    provider text,
    model text,
    input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    input_hash text,
    analytics jsonb NOT NULL DEFAULT '{}'::jsonb,
    query_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
    retrieval_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
    validated_output jsonb,
    validation_results jsonb NOT NULL DEFAULT '[]'::jsonb,
    failure jsonb,
    latency_ms int,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT planning_runs_week_check CHECK (week_number IS NULL OR week_number > 0),
    CONSTRAINT planning_runs_kind_check CHECK (kind IN ('weekly_plan', 'coach_change', 'manual_replan')),
    CONSTRAINT planning_runs_status_check CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    CONSTRAINT planning_runs_hash_check CHECK (input_hash IS NULL OR input_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT planning_runs_latency_check CHECK (latency_ms IS NULL OR latency_ms >= 0),
    CONSTRAINT planning_runs_completion_check CHECK (
      (status = 'running' AND completed_at IS NULL) OR
      (status <> 'running' AND completed_at IS NOT NULL)
    )
  );`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_planning_runs_profile_created
    ON planning_runs (athlete_profile_id, created_at DESC);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_planning_runs_plan_week
    ON planning_runs (training_plan_id, week_number, created_at DESC);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_planning_runs_status
    ON planning_runs (status, created_at) WHERE status IN ('running', 'failed');`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS weekly_plan_revisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    training_week_id uuid NOT NULL REFERENCES training_weeks(id) ON DELETE CASCADE,
    planning_run_id uuid NOT NULL REFERENCES planning_runs(id) ON DELETE RESTRICT,
    revision int NOT NULL,
    base_revision_id uuid REFERENCES weekly_plan_revisions(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'draft',
    week_start date NOT NULL,
    week_end date NOT NULL,
    summary text,
    confidence numeric,
    evidence_state text,
    proposed_at timestamptz NOT NULL DEFAULT now(),
    accepted_at timestamptz,
    rejected_at timestamptz,
    superseded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT weekly_plan_revisions_revision_check CHECK (revision > 0),
    CONSTRAINT weekly_plan_revisions_status_check CHECK (status IN ('draft', 'accepted', 'rejected', 'superseded')),
    CONSTRAINT weekly_plan_revisions_dates_check CHECK (week_end >= week_start),
    CONSTRAINT weekly_plan_revisions_confidence_check CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    CONSTRAINT weekly_plan_revisions_evidence_check CHECK (
      evidence_state IS NULL OR evidence_state IN ('sufficient', 'limited', 'none', 'mixed')
    ),
    CONSTRAINT weekly_plan_revisions_decision_time_check CHECK (
      (status = 'draft' AND accepted_at IS NULL AND rejected_at IS NULL AND superseded_at IS NULL) OR
      (status = 'accepted' AND accepted_at IS NOT NULL AND rejected_at IS NULL AND superseded_at IS NULL) OR
      (status = 'rejected' AND rejected_at IS NOT NULL AND accepted_at IS NULL AND superseded_at IS NULL) OR
      (status = 'superseded' AND superseded_at IS NOT NULL AND rejected_at IS NULL)
    ),
    UNIQUE (training_week_id, revision)
  );`);

  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_plan_one_accepted
    ON weekly_plan_revisions (training_week_id) WHERE status = 'accepted';`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_plan_run_revision
    ON weekly_plan_revisions (planning_run_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_weekly_plan_profile_week
    ON weekly_plan_revisions (athlete_profile_id, week_start DESC);`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS weekly_plan_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    weekly_plan_revision_id uuid NOT NULL REFERENCES weekly_plan_revisions(id) ON DELETE CASCADE,
    master_planned_session_id uuid REFERENCES planned_sessions(id) ON DELETE SET NULL,
    session_key text NOT NULL,
    fecha date NOT NULL,
    day_of_week smallint NOT NULL,
    orden int NOT NULL,
    modality text NOT NULL,
    session_type text NOT NULL,
    session_code text,
    title text NOT NULL,
    priority text,
    duration_min int,
    intensity jsonb,
    prescription jsonb NOT NULL DEFAULT '{}'::jsonb,
    objective text,
    public_reason text,
    change_type text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT weekly_plan_sessions_key_check CHECK (char_length(trim(session_key)) BETWEEN 1 AND 120),
    CONSTRAINT weekly_plan_sessions_day_check CHECK (day_of_week BETWEEN 0 AND 6),
    CONSTRAINT weekly_plan_sessions_order_check CHECK (orden >= 0),
    CONSTRAINT weekly_plan_sessions_duration_check CHECK (duration_min IS NULL OR duration_min >= 0),
    UNIQUE (weekly_plan_revision_id, session_key),
    UNIQUE (weekly_plan_revision_id, orden)
  );`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_weekly_plan_sessions_date
    ON weekly_plan_sessions (weekly_plan_revision_id, fecha, orden);`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS planning_run_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    planning_run_id uuid NOT NULL REFERENCES planning_runs(id) ON DELETE CASCADE,
    document_chunk_id uuid NOT NULL REFERENCES document_chunks(id) ON DELETE RESTRICT,
    query_key text NOT NULL DEFAULT 'default',
    query_text text NOT NULL,
    rank int NOT NULL,
    scores jsonb NOT NULL DEFAULT '{}'::jsonb,
    score_type text,
    sent_to_model boolean NOT NULL DEFAULT false,
    used_by_model boolean NOT NULL DEFAULT false,
    is_fill boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT planning_run_evidence_rank_check CHECK (rank > 0),
    CONSTRAINT planning_run_evidence_usage_check CHECK (NOT used_by_model OR sent_to_model),
    UNIQUE (planning_run_id, document_chunk_id, query_key)
  );`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_planning_run_evidence_run_rank
    ON planning_run_evidence (planning_run_id, query_key, rank);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_planning_run_evidence_chunk
    ON planning_run_evidence (document_chunk_id);`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS guardrail_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    planning_run_id uuid NOT NULL REFERENCES planning_runs(id) ON DELETE CASCADE,
    weekly_plan_revision_id uuid REFERENCES weekly_plan_revisions(id) ON DELETE CASCADE,
    rule_key text NOT NULL,
    rule_version text,
    severity text NOT NULL,
    result text NOT NULL,
    message text,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    order_index int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT guardrail_results_severity_check CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    CONSTRAINT guardrail_results_result_check CHECK (result IN ('pass', 'warn', 'fail')),
    CONSTRAINT guardrail_results_order_check CHECK (order_index >= 0)
  );`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_guardrail_results_run
    ON guardrail_results (planning_run_id, order_index);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_guardrail_results_failures
    ON guardrail_results (planning_run_id, severity) WHERE result = 'fail';`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS plan_change_proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    training_plan_id uuid REFERENCES training_plans(id) ON DELETE SET NULL,
    planning_run_id uuid NOT NULL REFERENCES planning_runs(id) ON DELETE RESTRICT,
    weekly_plan_revision_id uuid REFERENCES weekly_plan_revisions(id) ON DELETE SET NULL,
    conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
    message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
    revision_number int NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'draft',
    effective_date date,
    change_type text NOT NULL,
    source_session_key text,
    target_session_key text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    reason text,
    public_reason text,
    evidence_state text,
    confidence numeric,
    proposed_at timestamptz NOT NULL DEFAULT now(),
    accepted_at timestamptz,
    rejected_at timestamptz,
    superseded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT plan_change_proposals_revision_check CHECK (revision_number > 0),
    CONSTRAINT plan_change_proposals_status_check CHECK (status IN ('draft', 'accepted', 'rejected', 'superseded')),
    CONSTRAINT plan_change_proposals_evidence_check CHECK (
      evidence_state IS NULL OR evidence_state IN ('sufficient', 'limited', 'none', 'mixed')
    ),
    CONSTRAINT plan_change_proposals_confidence_check CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    CONSTRAINT plan_change_proposals_decision_time_check CHECK (
      (status = 'draft' AND accepted_at IS NULL AND rejected_at IS NULL AND superseded_at IS NULL) OR
      (status = 'accepted' AND accepted_at IS NOT NULL AND rejected_at IS NULL AND superseded_at IS NULL) OR
      (status = 'rejected' AND rejected_at IS NOT NULL AND accepted_at IS NULL AND superseded_at IS NULL) OR
      (status = 'superseded' AND superseded_at IS NOT NULL AND rejected_at IS NULL)
    )
  );`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_plan_change_proposals_profile
    ON plan_change_proposals (athlete_profile_id, created_at DESC);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_plan_change_proposals_status
    ON plan_change_proposals (athlete_profile_id, status, proposed_at DESC);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_plan_change_proposals_run
    ON plan_change_proposals (planning_run_id);`);
}

export async function down(pgm) {
  pgm.sql(`DROP TABLE IF EXISTS plan_change_proposals;`);
  pgm.sql(`DROP TABLE IF EXISTS guardrail_results;`);
  pgm.sql(`DROP TABLE IF EXISTS planning_run_evidence;`);
  pgm.sql(`DROP TABLE IF EXISTS weekly_plan_sessions;`);
  pgm.sql(`DROP TABLE IF EXISTS weekly_plan_revisions;`);
  pgm.sql(`DROP TABLE IF EXISTS planning_runs;`);
  pgm.sql(`ALTER TABLE recovery_logs
    DROP CONSTRAINT IF EXISTS recovery_logs_dolor_check,
    DROP CONSTRAINT IF EXISTS recovery_logs_motivacion_check,
    DROP CONSTRAINT IF EXISTS recovery_logs_estres_check,
    DROP CONSTRAINT IF EXISTS recovery_logs_agujetas_check,
    DROP CONSTRAINT IF EXISTS recovery_logs_fatiga_check,
    DROP CONSTRAINT IF EXISTS recovery_logs_calidad_check;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_planned_sessions_week_code;`);
  pgm.sql(`ALTER TABLE planned_sessions
    DROP CONSTRAINT IF EXISTS planned_sessions_duration_check,
    DROP CONSTRAINT IF EXISTS planned_sessions_day_check;`);
  pgm.sql(`ALTER TABLE training_weeks DROP COLUMN IF EXISTS inicio;`);
  pgm.sql(`ALTER TABLE athlete_profiles DROP COLUMN IF EXISTS current_complaints;`);
  pgm.sql(`ALTER TABLE training_plans DROP CONSTRAINT IF EXISTS training_plans_structure_hash_check;`);
  pgm.sql(`ALTER TABLE training_plans DROP COLUMN IF EXISTS structure_hash;`);
}
