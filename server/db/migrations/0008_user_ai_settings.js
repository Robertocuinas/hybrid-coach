export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`CREATE TABLE IF NOT EXISTS user_ai_settings (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL,
    model text NOT NULL,
    api_key_ciphertext text NOT NULL,
    last_tested_at timestamptz,
    last_test_ok boolean,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_ai_settings_provider_check CHECK (provider IN ('openai', 'anthropic')),
    CONSTRAINT user_ai_settings_model_check CHECK (char_length(model) BETWEEN 1 AND 200)
  );`);
}

export async function down(pgm) {
  pgm.sql(`DROP TABLE IF EXISTS user_ai_settings;`);
}
