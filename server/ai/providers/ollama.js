import { LLMProvider, normalizeStopReason, readProviderResponse } from "./types.js";

export class OllamaProvider extends LLMProvider {
  constructor({ model, baseURL = "http://127.0.0.1:11434", maxTokens = 1400, thinking = false, keepAlive = "5m", fetchImpl = fetch }) {
    super();
    this.model = model;
    this.baseURL = String(baseURL).replace(/\/+$/, "");
    this.maxTokens = maxTokens;
    this.thinking = thinking;
    this.keepAlive = keepAlive;
    this.fetchImpl = fetchImpl;
  }

  capabilities() {
    return {
      reliableStructuredOutput: false,
      nativeJsonMode: true,
      promptCaching: false,
      maxContextTokens: 131072,
      supportsSystemRole: true,
      local: true,
      thinking: this.thinking,
    };
  }

  async call({ system, messages = [], maxTokens, max_tokens, temperature, responseFormat, response_format, stopSequences, stop_sequences }) {
    const options = { num_predict: maxTokens ?? max_tokens ?? this.maxTokens };
    if (temperature !== undefined) options.temperature = temperature;
    const stops = stopSequences ?? stop_sequences;
    if (stops?.length) options.stop = stops;
    const format = responseFormat ?? response_format;
    const body = {
      model: this.model,
      messages: [...(system ? [{ role: "system", content: system }] : []), ...messages],
      stream: false,
      think: this.thinking,
      keep_alive: this.keepAlive,
      options,
    };
    if (format === "json") body.format = "json";

    let response;
    try {
      response = await this.fetchImpl(`${this.baseURL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`Ollama local no está disponible: ${error.message}`);
    }
    const data = await readProviderResponse(response, "ollama");
    const text = data?.message?.content;
    if (!text) {
      const hint = data?.message?.thinking
        ? "El modelo consumió la salida razonando; configura LLM_THINKING=false"
        : "Respuesta vacía de ollama";
      throw new Error(hint);
    }
    return {
      text,
      usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
      provider: "ollama",
      model: data.model || this.model,
      stopReason: normalizeStopReason(data.done_reason),
    };
  }
}
