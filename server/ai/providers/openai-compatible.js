import { LLMProvider, normalizeStopReason, readProviderResponse } from "./types.js";

export function normalizeBaseURL(value) {
  return String(value || "").replace(/\/+$/, "");
}

export class OpenAICompatibleProvider extends LLMProvider {
  constructor({ apiKey = "", model, baseURL, maxTokens, fetchImpl = fetch, provider = "openai-compatible", nativeJsonMode = false, reliableStructuredOutput = false }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.baseURL = normalizeBaseURL(baseURL);
    /* Valor por defecto del proveedor, tomado de la configuración. Sin esto,
       una llamada que no pase `maxTokens` se quedaba en 1400 tokens de salida
       por mucho que LLM_MAX_TOKENS dijera otra cosa. */
    this.maxTokens = Number(maxTokens) > 0 ? Number(maxTokens) : undefined;
    this.fetchImpl = fetchImpl;
    this.provider = provider;
    this.nativeJsonMode = nativeJsonMode;
    this.reliableStructuredOutput = reliableStructuredOutput;
  }

  capabilities() {
    return {
      reliableStructuredOutput: this.reliableStructuredOutput,
      nativeJsonMode: this.nativeJsonMode,
      promptCaching: false,
      maxContextTokens: 128000,
      supportsSystemRole: true,
    };
  }

  async call({ system, messages = [], maxTokens, max_tokens, temperature, responseFormat, response_format, stopSequences, stop_sequences }) {
    const body = {
      model: this.model,
      messages: [...(system ? [{ role: "system", content: system }] : []), ...messages],
      max_tokens: maxTokens ?? max_tokens ?? this.maxTokens ?? 8000,
    };
    if (temperature !== undefined) body.temperature = temperature;
    const stops = stopSequences ?? stop_sequences;
    if (stops?.length) body.stop = stops;
    const format = responseFormat ?? response_format;
    if (format === "json" && this.nativeJsonMode) body.response_format = { type: "json_object" };
    const headers = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const response = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    const data = await readProviderResponse(response, this.provider);
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error(`Respuesta vacía de ${this.provider}`);
    return {
      text,
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      provider: this.provider,
      model: data.model || this.model,
      stopReason: normalizeStopReason(data.choices?.[0]?.finish_reason),
    };
  }
}
