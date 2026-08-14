import { RerankProvider, readProviderResponse } from "../types.js";

const COHERE_URL = "https://api.cohere.com/v2/rerank";

/* Cohere Rerank: ~$0,001 por búsqueda y 100+ idiomas, que es justo el caso de
   este proyecto (consultas en español sobre corpus en inglés). Devuelve
   relevance_score en 0-1 calibrado, así que sirve para el umbral. */
export class CohereRerankProvider extends RerankProvider {
  constructor({ apiKey, model, baseURL, fetchImpl = fetch }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.url = baseURL ? `${String(baseURL).replace(/\/+$/, "")}/v2/rerank` : COHERE_URL;
    this.provider = "cohere";
    this.fetchImpl = fetchImpl;
  }

  capabilities() {
    return { scoresAbsolutos: true, maxDocuments: 1000 };
  }

  async rerank(query, documents, topN = documents.length) {
    if (!documents.length) return [];
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        query,
        documents,
        top_n: Math.min(topN ?? documents.length, documents.length),
      }),
    });
    const data = await readProviderResponse(response, this.provider);
    return normalizarResultados(data?.results, documents.length, this.provider);
  }
}

/* Compartido con el adaptador openai-compatible: los dos hablan el mismo
   formato de respuesta y un índice fuera de rango es un fallo del proveedor
   que no debe propagarse como un chunk equivocado. */
export function normalizarResultados(results, totalDocumentos, provider) {
  if (!Array.isArray(results)) throw new Error(`${provider} no devolvió una lista de resultados`);
  return results
    .map((row) => ({
      index: Number(row?.index),
      score: Number(row?.relevance_score ?? row?.score),
    }))
    .filter((row) => Number.isInteger(row.index) && row.index >= 0 && row.index < totalDocumentos && Number.isFinite(row.score))
    .sort((a, b) => b.score - a.score);
}
