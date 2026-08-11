import { EmbeddingProvider } from "../types.js";
import { EMBEDDING_DIMENSIONS, normalizeBaseURL, normalizeVectors, readEmbeddingResponse, validateEmbeddingInput } from "./_shared.js";

export class OpenAICompatibleEmbeddingProvider extends EmbeddingProvider {
  constructor({ apiKey = "", model, baseURL, fetchImpl = fetch, provider = "openai-compatible", sendDimensions = false }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.baseURL = normalizeBaseURL(baseURL);
    this.provider = provider;
    this.fetchImpl = fetchImpl;
    this.sendDimensions = sendDimensions;
  }

  dimensions() { return EMBEDDING_DIMENSIONS; }

  async embed(texts, { inputType = "document" } = {}) {
    validateEmbeddingInput(texts, inputType);
    const body = { input: texts, model: this.model };
    if (this.sendDimensions) body.dimensions = EMBEDDING_DIMENSIONS;
    const headers = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const response = await this.fetchImpl(`${this.baseURL}/embeddings`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    return normalizeVectors(await readEmbeddingResponse(response, this.provider), {
      expectedCount: texts.length, provider: this.provider, model: this.model,
    });
  }
}
