import test from "node:test";
import assert from "node:assert/strict";
import { createEmbeddingProvider, readEmbeddingConfig } from "../../factory.js";

const vector = (seed = 0) => Array.from({ length: 1024 }, (_, index) => seed + index / 10000);
const ok = (texts) => ({ ok: true, status: 200, json: async () => ({
  data: texts.map((_, index) => ({ index, embedding: vector(index) })), usage: { total_tokens: texts.length * 3 },
}) });

test("Voyage envía el lote y respeta inputType=document", async () => {
  let request;
  const provider = createEmbeddingProvider({
    EMBEDDING_PROVIDER: "voyage", EMBEDDING_MODEL: "voyage-4", EMBEDDING_API_KEY: "test-key", EMBEDDING_DIMENSIONS: "1024",
  }, { fetchImpl: async (url, options) => { request = { url, options }; return ok(JSON.parse(options.body).input); } });
  const result = await provider.embed(["uno", "dos"], { inputType: "document" });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.voyageai.com/v1/embeddings");
  assert.equal(body.input_type, "document");
  assert.equal(body.output_dimension, 1024);
  assert.equal(result.vectors.length, 2);
  assert.equal(result.vectors[0].length, 1024);
});

test("OpenAI solicita truncado Matryoshka a 1024 dimensiones", async () => {
  let request;
  const provider = createEmbeddingProvider({
    EMBEDDING_PROVIDER: "openai", EMBEDDING_MODEL: "text-embedding-3-large", EMBEDDING_API_KEY: "test-key",
  }, { fetchImpl: async (url, options) => { request = { url, options }; return ok(JSON.parse(options.body).input); } });
  await provider.embed(["consulta"], { inputType: "query" });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.openai.com/v1/embeddings");
  assert.equal(body.dimensions, 1024);
  assert.equal(provider.dimensions(), 1024);
});

test("openai-compatible usa BGE-M3 local sin exigir clave", async () => {
  let request;
  const provider = createEmbeddingProvider({
    EMBEDDING_PROVIDER: "openai-compatible", EMBEDDING_MODEL: "bge-m3", EMBEDDING_BASE_URL: "http://localhost:11434/v1",
  }, { fetchImpl: async (url, options) => { request = { url, options }; return ok(JSON.parse(options.body).input); } });
  const result = await provider.embed(["pregunta"], { inputType: "query" });
  assert.equal(request.url, "http://localhost:11434/v1/embeddings");
  assert.equal(request.options.headers.authorization, undefined);
  assert.equal(result.model, "bge-m3");
});

test("la configuración rechaza dimensiones y credenciales inválidas", () => {
  assert.throws(() => readEmbeddingConfig({ EMBEDDING_PROVIDER: "voyage", EMBEDDING_MODEL: "x", EMBEDDING_API_KEY: "k", EMBEDDING_DIMENSIONS: "768" }), /1024/);
  assert.throws(() => readEmbeddingConfig({ EMBEDDING_PROVIDER: "openai", EMBEDDING_MODEL: "x" }), /EMBEDDING_API_KEY/);
  assert.throws(() => readEmbeddingConfig({ EMBEDDING_PROVIDER: "openai-compatible", EMBEDDING_MODEL: "bge-m3" }), /EMBEDDING_BASE_URL/);
  assert.deepEqual(readEmbeddingConfig({}), { enabled: false });
});
