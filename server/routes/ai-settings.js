import express from "express";
import pool from "../db/pool.js";
import { aiRateLimiter, requireAuth } from "../middleware/auth.js";
import { decryptApiKey, encryptApiKey } from "../ai/settings-crypto.js";
import { createUserLLMProvider, publicAISettings, validateUserLLMSettings } from "../ai/user-provider.js";
import { deleteAISettings, findAISettingsByUser, saveAISettings, updateAISettingsTest } from "../db/repositories/aiSettings.js";

function safeProviderMessage(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "El proveedor tardó demasiado en responder";
  if (error?.status === 401 || error?.status === 403) return "El proveedor ha rechazado la clave de API";
  if (error?.status === 404) return "El modelo indicado no está disponible para esta clave";
  if (error?.status === 429) return "El proveedor ha aplicado un límite temporal o la cuenta no tiene saldo disponible";
  if (error?.status >= 400 && error?.status < 500) return "El proveedor ha rechazado la configuración";
  return "No se pudo conectar con el proveedor de IA";
}

export function createAISettingsRouter({ db = pool, fetchImpl = fetch } = {}) {
  const router = express.Router();
  router.use(requireAuth);

  router.get("/", async (req, res, next) => {
    try { res.json({ ok: true, settings: publicAISettings(await findAISettingsByUser(req.auth.userId, db)) }); }
    catch (error) { next(error); }
  });

  router.put("/", async (req, res, next) => {
    try {
      const userId = req.auth.userId;
      const draft = validateUserLLMSettings(req.body || {}, { requireApiKey: false });
      const existing = await findAISettingsByUser(userId, db);
      let apiKeyCiphertext = existing?.api_key_ciphertext;
      if (draft.apiKey) apiKeyCiphertext = encryptApiKey(draft.apiKey, userId);
      else if (!existing || existing.provider !== draft.provider) {
        return res.status(400).json({ ok: false, message: "Introduce una clave para el proveedor seleccionado" });
      }
      const saved = await saveAISettings({ userId, provider: draft.provider, model: draft.model, apiKeyCiphertext }, db);
      res.json({ ok: true, settings: publicAISettings(saved) });
    } catch (error) {
      if (/Proveedor|modelo|clave/.test(error.message || "")) return res.status(400).json({ ok: false, message: error.message });
      next(error);
    }
  });

  router.post("/test", aiRateLimiter, async (req, res, next) => {
    const userId = req.auth.userId;
    let usesStoredKey = false;
    try {
      const draft = validateUserLLMSettings(req.body || {}, { requireApiKey: false });
      const existing = await findAISettingsByUser(userId, db);
      let apiKey = draft.apiKey;
      if (!apiKey && existing?.provider === draft.provider) {
        apiKey = decryptApiKey(existing.api_key_ciphertext, userId);
        usesStoredKey = true;
      }
      const provider = createUserLLMProvider({ ...draft, apiKey }, { fetchImpl, timeoutMs: 20_000 });
      const result = await provider.call({
        system: "Responde únicamente OK.",
        messages: [{ role: "user", content: "Prueba de conexión" }],
        maxTokens: 8,
        temperature: 0,
      });
      if (usesStoredKey) await updateAISettingsTest(userId, true, db);
      res.json({ ok: true, provider: result.provider, model: result.model });
    } catch (error) {
      if (usesStoredKey) await updateAISettingsTest(userId, false, db).catch(() => {});
      if (/Proveedor|modelo|clave/.test(error.message || "")) return res.status(400).json({ ok: false, message: error.message });
      if (error?.status || error?.name === "TimeoutError" || error?.name === "AbortError") {
        return res.status(400).json({ ok: false, message: safeProviderMessage(error) });
      }
      next(error);
    }
  });

  router.delete("/", async (req, res, next) => {
    try {
      await deleteAISettings(req.auth.userId, db);
      res.json({ ok: true, settings: publicAISettings(null) });
    } catch (error) { next(error); }
  });

  return router;
}

export default createAISettingsRouter();
