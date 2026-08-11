export const shorthands = undefined;

export async function up({ context: query }) {
  await query(`CREATE TABLE IF NOT EXISTS user_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    active_profile_id uuid REFERENCES athlete_profiles(id) ON DELETE SET NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
  );`);
  await query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash) WHERE revoked_at IS NULL;`);
  await query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id) WHERE revoked_at IS NULL;`);
}

export async function down({ context: query }) {
  await query(`DROP TABLE IF EXISTS user_sessions;`);
}
