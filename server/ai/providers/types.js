/**
 * Contratos runtime para proveedores. JavaScript no impone interfaces, por eso
 * estas clases documentan el contrato y las aserciones fallan pronto al arrancar.
 */
export class LLMProvider {
  async call(_input) { throw new Error("LLMProvider.call() no implementado"); }
  capabilities() { throw new Error("LLMProvider.capabilities() no implementado"); }
}

export class EmbeddingProvider {
  async embed(_texts, _options = {}) { throw new Error("EmbeddingProvider.embed() no implementado"); }
  dimensions() { throw new Error("EmbeddingProvider.dimensions() no implementado"); }
}

/**
 * rerank() devuelve [{ index, score }] ordenado de más a menos relevante, donde
 * `index` es la posición en el array `documents` recibido. El score debe estar
 * en 0-1 y ser comparable entre consultas: sobre él se aplica RAG_MIN_SCORE
 * para decidir "no hay evidencia suficiente" (docs/05-rag.md §8).
 */
export class RerankProvider {
  async rerank(_query, _documents, _topN) { throw new Error("RerankProvider.rerank() no implementado"); }
  capabilities() { throw new Error("RerankProvider.capabilities() no implementado"); }
}

/* Un ToolRouterProvider clasifica una petición contra una lista cerrada de
   herramientas. No ejecuta ninguna herramienta: la autorización y la
   ejecución siguen perteneciendo al dominio de la aplicación. */
export class ToolRouterProvider {
  async route(_query, _tools, _options = {}) { throw new Error("ToolRouterProvider.route() no implementado"); }
  capabilities() { throw new Error("ToolRouterProvider.capabilities() no implementado"); }
}

export class ProviderError extends Error {
  constructor(provider, status, message = "El proveedor de IA no respondió correctamente") {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
  }
}

export function assertLLMProvider(provider) {
  if (!provider || typeof provider.call !== "function" || typeof provider.capabilities !== "function") {
    throw new TypeError("El adaptador no cumple LLMProvider { call(), capabilities() }");
  }
  const capabilities = provider.capabilities();
  for (const key of ["reliableStructuredOutput", "nativeJsonMode", "promptCaching", "maxContextTokens", "supportsSystemRole"]) {
    if (!(key in capabilities)) throw new TypeError(`Falta capability LLM: ${key}`);
  }
  return provider;
}

export function assertEmbeddingProvider(provider, expectedDimensions = 1024) {
  if (!provider || typeof provider.embed !== "function" || typeof provider.dimensions !== "function") {
    throw new TypeError("El adaptador no cumple EmbeddingProvider { embed(), dimensions() }");
  }
  if (provider.dimensions() !== expectedDimensions) {
    throw new TypeError(`EmbeddingProvider debe producir ${expectedDimensions} dimensiones`);
  }
  return provider;
}

export function assertRerankProvider(provider) {
  if (!provider || typeof provider.rerank !== "function" || typeof provider.capabilities !== "function") {
    throw new TypeError("El adaptador no cumple RerankProvider { rerank(), capabilities() }");
  }
  const capabilities = provider.capabilities();
  /* `scoresAbsolutos` es la capability que de verdad importa: dice si el score
     devuelto significa algo por sí solo. El adaptador noop no reordena y sus
     "scores" son posicionales, así que el umbral debe caer sobre otra señal
     (la similitud coseno). Ver server/rag/retrieval.js. */
  for (const key of ["scoresAbsolutos", "maxDocuments"]) {
    if (!(key in capabilities)) throw new TypeError(`Falta capability de reranking: ${key}`);
  }
  return provider;
}

export function assertToolRouterProvider(provider) {
  if (!provider || typeof provider.route !== "function" || typeof provider.capabilities !== "function") {
    throw new TypeError("El adaptador no cumple ToolRouterProvider { route(), capabilities() }");
  }
  const capabilities = provider.capabilities();
  for (const key of ["local", "structuredToolCalls", "executesTools", "confidenceScore"]) {
    if (!(key in capabilities)) throw new TypeError(`Falta capability ToolRouter: ${key}`);
  }
  if (capabilities.executesTools !== false) {
    throw new TypeError("Un ToolRouterProvider no puede ejecutar herramientas");
  }
  return provider;
}

export async function readProviderResponse(response, provider) {
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    const detail = data?.error?.message || data?.message;
    throw new ProviderError(provider, response.status, detail ? `Error de ${provider}: ${detail}` : `Error de ${provider} (${response.status})`);
  }
  return data;
}

export function normalizeStopReason(reason) {
  if (["stop", "end_turn", "stop_sequence"].includes(reason)) return "stop";
  if (["length", "max_tokens"].includes(reason)) return "max_tokens";
  return "other";
}
