/* Ajuste de embeddings de INSTANCIA, no por usuario.

   Los vectores de toda la biblioteca tienen que salir del mismo modelo: el
   retrieval solo consulta el índice activo (embedding_index_state, una única
   fila con active=true) y los vectores de modelos distintos no son
   comparables. Si cada admin pudiera elegir el suyo, media biblioteca
   quedaría invisible para el coach sin ningún error a la vista.

   De ahí la fila única: la restricción `solo_una_fila` hace imposible tener
   dos configuraciones a la vez, aunque alguien escriba en la tabla a mano. */
export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`CREATE TABLE IF NOT EXISTS instance_embedding_settings (
    solo_una_fila boolean PRIMARY KEY DEFAULT true,
    provider text NOT NULL,
    model text NOT NULL,
    api_key_ciphertext text,
    base_url text,
    last_tested_at timestamptz,
    last_test_ok boolean,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT instance_embedding_settings_solo_una_fila CHECK (solo_una_fila),
    CONSTRAINT instance_embedding_settings_provider_check
      CHECK (provider IN ('voyage', 'openai', 'openai-compatible')),
    CONSTRAINT instance_embedding_settings_model_check CHECK (char_length(model) BETWEEN 1 AND 200)
  );`);
}

export async function down(pgm) {
  pgm.sql(`DROP TABLE IF EXISTS instance_embedding_settings;`);
}
