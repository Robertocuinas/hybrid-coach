import pool from "../db/pool.js";

export async function markIndexBuilding(db, config, totalChunks) {
  await db.query(
    `INSERT INTO embedding_index_state (provider, model, dimensions, status, indexed_chunks, total_chunks, active, error, updated_at)
     VALUES ($1,$2,$3,'building',0,$4,false,null,now())
     ON CONFLICT (provider, model, dimensions) DO UPDATE
       SET status='building', total_chunks=EXCLUDED.total_chunks, error=null, updated_at=now();`,
    [config.provider, config.model, config.dimensions, totalChunks]
  );
}

export async function refreshIndexProgress(db, config) {
  const counts = await countIndex(db, config);
  await db.query(
    `INSERT INTO embedding_index_state (provider, model, dimensions, status, indexed_chunks, total_chunks, active, updated_at)
     VALUES ($1,$2,$3,'building',$4,$5,false,now())
     ON CONFLICT (provider, model, dimensions) DO UPDATE
       SET indexed_chunks=EXCLUDED.indexed_chunks, total_chunks=EXCLUDED.total_chunks, updated_at=now();`,
    [config.provider, config.model, config.dimensions, counts.indexed_chunks, counts.total_chunks]
  );
  return counts;
}

async function countIndex(db, config) {
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*)::int FROM document_chunks) AS total_chunks,
       (SELECT count(*)::int FROM chunk_embeddings
         WHERE provider=$1 AND model=$2 AND dimensions=$3) AS indexed_chunks;`,
    [config.provider, config.model, config.dimensions]
  );
  return rows[0] || { total_chunks: 0, indexed_chunks: 0 };
}

export async function activateIndex(db, config) {
  const counts = await refreshIndexProgress(db, config);
  if (counts.indexed_chunks !== counts.total_chunks) {
    throw new Error(`Índice incompleto: ${counts.indexed_chunks}/${counts.total_chunks} chunks vectorizados`);
  }
  const transaction = typeof db.connect === "function" ? await db.connect() : db;
  const release = typeof transaction.release === "function" ? () => transaction.release() : () => {};
  await transaction.query("BEGIN");
  try {
    await transaction.query(`UPDATE embedding_index_state SET active=false WHERE active=true;`);
    await transaction.query(
      `UPDATE embedding_index_state SET status='active', active=true, error=null, updated_at=now()
        WHERE provider=$1 AND model=$2 AND dimensions=$3;`,
      [config.provider, config.model, config.dimensions]
    );
    await transaction.query("COMMIT");
  } catch (error) {
    await transaction.query("ROLLBACK");
    throw error;
  } finally {
    release();
  }
  return counts;
}

export async function markIndexFailed(db, config, error) {
  await db.query(
    `UPDATE embedding_index_state SET status='failed', active=false, error=$4, updated_at=now()
      WHERE provider=$1 AND model=$2 AND dimensions=$3;`,
    [config.provider, config.model, config.dimensions, String(error?.message || error).slice(0, 1000)]
  );
}

export async function getEmbeddingStatus(config, db = pool) {
  if (!config?.enabled) return { enabled: false, provider: null, model: null, dimensions: 1024, indexedChunks: 0, totalChunks: 0, ok: false };
  try {
    const { rows } = await db.query(
      `SELECT provider, model, dimensions, status, indexed_chunks, total_chunks, active, error
         FROM embedding_index_state WHERE active=true LIMIT 1;`
    );
    const active = rows[0];
    if (!active) {
      const counts = await countIndex(db, config);
      return { enabled: true, provider: config.provider, model: config.model, dimensions: config.dimensions,
        indexedChunks: counts.indexed_chunks, totalChunks: counts.total_chunks, ok: counts.total_chunks === 0, reason: counts.total_chunks ? "sin índice activo" : null };
    }
    const live = await countIndex(db, { provider: active.provider, model: active.model, dimensions: Number(active.dimensions) });
    const matches = active.provider === config.provider && active.model === config.model && Number(active.dimensions) === config.dimensions;
    return { enabled: true, provider: active.provider, model: active.model, dimensions: Number(active.dimensions),
      indexedChunks: live.indexed_chunks, totalChunks: live.total_chunks,
      ok: matches && active.status === "active" && live.indexed_chunks === live.total_chunks,
      configuredModel: config.model };
  } catch (error) {
    return { enabled: true, provider: config.provider, model: config.model, dimensions: config.dimensions,
      indexedChunks: 0, totalChunks: 0, ok: false, reason: error.message, databaseError: true };
  }
}

export async function validateEmbeddingStartup(config, db = pool) {
  if (!config?.enabled) return getEmbeddingStatus(config, db);
  const status = await getEmbeddingStatus(config, db);
  if (status.reason && (status.totalChunks > 0 || status.databaseError)) {
    throw new Error(`Embeddings no disponibles: ${status.reason}. Ejecuta npm run embeddings:reindex.`);
  }
  if (status.model && status.model !== config.model) {
    throw new Error(`Mismatch: EMBEDDING_MODEL=${config.model} pero stored_embeddings.model=${status.model}. Ejecuta npm run embeddings:reindex.`);
  }
  if (status.provider && status.provider !== config.provider) {
    throw new Error(`Mismatch: EMBEDDING_PROVIDER=${config.provider} pero el índice activo usa ${status.provider}. Ejecuta npm run embeddings:reindex.`);
  }
  if (status.dimensions !== config.dimensions) {
    throw new Error(`Mismatch: EMBEDDING_DIMENSIONS=${config.dimensions} pero el índice activo usa ${status.dimensions}.`);
  }
  if (!status.ok) {
    throw new Error(`Índice de embeddings incompleto: ${status.indexedChunks}/${status.totalChunks} chunks. Ejecuta npm run embeddings:reindex.`);
  }
  return status;
}
