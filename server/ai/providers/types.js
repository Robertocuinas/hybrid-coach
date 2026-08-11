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

export class RerankProvider {
  async rerank(_query, _documents, _topN) { throw new Error("RerankProvider.rerank() no implementado"); }
  cost() { throw new Error("RerankProvider.cost() no implementado"); }
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
