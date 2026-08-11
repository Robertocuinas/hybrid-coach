import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { assertLLMProvider } from "./providers/types.js";

const PROVIDERS = new Set(["anthropic", "openai", "openai-compatible"]);

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
