import { OpenAICompatibleEmbeddingProvider } from "./openai-compatible.js";

const OPENAI_EMBEDDING_BASE_URL = "https://api.openai.com/v1";

export class OpenAIEmbeddingProvider extends OpenAICompatibleEmbeddingProvider {
  constructor({ apiKey, model, baseURL = OPENAI_EMBEDDING_BASE_URL, fetchImpl = fetch }) {
    super({ apiKey, model, baseURL, fetchImpl, provider: "openai", sendDimensions: true });
  }
}

export { OPENAI_EMBEDDING_BASE_URL };
