import { RerankProvider, readProviderResponse } from "../types.js";
import { normalizarResultados } from "./cohere.js";

/* OJO con el nombre: OpenAI NO tiene endpoint de reranking. "openai-compatible"
   aquí significa "el servidor local que ya usas para LLM o embeddings, que
   además expone un /rerank". Es el contrato de facto de los rerankers que se
   despliegan en local — Text Embeddings Inference de HuggingFace, Jina,
   vLLM—: POST {baseURL}/rerank con { query, documents, top_n } y respuesta
   [{ index, relevance_score }], que es el mismo formato que Cohere.

   Cubre todo el caso local con un solo adaptador, igual que hace
   openai-compatible en LLM y embeddings (docs/10-decisiones-tecnicas.md D5). */
export class OpenAICompatibleRerankProvider extends RerankProvider {
  constructor({ apiKey, model, baseURL, fetchImpl = fetch }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.url = `${String(baseURL).replace(/\/+$/, "")}/rerank`;
    this.provider = "openai-compatible";
    this.fetchImpl = fetchImpl;
  }

  capabilities() {
    return { scoresAbsolutos: true, maxDocuments: 1000 };
  }

  async rerank(query, documents, topN = documents.length) {
    if (!documents.length) return [];
    const headers = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const body = { query, documents, top_n: Math.min(topN ?? documents.length, documents.length) };
    /* El modelo es opcional: un servidor local suele servir uno solo y algunos
       rechazan la petición si llega un campo que no esperan. */
    if (this.model) body.model = this.model;

    const response = await this.fetchImpl(this.url, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await readProviderResponse(response, this.provider);
    /* TEI devuelve la lista pelada; Jina y Cohere la envuelven en `results`. */
    const results = Array.isArray(data) ? data : data?.results;
    return normalizarResultados(results, documents.length, this.provider);
  }
}
