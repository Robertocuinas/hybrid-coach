import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { VoyageEmbeddingProvider } from "./providers/embeddings/voyage.js";
import { OpenAIEmbeddingProvider } from "./providers/embeddings/openai.js";
import { OpenAICompatibleEmbeddingProvider } from "./providers/embeddings/openai-compatible.js";
import { assertEmbeddingProvider, assertLLMProvider } from "./providers/types.js";

const PROVIDERS = new Set(["anthropic", "openai", "openai-compatible"]);
const EMBEDDING_PROVIDERS = new Set(["voyage", "openai", "openai-compatible"]);

function required(value, name, provider) {
  if (!String(value || "").trim()) throw new Error(`${name} es obligatoria para LLM_PROVIDER=${provider}`);
  return String(value).trim();
}

function validBaseURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("LLM_BASE_URL no es una URL válida"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("LLM_BASE_URL debe usar http o https");
  return url.toString().replace(/\/+$/, "");
}

export function readLLMConfig(env = process.env) {
  const provider = String(env.LLM_PROVIDER || "").trim();
  if (!provider) return { enabled: false };
  if (!PROVIDERS.has(provider)) throw new Error(`LLM_PROVIDER desconocido: ${provider}`);
  const model = required(env.LLM_MODEL, "LLM_MODEL", provider);
  const maxTokens = Number(env.LLM_MAX_TOKENS || 1400);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 100000) throw new Error("LLM_MAX_TOKENS no es válido");
  const apiKey = provider === "openai-compatible" ? String(env.LLM_API_KEY || "") : required(env.LLM_API_KEY, "LLM_API_KEY", provider);
  const baseURL = provider === "openai-compatible"
    ? validBaseURL(required(env.LLM_BASE_URL, "LLM_BASE_URL", provider))
    : env.LLM_BASE_URL ? validBaseURL(env.LLM_BASE_URL) : undefined;
  return { enabled: true, provider, model, apiKey, baseURL, maxTokens };
}

export function createLLMProvider(env = process.env, { fetchImpl = fetch } = {}) {
  const config = readLLMConfig(env);
  if (!config.enabled) return null;
  let provider;
  if (config.provider === "anthropic") provider = new AnthropicProvider({ ...config, fetchImpl });
  if (config.provider === "openai") provider = new OpenAIProvider({ ...config, fetchImpl });
  if (config.provider === "openai-compatible") provider = new OpenAICompatibleProvider({ ...config, fetchImpl });
  return assertLLMProvider(provider);
}

export function readEmbeddingConfig(env = process.env) {
  const provider = String(env.EMBEDDING_PROVIDER || "").trim();
  if (!provider) return { enabled: false };
  if (!EMBEDDING_PROVIDERS.has(provider)) throw new Error(`EMBEDDING_PROVIDER desconocido: ${provider}`);
  const model = required(env.EMBEDDING_MODEL, "EMBEDDING_MODEL", provider);
  const dimensions = Number(env.EMBEDDING_DIMENSIONS || 1024);
  if (dimensions !== 1024) throw new Error("EMBEDDING_DIMENSIONS debe ser exactamente 1024");
  const batchSize = Number(env.EMBEDDING_BATCH_SIZE || 10);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new Error("EMBEDDING_BATCH_SIZE debe estar entre 1 y 256");
  const maxRetries = Number(env.EMBEDDING_MAX_RETRIES || 4);
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) throw new Error("EMBEDDING_MAX_RETRIES debe estar entre 0 y 10");
  const apiKey = provider === "openai-compatible"
    ? String(env.EMBEDDING_API_KEY || "")
    : required(env.EMBEDDING_API_KEY, "EMBEDDING_API_KEY", provider);
  const baseURL = provider === "openai-compatible"
    ? validBaseURL(required(env.EMBEDDING_BASE_URL, "EMBEDDING_BASE_URL", provider))
    : env.EMBEDDING_BASE_URL ? validBaseURL(env.EMBEDDING_BASE_URL) : undefined;
  return { enabled: true, provider, model, apiKey, baseURL, dimensions, batchSize, maxRetries };
}

export function createEmbeddingProvider(env = process.env, { fetchImpl = fetch } = {}) {
  const config = readEmbeddingConfig(env);
  if (!config.enabled) return null;
  let provider;
  if (config.provider === "voyage") provider = new VoyageEmbeddingProvider({ ...config, fetchImpl });
  if (config.provider === "openai") provider = new OpenAIEmbeddingProvider({ ...config, fetchImpl });
  if (config.provider === "openai-compatible") provider = new OpenAICompatibleEmbeddingProvider({ ...config, fetchImpl });
  return assertEmbeddingProvider(provider, config.dimensions);
}
