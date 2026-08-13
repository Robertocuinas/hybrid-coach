import { createLLMProvider } from "../server/ai/factory.js";

const provider = createLLMProvider({
  LLM_PROVIDER: "ollama",
  LLM_MODEL: process.env.LLM_MODEL || "qwen3:4b-instruct",
  LLM_BASE_URL: process.env.LLM_BASE_URL || "http://127.0.0.1:11434",
  LLM_THINKING: "false",
  LLM_MAX_TOKENS: "220",
});

try {
  const result = await provider.call({
    system: "Eres el redactor prudente de Hybrid Coach. Responde siempre en español y no diagnostiques lesiones.",
    messages: [{ role: "user", content: "Da en dos frases una recomendación suave de recuperación después de una carrera fácil." }],
    maxTokens: 220,
    temperature: 0.2,
  });
  console.log(JSON.stringify({ ok: true, provider: result.provider, model: result.model, text: result.text, usage: result.usage }, null, 2));
} catch (error) {
  console.error(`QWEN ROJO: ${error.message}`);
  process.exitCode = 1;
}
