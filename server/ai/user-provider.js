import pool from "../db/pool.js";
import { findAISettingsByUser } from "../db/repositories/aiSettings.js";
import { createLLMProvider } from "./factory.js";
import { decryptApiKey } from "./settings-crypto.js";

export const USER_LLM_PROVIDERS = new Set(["openai", "anthropic"]);

export function validateUserLLMSettings({ provider, model, apiKey }, { requireApiKey = true } = {}) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const normalizedModel = String(model || "").trim();
  const normalizedApiKey = apiKey === undefined ? undefined : String(apiKey).trim();
  if (!USER_LLM_PROVIDERS.has(normalizedProvider)) throw new Error("Proveedor de IA no válido");
  if (!normalizedModel || normalizedModel.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(normalizedModel)) {
    throw new Error("Nombre de modelo no válido");
  }
  if (requireApiKey && !normalizedApiKey) throw new Error("La clave de API es obligatoria");
  if (normalizedApiKey && (normalizedApiKey.length > 2048 || /[\x00-\x1f\x7f]/.test(normalizedApiKey))) {
    throw new Error("Formato de clave de API no válido");
  }
  return { provider: normalizedProvider, model: normalizedModel, apiKey: normalizedApiKey };
}

function timedFetch(timeoutMs = 45_000, fetchImpl = fetch) {
  return (url, options = {}) => fetchImpl(url, { ...options, signal: options.signal || AbortSignal.timeout(timeoutMs) });
}

export function createUserLLMProvider({ provider, model, apiKey }, { fetchImpl = fetch, timeoutMs = 45_000 } = {}) {
  const valid = validateUserLLMSettings({ provider, model, apiKey });
  return createLLMProvider({
    LLM_PROVIDER: valid.provider,
    LLM_MODEL: valid.model,
    LLM_API_KEY: valid.apiKey,
    LLM_MAX_TOKENS: "1400",
  }, { fetchImpl: timedFetch(timeoutMs, fetchImpl) });
}

export async function resolveUserLLMProvider(userId, { db = pool, fallbackProvider = null, fetchImpl = fetch } = {}) {
  const settings = await findAISettingsByUser(userId, db);
  if (!settings) return fallbackProvider;
  const apiKey = decryptApiKey(settings.api_key_ciphertext, userId);
  return createUserLLMProvider({ provider: settings.provider, model: settings.model, apiKey }, { fetchImpl });
}

export function publicAISettings(settings) {
  if (!settings) return { configured: false, provider: null, model: null, lastTestedAt: null, lastTestOk: null, updatedAt: null };
  return {
    configured: true,
    provider: settings.provider,
    model: settings.model,
    lastTestedAt: settings.last_tested_at || null,
    lastTestOk: settings.last_test_ok ?? null,
    updatedAt: settings.updated_at || null,
  };
}
