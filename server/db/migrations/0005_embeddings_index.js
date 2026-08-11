export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`DELETE FROM chunk_embeddings older
    USING chunk_embeddings newer
    WHERE older.document_chunk_id = newer.document_chunk_id
      AND older.provider = newer.provider
      AND older.model = newer.model
      AND older.dimensions = newer.dimensions
      AND older.id < newer.id;`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_chunk_embeddings_generation
    ON chunk_embeddings (document_chunk_id, provider, model, dimensions);`);
  pgm.sql(`DROP INDEX IF EXISTS idx_chunk_embeddings_hnsw;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON chunk_embeddings
    USING hnsw (embedding vector_cosine_ops);`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS embedding_index_state (
    provider text NOT NULL,
    model text NOT NULL,
    dimensions int NOT NULL CHECK (dimensions = 1024),
    status text NOT NULL CHECK (status IN ('building', 'active', 'failed')),
    indexed_chunks int NOT NULL DEFAULT 0,
    total_chunks int NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT false,
    error text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, model, dimensions)
  );`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_embedding_index_one_active
    ON embedding_index_state (active) WHERE active = true;`);
}

export async function down(pgm) {
  pgm.sql(`DROP TABLE IF EXISTS embedding_index_state;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_chunk_embeddings_generation;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_embeddings_hnsw;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_hnsw ON chunk_embeddings
    USING hnsw (embedding vector_cosine_ops);`);
}
