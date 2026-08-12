export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`ALTER TABLE client_state_snapshots ADD COLUMN state_captured_at timestamptz;`);
  pgm.sql(`UPDATE client_state_snapshots SET state_captured_at=captured_at
    WHERE state IS NOT NULL AND state <> '{}'::jsonb;`);

  pgm.sql(`ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('athlete','admin')) NOT VALID;`);
  pgm.sql(`ALTER TABLE users VALIDATE CONSTRAINT users_role_check;`);

  pgm.sql(`ALTER TABLE completed_sessions
    ADD CONSTRAINT completed_sessions_tipo_check CHECK (tipo IN ('running','strength')) NOT VALID;`);
  pgm.sql(`ALTER TABLE completed_sessions VALIDATE CONSTRAINT completed_sessions_tipo_check;`);

  pgm.sql(`ALTER TABLE running_sessions
    ADD CONSTRAINT running_sessions_rpe_check CHECK (rpe IS NULL OR rpe BETWEEN 0 AND 10) NOT VALID,
    ADD CONSTRAINT running_sessions_dolor_check CHECK (dolor IS NULL OR dolor BETWEEN 0 AND 10) NOT VALID;`);
  pgm.sql(`ALTER TABLE running_sessions VALIDATE CONSTRAINT running_sessions_rpe_check;`);
  pgm.sql(`ALTER TABLE running_sessions VALIDATE CONSTRAINT running_sessions_dolor_check;`);

  pgm.sql(`ALTER TABLE strength_sets
    ADD CONSTRAINT strength_sets_reps_check CHECK (reps IS NULL OR reps >= 0) NOT VALID,
    ADD CONSTRAINT strength_sets_peso_check CHECK (peso_kg IS NULL OR peso_kg >= 0) NOT VALID,
    ADD CONSTRAINT strength_sets_rir_check CHECK (rir IS NULL OR rir BETWEEN 0 AND 10) NOT VALID;`);
  pgm.sql(`ALTER TABLE strength_sets VALIDATE CONSTRAINT strength_sets_reps_check;`);
  pgm.sql(`ALTER TABLE strength_sets VALIDATE CONSTRAINT strength_sets_peso_check;`);
  pgm.sql(`ALTER TABLE strength_sets VALIDATE CONSTRAINT strength_sets_rir_check;`);

  pgm.sql(`ALTER TABLE feedback_logs
    ADD CONSTRAINT feedback_logs_rpe_check CHECK (rpe IS NULL OR rpe BETWEEN 0 AND 10) NOT VALID,
    ADD CONSTRAINT feedback_logs_dolor_check CHECK (dolor IS NULL OR dolor BETWEEN 0 AND 10) NOT VALID;`);
  pgm.sql(`ALTER TABLE feedback_logs VALIDATE CONSTRAINT feedback_logs_rpe_check;`);
  pgm.sql(`ALTER TABLE feedback_logs VALIDATE CONSTRAINT feedback_logs_dolor_check;`);

  pgm.sql(`CREATE UNIQUE INDEX idx_training_plans_one_active
    ON training_plans (athlete_profile_id) WHERE activo = true;`);
  pgm.sql(`CREATE UNIQUE INDEX idx_running_external_unique
    ON running_sessions (origen, external_id) WHERE external_id IS NOT NULL;`);
}

export async function down(pgm) {
  pgm.sql(`DROP INDEX IF EXISTS idx_running_external_unique;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_training_plans_one_active;`);
  pgm.sql(`ALTER TABLE feedback_logs DROP CONSTRAINT IF EXISTS feedback_logs_dolor_check, DROP CONSTRAINT IF EXISTS feedback_logs_rpe_check;`);
  pgm.sql(`ALTER TABLE strength_sets DROP CONSTRAINT IF EXISTS strength_sets_rir_check, DROP CONSTRAINT IF EXISTS strength_sets_peso_check, DROP CONSTRAINT IF EXISTS strength_sets_reps_check;`);
  pgm.sql(`ALTER TABLE running_sessions DROP CONSTRAINT IF EXISTS running_sessions_dolor_check, DROP CONSTRAINT IF EXISTS running_sessions_rpe_check;`);
  pgm.sql(`ALTER TABLE completed_sessions DROP CONSTRAINT IF EXISTS completed_sessions_tipo_check;`);
  pgm.sql(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
  pgm.sql(`ALTER TABLE client_state_snapshots DROP COLUMN IF EXISTS state_captured_at;`);
}
