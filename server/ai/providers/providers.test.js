import test from "node:test";
import assert from "node:assert/strict";
import { createLLMProvider, readLLMConfig } from "../factory.js";

const ok = (data) => ({ ok: true, status: 200, json: async () => data });

test("LLM_PROVIDER=anthropic conserva el formato Messages y normaliza la salida", async () => {
  let request;
  const provider = createLLMProvider({ LLM_PROVIDER: "anthropic", LLM_MODEL: "claude-test", LLM_API_KEY: "test-key" }, {
    fetchImpl: async (url, options) => { request = { url, options }; return ok({ model: "claude-test", content: [{ type: "text", text: "hola" }], usage: { input_tokens: 3, output_tokens: 1 }, stop_reason: "end_turn" }); },
  });
  const result = await provider.call({ system: "sistema", messages: [{ role: "user", content: "hola" }], max_tokens: 100 });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.options.headers["x-api-key"], "test-key");
  assert.equal(body.system, "sistema");
  assert.equal(body.max_tokens, 100);
  assert.deepEqual(result, { text: "hola", usage: { inputTokens: 3, outputTokens: 1 }, provider: "anthropic", model: "claude-test", stopReason: "stop" });
  assert.equal(provider.capabilities().nativeJsonMode, false);
});

test("LLM_PROVIDER=openai usa /v1/chat/completions con system como primer mensaje", async () => {
  let request;
  const provider = createLLMProvider({ LLM_PROVIDER: "openai", LLM_MODEL: "gpt-test", LLM_API_KEY: "test-key" }, {
    fetchImpl: async (url, options) => { request = { url, options }; return ok({ model: "gpt-test", choices: [{ message: { content: "respuesta" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 } }); },
  });
  const result = await provider.call({ system: "sistema", messages: [{ role: "user", content: "pregunta" }], responseFormat: "json" });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(request.options.headers.authorization, "Bearer test-key");
  assert.deepEqual(body.messages[0], { role: "system", content: "sistema" });
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(result.text, "respuesta");
  assert.equal(result.provider, "openai");
});

test("openai-compatible apunta a Ollama y funciona sin API key", async () => {
  let request;
  const provider = createLLMProvider({
    LLM_PROVIDER: "openai-compatible", LLM_MODEL: "llama-test", LLM_BASE_URL: "http://localhost:11434/v1",
  }, {
    fetchImpl: async (url, options) => { request = { url, options }; return ok({ model: "llama-test", choices: [{ message: { content: "local" }, finish_reason: "length" }], usage: {} }); },
  });
  const result = await provider.call({ messages: [{ role: "user", content: "hola" }] });
  assert.equal(request.url, "http://localhost:11434/v1/chat/completions");
  assert.equal(request.options.headers.authorization, undefined);
  assert.equal(result.text, "local");
  assert.equal(result.stopReason, "max_tokens");
  assert.equal(provider.capabilities().reliableStructuredOutput, false);
});

test("la factoría falla al arrancar ante configuración inválida", () => {
  assert.throws(() => readLLMConfig({ LLM_PROVIDER: "desconocido", LLM_MODEL: "x" }), /desconocido/);
  assert.throws(() => readLLMConfig({ LLM_PROVIDER: "openai", LLM_MODEL: "x" }), /LLM_API_KEY/);
  assert.throws(() => readLLMConfig({ LLM_PROVIDER: "openai-compatible", LLM_MODEL: "x" }), /LLM_BASE_URL/);
  assert.deepEqual(readLLMConfig({}), { enabled: false });
});
