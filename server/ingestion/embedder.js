import { ProviderError } from "../ai/providers/types.js";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_RETRIES = 4;

const vectorLiteral = (vector) => `[${vector.join(",")}]`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryable(error) {
  return error instanceof ProviderError && (error.status === 429 || error.status >= 500);
}

async function embedWithRetry(provider, texts, inputType, maxRetries, sleep) {
  let attempt = 0;
  while (true) {
    try {
      return await provider.embed(texts, { inputType });
    } catch (error) {
      if (!retryable(error) || attempt >= maxRetries) throw error;
      const delay = Math.min(8000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
      attempt += 1;
      await sleep(delay);
    }
  }
}

export async function vectorizarChunksPorLotes(chunks, {
  provider,
  batchSize = Number(process.env.EMBEDDING_BATCH_SIZE || DEFAULT_BATCH_SIZE),
  maxRetries = Number(process.env.EMBEDDING_MAX_RETRIES || DEFAULT_MAX_RETRIES),
  inputType = "document",
  onProgress = () => {},
  sleep = wait,
} = {}) {
  if (!provider) throw new Error("No hay proveedor de embeddings configurado");
  if (!Array.isArray(chunks)) throw new TypeError("chunks debe ser un array");
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new TypeError("batchSize debe ser un entero positivo");
  const items = [];
  let tokens = 0;
  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    const result = await embedWithRetry(provider, batch.map((chunk) => chunk.texto), inputType, maxRetries, sleep);
    if (result.dimensions !== 1024 || result.vectors.length !== batch.length) {
      throw new Error(`Lote de embeddings inválido: se esperaban ${batch.length} vectores de 1024 dimensiones`);
    }
    tokens += Number(result.usage?.tokens || 0);
    batch.forEach((chunk, index) => items.push({ chunk, embedding: result.vectors[index] }));
    onProgress({ processed: items.length, total: chunks.length, tokens });
  }
  return {
    items,
    provider: provider.provider,
    model: provider.model,
    dimensions: provider.dimensions(),
    tokens,
  };
}

export async function guardarEmbeddings(db, vectorizados) {
  const { items, provider, model, dimensions } = vectorizados;
  if (!items.length) return 0;
  if (items.some(({ chunk }) => !chunk.id)) throw new Error("Cada chunk necesita id antes de guardar su embedding");
  const params = [];
  const values = items.map(({ chunk, embedding }, index) => {
    const base = index * 5;
    params.push(chunk.id, provider, model, dimensions, vectorLiteral(embedding));
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });
  const result = await db.query(
    `INSERT INTO chunk_embeddings (document_chunk_id, provider, model, dimensions, embedding)
     VALUES ${values.join(",")}
     ON CONFLICT (document_chunk_id, provider, model, dimensions)
     DO UPDATE SET embedding = EXCLUDED.embedding, created_at = now();`,
    params
  );
  return result.rowCount ?? result.affectedRows ?? items.length;
}

export async function procesarChunksPorLotes(chunks, options = {}) {
  const vectorizados = await vectorizarChunksPorLotes(chunks, options);
  const written = await guardarEmbeddings(options.db, vectorizados);
  return { ...vectorizados, written };
}
