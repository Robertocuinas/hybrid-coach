import { OpenAICompatibleProvider } from "./openai-compatible.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor({ apiKey, model, baseURL = DEFAULT_BASE_URL, fetchImpl = fetch }) {
    super({ apiKey, model, baseURL, fetchImpl, provider: "openai", nativeJsonMode: true, reliableStructuredOutput: true });
  }
}
