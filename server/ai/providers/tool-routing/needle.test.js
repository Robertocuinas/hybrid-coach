import test from "node:test";
import assert from "node:assert/strict";
import { createToolRouterProvider, readToolRouterConfig } from "../../factory.js";

const tools = [{ name: "consultar_sesiones", description: "Sesiones", parameters: { type: "object" } }];
const ok = (data) => ({ ok: true, status: 200, json: async () => data });

test("Needle enruta una herramienta permitida por encima del umbral", async () => {
  let request;
  const provider = createToolRouterProvider({
    TOOL_ROUTER_PROVIDER: "needle",
    NEEDLE_BASE_URL: "http://127.0.0.1:9475",
    NEEDLE_MIN_CONFIDENCE: "0.85",
  }, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return ok({ type: "call", function_calls: [{ name: "consultar_sesiones", arguments: { periodo: "semana" } }], confidence: 0.92 });
    },
  });
  const result = await provider.route("Mis sesiones", tools);
  assert.equal(request.url, "http://127.0.0.1:9475/route");
  assert.equal(result.matched, true);
  assert.deepEqual(result.tool, { name: "consultar_sesiones", arguments: { periodo: "semana" } });
  assert.equal(provider.capabilities().executesTools, false);
});

test("Needle no autoriza una llamada con confianza baja", async () => {
  const provider = createToolRouterProvider({ TOOL_ROUTER_PROVIDER: "needle" }, {
    fetchImpl: async () => ok({ type: "call", function_calls: [{ name: "consultar_sesiones", arguments: {} }], confidence: 0.4 }),
  });
  const result = await provider.route("quizá sesiones", tools);
  assert.equal(result.matched, false);
  assert.equal(result.reason, "low_confidence");
  assert.equal(result.candidate.name, "consultar_sesiones");
});

test("Needle rechaza herramientas inventadas por el modelo", async () => {
  const provider = createToolRouterProvider({ TOOL_ROUTER_PROVIDER: "needle" }, {
    fetchImpl: async () => ok({ type: "call", function_calls: [{ name: "borrar_perfil", arguments: {} }], confidence: 0.99 }),
  });
  await assert.rejects(provider.route("borra todo", tools), /no permitida/);
});

test("la configuración Needle es local y no necesita clave", () => {
  assert.deepEqual(readToolRouterConfig({}), { enabled: false });
  assert.equal(readToolRouterConfig({ TOOL_ROUTER_PROVIDER: "needle" }).baseURL, "http://127.0.0.1:9475");
  assert.throws(() => readToolRouterConfig({ TOOL_ROUTER_PROVIDER: "needle", NEEDLE_MIN_CONFIDENCE: "2" }), /entre 0 y 1/);
  assert.throws(() => readToolRouterConfig({ TOOL_ROUTER_PROVIDER: "needle", NEEDLE_BASE_URL: "https://example.com" }), /debe ser local/);
});
