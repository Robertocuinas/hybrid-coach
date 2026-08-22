import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { OllamaProvider } from "./providers/ollama.js";
import { VoyageEmbeddingProvider } from "./providers/embeddings/voyage.js";
import { OpenAIEmbeddingProvider } from "./providers/embeddings/openai.js";
import { OpenAICompatibleEmbeddingProvider } from "./providers/embeddings/openai-compatible.js";
import { CohereRerankProvider } from "./providers/rerank/cohere.js";
import { OpenAICompatibleRerankProvider } from "./providers/rerank/openai-compatible.js";
import { NoopRerankProvider } from "./providers/rerank/noop.js";
import { NeedleToolRouterProvider } from "./providers/tool-routing/needle.js";
import { assertEmbeddingProvider, assertLLMProvider, assertRerankProvider, assertToolRouterProvider } from "./providers/types.js";
import { topeSalida } from "./limits.js";

const PROVIDERS = new Set(["anthropic", "openai", "openai-compatible", "ollama"]);
const EMBEDDING_PROVIDERS = new Set(["voyage", "openai", "openai-compatible"]);
const RERANK_PROVIDERS = new Set(["noop", "cohere", "openai-compatible"]);
const TOOL_ROUTER_PROVIDERS = new Set(["needle"]);

/* El nombre de la variable ya dice de qué familia es (LLM_, EMBEDDING_,
   RERANK_): se deriva de ahí para que el mensaje señale la variable correcta
   y no siempre a LLM_PROVIDER. */
const familiaDe = (name) => String(name).split("_")[0];

function required(value, name, provider) {
  if (!String(value || "").trim()) throw new Error(`${name} es obligatoria para ${familiaDe(name)}_PROVIDER=${provider}`);
  return String(value).trim();
}

function validBaseURL(value, name = "LLM_BASE_URL") {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} no es una URL válida`); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${name} debe usar http o https`);
  return url.toString().replace(/\/+$/, "");
}

export function readLLMConfig(env = process.env) {
  const provider = String(env.LLM_PROVIDER || "").trim();
  if (!provider) return { enabled: false };
  if (!PROVIDERS.has(provider)) throw new Error(`LLM_PROVIDER desconocido: ${provider}`);
  const model = required(env.LLM_MODEL, "LLM_MODEL", provider);
  /* El tope de salida vive en limits.js: es el mismo número que usan el
     planificador, el coach y /api/ia, y ahí se puede subir de una vez para
     todos en lugar de perseguirlo por seis ficheros. */
  if (env.LLM_MAX_TOKENS !== undefined && env.LLM_MAX_TOKENS !== "") {
    const bruto = Number(env.LLM_MAX_TOKENS);
    if (!Number.isFinite(bruto) || bruto < 1 || bruto > 200000) throw new Error("LLM_MAX_TOKENS no es válido");
  }
  const maxTokens = topeSalida(env);
  const apiKey = ["openai-compatible", "ollama"].includes(provider) ? String(env.LLM_API_KEY || "") : required(env.LLM_API_KEY, "LLM_API_KEY", provider);
  const baseURL = provider === "openai-compatible"
    ? validBaseURL(required(env.LLM_BASE_URL, "LLM_BASE_URL", provider))
    : provider === "ollama"
      ? validBaseURL(env.LLM_BASE_URL || "http://127.0.0.1:11434", "LLM_BASE_URL")
    : env.LLM_BASE_URL ? validBaseURL(env.LLM_BASE_URL) : undefined;
  const thinking = String(env.LLM_THINKING || "false").toLowerCase() === "true";
  const keepAlive = String(env.OLLAMA_KEEP_ALIVE || "5m").trim();
  if (provider === "ollama") {
    const host = new URL(baseURL).hostname.replace(/^\[|\]$/g, "");
    if (!["localhost", "127.0.0.1", "::1"].includes(host) && String(env.OLLAMA_ALLOW_REMOTE || "false").toLowerCase() !== "true") {
      throw new Error("LLM_BASE_URL de Ollama debe ser local salvo OLLAMA_ALLOW_REMOTE=true");
    }
    if (!/^(?:-1|\d+[smhd])$/.test(keepAlive)) throw new Error("OLLAMA_KEEP_ALIVE no es válido");
  }
  return { enabled: true, provider, model, apiKey, baseURL, maxTokens, thinking, keepAlive };
}

