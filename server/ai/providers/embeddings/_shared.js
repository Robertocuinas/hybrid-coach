import { ProviderError } from "../types.js";

export const EMBEDDING_DIMENSIONS = 1024;

export function validateEmbeddingInput(texts, inputType) {
  if (!Array.isArray(texts) || !texts.length || texts.some((text) => typeof text !== "string" || !text.trim())) {
    throw new TypeError("EmbeddingProvider.embed() requiere un array no vacío de textos");
  }
  if (!['document', 'query'].includes(inputType)) {
    throw new TypeError("inputType debe ser 'document' o 'query'");
  }
}

export async function readEmbeddingResponse(response, provider) {
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    const detail = data?.detail || data?.error?.message || data?.message;
    throw new ProviderError(provider, response.status, detail ? `Error de ${provider}: ${detail}` : `Error de ${provider} (${response.status})`);
  }
  return data;
}

export function normalizeVectors(data, { expectedCount, provider, model, dimensions = EMBEDDING_DIMENSIONS }) {
  const rows = Array.isArray(data?.data) ? [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
  const vectors = rows.map((row) => row.embedding);
  if (vectors.length !== expectedCount) {
    throw new Error(`${provider} devolvió ${vectors.length} vectores para ${expectedCount} textos`);
  }
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
      throw new Error(`${provider}/${model} debe devolver vectores válidos de ${dimensions} dimensiones`);
    }
  }
  return {
    vectors,
    dimensions,
    provider,
    model,
    usage: { tokens: data?.usage?.total_tokens ?? data?.usage?.tokens ?? 0 },
  };
}

export function normalizeBaseURL(value) {
  return String(value || "").replace(/\/+$/, "");
}
