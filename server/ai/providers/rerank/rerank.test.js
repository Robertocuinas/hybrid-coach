import test from "node:test";
import assert from "node:assert/strict";
import { CohereRerankProvider } from "./cohere.js";
import { OpenAICompatibleRerankProvider } from "./openai-compatible.js";
import { NoopRerankProvider } from "./noop.js";
import { createRerankProvider, readRerankConfig, readRAGConfig } from "../../factory.js";

const DOCS = ["fragmento a", "fragmento b", "fragmento c"];

test("noop conserva el orden de la fusión y no inventa relevancia", async () => {
  const provider = new NoopRerankProvider();
  const salida = await provider.rerank("da igual", DOCS, 2);
  assert.deepEqual(salida.map((r) => r.index), [0, 1]);
  assert.equal(provider.capabilities().scoresAbsolutos, false,
    "noop no debe declarar scores absolutos: el umbral caería sobre un número sin significado");
});

test("cohere manda query, documents y top_n, y ordena por relevancia", async () => {
  let recibido = null;
  const provider = new CohereRerankProvider({
    apiKey: "clave", model: "rerank-v3.5",
    fetchImpl: async (url, opciones) => {
      recibido = { url, body: JSON.parse(opciones.body), auth: opciones.headers.authorization };
      return new Response(JSON.stringify({ results: [
        { index: 2, relevance_score: 0.91 },
        { index: 0, relevance_score: 0.42 },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const salida = await provider.rerank("cuánto separar fuerza de series", DOCS, 2);
  assert.equal(recibido.url, "https://api.cohere.com/v2/rerank");
  assert.equal(recibido.auth, "Bearer clave");
  assert.deepEqual(recibido.body.documents, DOCS);
  assert.equal(recibido.body.top_n, 2);
  assert.deepEqual(salida, [{ index: 2, score: 0.91 }, { index: 0, score: 0.42 }]);
  assert.equal(provider.capabilities().scoresAbsolutos, true);
});

test("un índice fuera de rango del proveedor se descarta en vez de devolver el chunk equivocado", async () => {
  const provider = new CohereRerankProvider({
    apiKey: "k", model: "m",
    fetchImpl: async () => new Response(JSON.stringify({ results: [
      { index: 99, relevance_score: 0.99 },
      { index: 1, relevance_score: 0.5 },
    ] }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.deepEqual(await provider.rerank("q", DOCS), [{ index: 1, score: 0.5 }]);
});

test("un error del proveedor de reranking se propaga con su mensaje", async () => {
  const provider = new CohereRerankProvider({
    apiKey: "k", model: "m",
    fetchImpl: async () => new Response(JSON.stringify({ message: "clave inválida" }), { status: 401, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(() => provider.rerank("q", DOCS), /clave inválida/);
});

test("openai-compatible llama a {baseURL}/rerank y acepta lista pelada o envuelta", async () => {
  const llamadas = [];
  const crear = (respuesta) => new OpenAICompatibleRerankProvider({
    baseURL: "http://localhost:8080", model: "bge-reranker", apiKey: "",
    fetchImpl: async (url, opciones) => {
      llamadas.push({ url, body: JSON.parse(opciones.body), auth: opciones.headers.authorization });
      return new Response(JSON.stringify(respuesta), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  // Formato TEI: lista sin envolver.
  const pelada = await crear([{ index: 1, score: 0.8 }]).rerank("q", DOCS, 1);
  assert.deepEqual(pelada, [{ index: 1, score: 0.8 }]);
  // Formato Jina/Cohere: envuelta en results.
  const envuelta = await crear({ results: [{ index: 0, relevance_score: 0.7 }] }).rerank("q", DOCS, 1);
  assert.deepEqual(envuelta, [{ index: 0, score: 0.7 }]);

  assert.equal(llamadas[0].url, "http://localhost:8080/rerank");
  assert.equal(llamadas[0].auth, undefined, "sin apiKey no se manda cabecera de autorización");
});

test("la fábrica devuelve noop cuando no hay nada configurado", () => {
  const provider = createRerankProvider({});
  assert.equal(provider.provider, "noop");
  assert.equal(readRerankConfig({}).provider, "noop");
});

test("la fábrica valida la configuración de cada proveedor", () => {
  assert.throws(() => readRerankConfig({ RERANK_PROVIDER: "inventado" }), /RERANK_PROVIDER desconocido/);
  assert.throws(() => readRerankConfig({ RERANK_PROVIDER: "cohere" }), /RERANK_MODEL es obligatoria para RERANK_PROVIDER=cohere/);
  assert.throws(() => readRerankConfig({ RERANK_PROVIDER: "cohere", RERANK_MODEL: "m" }), /RERANK_API_KEY/);
  assert.throws(() => readRerankConfig({ RERANK_PROVIDER: "openai-compatible" }), /RERANK_BASE_URL/);
  assert.throws(() => readRerankConfig({ RERANK_PROVIDER: "openai-compatible", RERANK_BASE_URL: "ftp://x" }), /RERANK_BASE_URL debe usar http/);

  const local = readRerankConfig({ RERANK_PROVIDER: "openai-compatible", RERANK_BASE_URL: "http://localhost:8080/" });
  assert.equal(local.baseURL, "http://localhost:8080");
  assert.equal(local.apiKey, "", "un servidor local puede no pedir clave");
});

test("la configuración RAG tiene valores por defecto sensatos y valida los límites", () => {
  const porDefecto = readRAGConfig({});
  assert.equal(porDefecto.topKRetrieval, 25);
  assert.equal(porDefecto.topKFinal, 8);
  assert.equal(porDefecto.rrfK, 60);
  assert.equal(porDefecto.weightByGrade, false, "la ponderación por grado debe venir desactivada");

  assert.throws(() => readRAGConfig({ RAG_MIN_SCORE: "2" }), /RAG_MIN_SCORE/);
  assert.throws(() => readRAGConfig({ RAG_TOP_K_FINAL: "30", RAG_TOP_K_RETRIEVAL: "10" }),
    /RAG_TOP_K_FINAL/, "no se puede devolver más de lo que se recupera");
  assert.equal(readRAGConfig({ RAG_WEIGHT_BY_GRADE: "true" }).weightByGrade, true);
});