export function createLLMProvider(env = process.env, { fetchImpl = fetch } = {}) {
  const config = readLLMConfig(env);
  if (!config.enabled) return null;
  let provider;
  if (config.provider === "anthropic") provider = new AnthropicProvider({ ...config, fetchImpl });
  if (config.provider === "openai") provider = new OpenAIProvider({ ...config, fetchImpl });
  if (config.provider === "openai-compatible") provider = new OpenAICompatibleProvider({ ...config, fetchImpl });
  if (config.provider === "ollama") provider = new OllamaProvider({ ...config, fetchImpl });
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
    ? validBaseURL(required(env.EMBEDDING_BASE_URL, "EMBEDDING_BASE_URL", provider), "EMBEDDING_BASE_URL")
    : env.EMBEDDING_BASE_URL ? validBaseURL(env.EMBEDDING_BASE_URL, "EMBEDDING_BASE_URL") : undefined;
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

/* El reranking es la única pieza de la capa de IA que SIEMPRE devuelve un
   adaptador: sin configurar cae en `noop`, que conserva el orden de la fusión.
   Así el retrieval nunca tiene que preguntarse si hay reranker. */
export function readRerankConfig(env = process.env) {
  const provider = String(env.RERANK_PROVIDER || "noop").trim() || "noop";
  if (!RERANK_PROVIDERS.has(provider)) throw new Error(`RERANK_PROVIDER desconocido: ${provider}`);
  if (provider === "noop") return { enabled: true, provider };

  const model = provider === "cohere"
    ? required(env.RERANK_MODEL, "RERANK_MODEL", provider)
    : String(env.RERANK_MODEL || "").trim() || undefined;
  const apiKey = provider === "openai-compatible"
    ? String(env.RERANK_API_KEY || "")
    : required(env.RERANK_API_KEY, "RERANK_API_KEY", provider);
  const baseURL = provider === "openai-compatible"
    ? validBaseURL(required(env.RERANK_BASE_URL, "RERANK_BASE_URL", provider), "RERANK_BASE_URL")
    : env.RERANK_BASE_URL ? validBaseURL(env.RERANK_BASE_URL, "RERANK_BASE_URL") : undefined;

  return { enabled: true, provider, model, apiKey, baseURL };
}

export function createRerankProvider(env = process.env, { fetchImpl = fetch } = {}) {
  const config = readRerankConfig(env);
  let provider;
  if (config.provider === "noop") provider = new NoopRerankProvider();
  if (config.provider === "cohere") provider = new CohereRerankProvider({ ...config, fetchImpl });
  if (config.provider === "openai-compatible") provider = new OpenAICompatibleRerankProvider({ ...config, fetchImpl });
  return assertRerankProvider(provider);
}

export function readToolRouterConfig(env = process.env) {
  const provider = String(env.TOOL_ROUTER_PROVIDER || "").trim();
  if (!provider) return { enabled: false };
  if (!TOOL_ROUTER_PROVIDERS.has(provider)) throw new Error(`TOOL_ROUTER_PROVIDER desconocido: ${provider}`);

  const baseURL = validBaseURL(String(env.NEEDLE_BASE_URL || "http://127.0.0.1:9475"), "NEEDLE_BASE_URL");
  const minConfidence = Number(env.NEEDLE_MIN_CONFIDENCE ?? 0.85);
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new Error("NEEDLE_MIN_CONFIDENCE debe estar entre 0 y 1");
  }
  const timeoutMs = Number(env.NEEDLE_TIMEOUT_MS || 15000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
    throw new Error("NEEDLE_TIMEOUT_MS debe estar entre 100 y 120000");
  }

  /* Por defecto Needle solo puede apuntar al propio equipo. Para un servicio
     privado remoto hace falta una habilitación explícita. */
  const host = new URL(baseURL).hostname.replace(/^\[|\]$/g, "");
  const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!loopback.has(host) && String(env.NEEDLE_ALLOW_REMOTE || "false").toLowerCase() !== "true") {
    throw new Error("NEEDLE_BASE_URL debe ser local; usa NEEDLE_ALLOW_REMOTE=true solo para un servicio privado controlado");
  }
  return { enabled: true, provider, baseURL, minConfidence, timeoutMs };
}

export function createToolRouterProvider(env = process.env, { fetchImpl = fetch } = {}) {
  const config = readToolRouterConfig(env);
  if (!config.enabled) return null;
  return assertToolRouterProvider(new NeedleToolRouterProvider({ ...config, fetchImpl }));
}

/* Los tres parámetros del retrieval viven juntos porque se calibran juntos
   (docs/05-rag.md §7): recuperar 25, rerankear, quedarse con 8. */
export function readRAGConfig(env = process.env) {
  const entero = (valor, porDefecto, nombre, min, max) => {
    const n = Number(valor ?? porDefecto);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${nombre} debe ser un entero entre ${min} y ${max}`);
    return n;
  };
  const topKRetrieval = entero(env.RAG_TOP_K_RETRIEVAL, 25, "RAG_TOP_K_RETRIEVAL", 1, 200);
  const topKFinal = entero(env.RAG_TOP_K_FINAL, 8, "RAG_TOP_K_FINAL", 1, topKRetrieval);
  /* Mínimo por debajo del cual se completa con fragmentos marcados como
     relleno. Es el `min` de refsRelevantes(), conservado. */
  const minResults = entero(env.RAG_MIN_RESULTS, 3, "RAG_MIN_RESULTS", 0, topKFinal);
  const minScore = Number(env.RAG_MIN_SCORE ?? 0.25);
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) throw new Error("RAG_MIN_SCORE debe estar entre 0 y 1");
  return {
    topKRetrieval,
    topKFinal,
    minResults,
    minScore,
    /* Ponderar por grado de evidencia mezcla "encaja con la pregunta" con
       "merece confianza" y desplaza el umbral. Desactivado hasta poder
       calibrarlo con el dataset de la Fase 10. */
    weightByGrade: String(env.RAG_WEIGHT_BY_GRADE || "false").toLowerCase() === "true",
    rrfK: entero(env.RAG_RRF_K, 60, "RAG_RRF_K", 1, 1000),
  };
}
