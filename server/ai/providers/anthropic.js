import { LLMProvider, normalizeStopReason, readProviderResponse } from "./types.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

export class AnthropicProvider extends LLMProvider {
  /* `maxTokens` llega de la configuración (limits.js) y actúa como valor por
     defecto del proveedor. Antes se descartaba en el constructor y cada
     llamada sin `maxTokens` explícito caía en un literal de 1400 escrito para
     un modelo pequeño, con lo que subir LLM_MAX_TOKENS no tenía ningún efecto
     sobre las tareas que no lo pasaban a mano. */
  constructor({ apiKey, model, maxTokens, fetchImpl = fetch }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = Number(maxTokens) > 0 ? Number(maxTokens) : undefined;
    this.fetchImpl = fetchImpl;
  }

  capabilities() {
    return {
      reliableStructuredOutput: true,
      nativeJsonMode: false,
      promptCaching: true,
      maxContextTokens: 200000,
      supportsSystemRole: true,
    };
  }

  /* `temperature` se acepta en la firma pero NO se envía. Los modelos Claude
     actuales retiraron los parámetros de muestreo: mandarlos devuelve 400 y la
     petición entera falla. Absorberlo aquí es justo el trabajo del adaptador —
     quien llama sigue usando el mismo contrato para todos los proveedores y no
     tiene que saber qué acepta cada API (docs/04-capa-ia.md). */
  async call({ system, messages = [], maxTokens, max_tokens, temperature: _temperature, stopSequences, stop_sequences }) {
    const body = {
      model: this.model,
      max_tokens: maxTokens ?? max_tokens ?? this.maxTokens ?? 8000,
      system,
      messages,
    };
    const stops = stopSequences ?? stop_sequences;
    if (stops?.length) body.stop_sequences = stops;
    const response = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    const data = await readProviderResponse(response, "anthropic");
    const text = (data.content || []).filter((block) => block.type === "text").map((block) => block.text).join("\n");
    if (!text) throw new Error("Respuesta vacía de anthropic");
    return {
      text,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
      provider: "anthropic",
      model: data.model || this.model,
      stopReason: normalizeStopReason(data.stop_reason),
    };
  }
}
