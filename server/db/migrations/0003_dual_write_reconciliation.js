export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`CREATE TABLE IF NOT EXISTS sync_operations (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation_id text NOT NULL,
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    applied_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, operation_id)
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS client_state_snapshots (
    athlete_profile_id uuid PRIMARY KEY REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    profile_local_id text,
    state jsonb NOT NULL,
    local_totals jsonb NOT NULL,
    captured_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    local_totals jsonb NOT NULL,
    database_totals jsonb NOT NULL,
    differences jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('green', 'red', 'stale')),
    checked_at timestamptz NOT NULL DEFAULT now()
  );`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_reconciliation_profile_checked
    ON reconciliation_runs (athlete_profile_id, checked_at DESC);`);
}

export async function down(pgm) {
  pgm.sql(`DROP TABLE IF EXISTS reconciliation_runs;`);
  pgm.sql(`DROP TABLE IF EXISTS client_state_snapshots;`);
  pgm.sql(`DROP TABLE IF EXISTS sync_operations;`);
}
