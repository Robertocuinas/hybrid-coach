/* Dependencias compartidas por Coach y planificador. Los proveedores de texto
   y reranking viven durante el proceso; embeddings se resuelven en cada
   petición porque su configuración puede cambiar desde administración. */
import { pool } from "../db/repositories/_helpers.js";
import * as documentsRepo from "../db/repositories/documents.js";
import { createLLMProvider, createRerankProvider, readRAGConfig } from "./factory.js";
import { crearDesdeConfig, resolveEmbeddingConfig } from "./instance-embeddings.js";
import { resolveUserLLMProvider } from "./user-provider.js";

const lazy = (factory) => {
  let value = null;
  let initialized = false;
  return () => {
    if (!initialized) {
      try { value = factory(); } catch { value = null; }
      initialized = true;
    }
    return value;
  };
};

const getDefaultLLM = lazy(() => createLLMProvider());
const getRerank = lazy(() => createRerankProvider());

export async function resolveRAGRuntime(userId, { db = pool, repo = documentsRepo } = {}) {
  const embeddingConfig = await resolveEmbeddingConfig({ db });
  return {
    db,
    repo,
    llmProvider: await resolveUserLLMProvider(userId, { db, fallbackProvider: getDefaultLLM() }),
    embeddingProvider: embeddingConfig.enabled ? crearDesdeConfig(embeddingConfig) : null,
    rerankProvider: getRerank(),
    indice: embeddingConfig.enabled
      ? { provider: embeddingConfig.provider, model: embeddingConfig.model, dimensions: embeddingConfig.dimensions }
      : null,
    config: readRAGConfig(),
  };
}

