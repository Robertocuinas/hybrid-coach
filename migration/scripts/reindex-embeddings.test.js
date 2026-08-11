import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { vectorSearch } from "../../server/db/repositories/documents.js";
import { reindexEmbeddings } from "./reindex-embeddings.js";

const embedding = (axis) => { const value = Array(1024).fill(0); value[axis] = 1; return value; };
const provider = (name, model) => ({
  provider: name, model, dimensions: () => 1024,
  async embed(texts) {
    return { vectors: texts.map((text) => embedding(text.includes("carrera") ? 0 : 1)), dimensions: 1024, usage: { tokens: texts.length } };
  },
});
const config = (providerName, model) => ({ enabled: true, provider: providerName, model, dimensions: 1024, batchSize: 10, maxRetries: 0 });

test("reindexa con otro proveedor usando solo los chunks y activa la nueva generación", async () => {
  const db = new PGlite({ extensions: { vector } });
  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), titulo text, autores text, revisado boolean,
      anio int, doi text, fuente_revista text, study_type text, evidence_grade text, poblacion text, population_type text,
      sample_size int, tema_principal text, storage_key text, origen text DEFAULT 'manual');
    CREATE TABLE document_chunks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid REFERENCES documents(id), texto text,
      chunk_index int, seccion text, pagina_inicio int, pagina_fin int, num_tokens int);
    CREATE TABLE chunk_embeddings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_chunk_id uuid REFERENCES document_chunks(id), provider text, model text, dimensions int, embedding vector(1024), created_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX idx_chunk_embeddings_generation ON chunk_embeddings(document_chunk_id,provider,model,dimensions);
    CREATE INDEX idx_embeddings_hnsw ON chunk_embeddings USING hnsw (embedding vector_cosine_ops);
    CREATE TABLE embedding_index_state (provider text, model text, dimensions int, status text, indexed_chunks int, total_chunks int, active boolean, error text, updated_at timestamptz DEFAULT now(), PRIMARY KEY(provider,model,dimensions));
    CREATE UNIQUE INDEX idx_embedding_index_one_active ON embedding_index_state(active) WHERE active=true;
  `);
  const doc = await db.query(`INSERT INTO documents(titulo,revisado) VALUES('Paper',true) RETURNING id;`);
  await db.query(`INSERT INTO document_chunks(document_id,texto) VALUES($1,'economía de carrera y umbral'),($1,'fuerza máxima y sentadilla');`, [doc.rows[0].id]);

  await reindexEmbeddings({ db, provider: provider("voyage", "voyage-test"), config: config("voyage", "voyage-test") });
  await reindexEmbeddings({ db, provider: provider("openai-compatible", "bge-m3"), config: config("openai-compatible", "bge-m3") });

  const counts = await db.query(`SELECT count(*)::int embeddings, count(DISTINCT document_chunk_id)::int chunks FROM chunk_embeddings;`);
  const active = await db.query(`SELECT provider,model,status FROM embedding_index_state WHERE active=true;`);
  const hits = await vectorSearch(embedding(0), { provider: "openai-compatible", model: "bge-m3", limit: 1 }, db);
  assert.deepEqual(counts.rows[0], { embeddings: 4, chunks: 2 }, "se conservan ambas generaciones sin releer PDFs");
  assert.deepEqual(active.rows[0], { provider: "openai-compatible", model: "bge-m3", status: "active" });
  assert.match(hits[0].texto, /carrera/);
  assert.equal(Number(hits[0].distancia), 0);
  await db.close();
});
