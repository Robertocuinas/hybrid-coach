import { ProviderError, ToolRouterProvider, readProviderResponse } from "../types.js";

const objetoPlano = (value) => value && typeof value === "object" && !Array.isArray(value);

export class NeedleToolRouterProvider extends ToolRouterProvider {
  constructor({ baseURL, minConfidence = 0.85, timeoutMs = 15000, fetchImpl = fetch }) {
    super();
    this.baseURL = baseURL.replace(/\/+$/, "");
    this.minConfidence = minConfidence;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  capabilities() {
    return {
      local: true,
      structuredToolCalls: true,
      executesTools: false,
      confidenceScore: true,
      freeTextGeneration: false,
    };
  }

  async health() {
    try {
      const response = await this.fetchImpl(`${this.baseURL}/health`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 2000)),
      });
      const data = await readProviderResponse(response, "needle");
      return { ready: data?.ok === true, version: data?.version || null };
    } catch {
      return { ready: false, version: null };
    }
  }

  async route(query, tools, { system = "", maxNewTokens = 128 } = {}) {
    const text = String(query || "").trim();
    if (!text) throw new TypeError("La consulta para Needle no puede estar vacía");
    if (!Array.isArray(tools) || !tools.length) throw new TypeError("Needle necesita al menos una herramienta");

    const allowed = new Set(tools.map((tool) => String(tool?.name || "").trim()).filter(Boolean));
    if (allowed.size !== tools.length) throw new TypeError("Todas las herramientas deben tener un nombre único");

    let response;
    try {
      response = await this.fetchImpl(`${this.baseURL}/route`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query: text, tools, system, maxNewTokens }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError("needle", 503, `Needle local no está disponible: ${error.message}`);
    }
    const data = await readProviderResponse(response, "needle");
    const confidence = Number(data?.confidence ?? 0);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new ProviderError("needle", 502, "Needle devolvió una confianza no válida");
    }

    const calls = Array.isArray(data?.function_calls) ? data.function_calls : [];
    if (data?.type !== "call" || !calls.length) {
      return { matched: false, reason: "no_tool", confidence, provider: "needle", model: "needle-2" };
    }

    const call = calls[0];
    if (!allowed.has(call?.name)) {
      throw new ProviderError("needle", 502, "Needle intentó usar una herramienta no permitida");
    }
    if (!objetoPlano(call.arguments || {})) {
      throw new ProviderError("needle", 502, "Needle devolvió argumentos no válidos");
    }

    const candidate = { name: call.name, arguments: call.arguments || {} };
    if (confidence < this.minConfidence) {
      return { matched: false, reason: "low_confidence", confidence, candidate, provider: "needle", model: "needle-2" };
    }
    return {
      matched: true,
      tool: candidate,
      confidence,
      provider: "needle",
      model: "needle-2",
      metrics: {
        prefillTokensPerSecond: data.prefill_tps ?? null,
        decodeTokensPerSecond: data.decode_tps ?? null,
        peakRamMb: data.peak_ram_mb ?? null,
      },
    };
  }
}
