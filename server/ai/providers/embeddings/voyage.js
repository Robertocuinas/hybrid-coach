import { EmbeddingProvider } from "../types.js";
import { EMBEDDING_DIMENSIONS, normalizeVectors, readEmbeddingResponse, validateEmbeddingInput } from "./_shared.js";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

export class VoyageEmbeddingProvider extends EmbeddingProvider {
  constructor({ apiKey, model, fetchImpl = fetch }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.provider = "voyage";
    this.fetchImpl = fetchImpl;
  }

  dimensions() { return EMBEDDING_DIMENSIONS; }

  async embed(texts, { inputType = "document" } = {}) {
    validateEmbeddingInput(texts, inputType);
    const response = await this.fetchImpl(VOYAGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ input: texts, model: this.model, input_type: inputType, output_dimension: EMBEDDING_DIMENSIONS }),
    });
    return normalizeVectors(await readEmbeddingResponse(response, this.provider), {
      expectedCount: texts.length, provider: this.provider, model: this.model,
    });
  }
}
