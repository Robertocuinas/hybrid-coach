import test from "node:test";
import assert from "node:assert/strict";
import { decryptApiKey, encryptApiKey } from "./settings-crypto.js";
import { createUserLLMProvider, publicAISettings, resolveUserLLMProvider, validateUserLLMSettings } from "./user-provider.js";

const env = { SESSION_SECRET: "s".repeat(64) };
const userId = "11111111-1111-4111-8111-111111111111";

test("la clave de IA se cifra con autenticación y queda ligada al usuario", () => {
  const plaintext = "sk-prueba-super-secreta";
  const encrypted = encryptApiKey(plaintext, userId, env);
  assert.equal(encrypted.includes(plaintext), false);
  assert.equal(decryptApiKey(encrypted, userId, env), plaintext);
  assert.throws(() => decryptApiKey(encrypted, "22222222-2222-4222-8222-222222222222", env));
});

test("la configuración pública nunca expone el cifrado ni una pista de la clave", () => {
  const result = publicAISettings({
    provider: "openai", model: "gpt-4.1-mini", api_key_ciphertext: "secreto",
    last_tested_at: null, last_test_ok: null, updated_at: "2026-08-13T10:00:00Z",
  });
  assert.deepEqual(result, {
    configured: true, provider: "openai", model: "gpt-4.1-mini",
    lastTestedAt: null, lastTestOk: null, updatedAt: "2026-08-13T10:00:00Z",
  });
  assert.equal(JSON.stringify(result).includes("secreto"), false);
});

test("solo admite proveedores oficiales y nombres de modelo acotados", () => {
  assert.deepEqual(validateUserLLMSettings({ provider: "openai", model: "gpt-4.1-mini", apiKey: "sk-test" }), {
    provider: "openai", model: "gpt-4.1-mini", apiKey: "sk-test",
  });
  assert.throws(() => validateUserLLMSettings({ provider: "openai-compatible", model: "x", apiKey: "x" }), /Proveedor/);
  assert.throws(() => validateUserLLMSettings({ provider: "anthropic", model: "modelo con espacios", apiKey: "x" }), /modelo/i);
});

test("el resolver usa la configuración cifrada del usuario sobre el fallback", async () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = env.SESSION_SECRET;
  const encrypted = encryptApiKey("sk-user", userId, env);
  const db = { query: async (_sql, params) => {
    assert.deepEqual(params, [userId]);
    return { rows: [{ user_id: userId, provider: "openai", model: "gpt-test", api_key_ciphertext: encrypted }] };
  } };
  let authorization;
  const fetchImpl = async (_url, options) => {
    authorization = options.headers.authorization;
    return { ok: true, status: 200, json: async () => ({ model: "gpt-test", choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: {} }) };
  };
  try {
    const provider = await resolveUserLLMProvider(userId, { db, fallbackProvider: { fallback: true }, fetchImpl });
    const result = await provider.call({ messages: [{ role: "user", content: "hola" }] });
    assert.equal(result.text, "OK");
    assert.equal(authorization, "Bearer sk-user");
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("los adaptadores personalizados conservan los endpoints oficiales fijos", async () => {
  let anthropicURL;
  const anthropic = createUserLLMProvider({ provider: "anthropic", model: "claude-test", apiKey: "sk-ant-test" }, {
    fetchImpl: async (url) => {
      anthropicURL = url;
      return { ok: true, status: 200, json: async () => ({ model: "claude-test", content: [{ type: "text", text: "OK" }], usage: {}, stop_reason: "end_turn" }) };
    },
  });
  await anthropic.call({ messages: [{ role: "user", content: "hola" }] });
  assert.equal(anthropicURL, "https://api.anthropic.com/v1/messages");
});
