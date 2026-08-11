import { pathToFileURL } from "node:url";
import pool from "../../server/db/pool.js";
import { createEmbeddingProvider, readEmbeddingConfig } from "../../server/ai/factory.js";
import { procesarChunksPorLotes } from "../../server/ingestion/embedder.js";
import { activateIndex, markIndexBuilding, markIndexFailed, refreshIndexProgress } from "../../server/embeddings/index-state.js";

export async function reindexEmbeddings({
  db = pool,
  provider = createEmbeddingProvider(),
  config = readEmbeddingConfig(),
  force = false,
  pageSize = 100,
  onProgress = () => {},
} = {}) {
  if (!config.enabled || !provider) throw new Error("Configura EMBEDDING_PROVIDER, EMBEDDING_MODEL y EMBEDDING_API_KEY antes de reindexar");
  const totalResult = await db.query(`SELECT count(*)::int AS total FROM document_chunks;`);
  const total = totalResult.rows[0]?.total || 0;
  await markIndexBuilding(db, config, total);

  try {
    if (force) {
      await db.query(
        `DELETE FROM chunk_embeddings WHERE provider=$1 AND model=$2 AND dimensions=$3;`,
        [config.provider, config.model, config.dimensions]
      );
    }

    let processed = 0;
    let tokens = 0;
    while (true) {
      const { rows: chunks } = await db.query(
        `SELECT dc.id, dc.texto
           FROM document_chunks dc
          WHERE NOT EXISTS (
            SELECT 1 FROM chunk_embeddings ce
             WHERE ce.document_chunk_id=dc.id AND ce.provider=$1 AND ce.model=$2 AND ce.dimensions=$3
          )
          ORDER BY dc.id
          LIMIT $4;`,
        [config.provider, config.model, config.dimensions, pageSize]
      );
      if (!chunks.length) break;
      const result = await procesarChunksPorLotes(chunks, {
        db,
        provider,
        batchSize: config.batchSize,
        maxRetries: config.maxRetries,
        inputType: "document",
      });
      processed += result.written;
      tokens += result.tokens;
      const counts = await refreshIndexProgress(db, config);
      onProgress({ processed, tokens, indexed: counts.indexed_chunks, total: counts.total_chunks });
    }

    const counts = await activateIndex(db, config);
    return { ...counts, processed, tokens, provider: config.provider, model: config.model, dimensions: config.dimensions };
  } catch (error) {
    await markIndexFailed(db, config, error).catch(() => {});
    throw error;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const result = await reindexEmbeddings({
    force,
    onProgress: ({ indexed, total, tokens }) => console.log(`Embeddings: ${indexed}/${total} chunks · ${tokens} tokens`),
  });
  console.log(`Reindexado completo: ${result.indexed_chunks}/${result.total_chunks} chunks con ${result.provider}/${result.model} (${result.dimensions}d).`);
  await pool.end();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error(`Reindexado fallido: ${error.message}`);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
}
