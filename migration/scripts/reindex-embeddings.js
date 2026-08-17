import { pathToFileURL } from "node:url";
import pool from "../../server/db/pool.js";
import { createEmbeddingProvider, readEmbeddingConfig } from "../../server/ai/factory.js";
import { resolveEmbeddingConfig, resolveEmbeddingProvider } from "../../server/ai/instance-embeddings.js";
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
  /* El mensaje nombra los dos caminos a propósito: el anterior solo hablaba de
     variables de entorno y mandaba a configurar por ahí a quien ya lo tenía
     puesto en el panel, que es donde manda. */
  if (!config.enabled || !provider) {
    throw new Error("No hay embeddings configurados: ponlos en Administración → Embeddings, o define EMBEDDING_PROVIDER, EMBEDDING_MODEL y EMBEDDING_API_KEY en el entorno");
  }
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

/* La configuración se resuelve como la resuelve el servidor: lo guardado en la
   base MANDA sobre el entorno (migración 0009). Tomarla solo del entorno, que
   es lo que hacía este script, tiene dos finales y los dos son malos cuando los
   embeddings se han configurado desde el panel de administración:

     - sin variables EMBEDDING_* en el proceso, aborta diciendo que no hay nada
       configurado cuando sí lo hay;
     - con variables distintas a las guardadas, construye y ACTIVA un índice
       bajo otro (provider, model, dimensions). El servidor, que lee la config
       de la base, no lo reconoce como suyo y el retrieval sigue sin vectores
       después de haber pagado el reindexado entero.

   `scripts/ingest-biblio.js` ya lo hacía así; esto lo pone de acuerdo. */
async function main() {
  const force = process.argv.includes("--force");
  const config = await resolveEmbeddingConfig({ db: pool });
  const provider = await resolveEmbeddingProvider({ db: pool });
  console.log(`Configuración de embeddings: ${config.enabled ? `${config.provider}/${config.model} (${config.dimensions}d, ${config.origen})` : "sin configurar"}`);
  const result = await reindexEmbeddings({
    force,
    config,
    provider,
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
