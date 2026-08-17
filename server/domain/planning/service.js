import { calcularAnaliticaEntrenamiento } from "./analytics.js";
import { construirConsultasRAG } from "./queries.js";
import { parsearPlanSemanal, validarPlanSemanal } from "./schema.js";
import { evaluarGuardrailsPlan, GUARDRAILS_VERSION } from "./guardrails.js";
import { construirPromptPlanificador, construirPromptReparacion, PLANNER_PROMPT_VERSION } from "./prompt.js";
import { crearFallbackSeguro } from "./fallback.js";

const JERARQUIA = Object.freeze({ meta_analysis: 6, systematic_review: 5, rct: 4, observational: 3, position_statement: 2, narrative_review: 1, preprint: 0 });
const GRADO = Object.freeze({ fuerte: 4, moderada: 3, debil: 2, débil: 2, practica: 1, práctica: 1 });

const iso = (valor) => {
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const addDays = (fecha, n) => {
  const d = new Date(`${fecha}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};

function resultadoBase(inicio, datos = {}) {
  return {
    status: datos.status,
    output: datos.output || null,
    analytics: datos.analytics || null,
    queries: datos.queries || [],
    evidence: datos.evidence || [],
    validation: datos.validation || null,
    provider: datos.provider || null,
    model: datos.model || null,
    latencyMs: Date.now() - inicio,
    fallback: datos.fallback || null,
    promptVersion: PLANNER_PROMPT_VERSION,
    rulesVersion: GUARDRAILS_VERSION,
    modelCalls: datos.modelCalls || 0,
  };
}

function respuestaFallback(inicio, status, code, contexto, comunes = {}, details = null) {
  return resultadoBase(inicio, { ...comunes, status, fallback: crearFallbackSeguro({ code, contexto, details }) });
}

function normalizarResultadoRetrieval(resultado, consulta) {
  const chunks = Array.isArray(resultado) ? resultado : resultado?.chunks || [];
  const hayEvidencia = Array.isArray(resultado) ? chunks.length > 0 : resultado?.hayEvidencia !== false && chunks.length > 0;
  return { consulta, chunks: hayEvidencia ? chunks : [], diagnostico: resultado?.diagnostico || null, motivo: resultado?.motivo || null };
}

function calidad(chunk) {
  const tipo = chunk.studyType || chunk.study_type;
  const grado = chunk.evidenceGrade || chunk.evidence_grade;
  const score = Number(chunk.scores?.umbral ?? chunk.score ?? chunk.similarityScore ?? 0) || 0;
  return (JERARQUIA[tipo] ?? 0) * 100 + (GRADO[grado] ?? 0) * 10 + score;
}

/** Deduplicación, jerarquía metodológica, diversidad por paper y cobertura por consulta. */
export function seleccionarEvidencia(resultados, { maxEvidence = 12, maxPerDocument = 2 } = {}) {
  const mapa = new Map();
  for (const resultado of resultados) {
    for (const chunk of resultado.chunks || []) {
      if (!chunk?.id || chunk._relleno || chunk.esRelleno) continue;
      const id = String(chunk.id);
      const previo = mapa.get(id);
      if (previo) {
        previo.queryKeys = [...new Set([...previo.queryKeys, resultado.consulta.key])];
        previo.requiredFor = [...new Set([...previo.requiredFor, ...(resultado.consulta.required ? [resultado.consulta.key] : [])])];
        if (calidad(chunk) > calidad(previo)) Object.assign(previo, chunk);
      } else {
        mapa.set(id, { ...chunk, id, queryKeys: [resultado.consulta.key], requiredFor: resultado.consulta.required ? [resultado.consulta.key] : [] });
      }
    }
  }
  const candidatos = [...mapa.values()].sort((a, b) => calidad(b) - calidad(a));
  const elegidos = [], porDocumento = new Map();
  const puedeEntrar = (c) => (porDocumento.get(String(c.documentId || c.document_id || c.id)) || 0) < maxPerDocument;
  const agregar = (c) => {
    if (!c || elegidos.includes(c) || !puedeEntrar(c) || elegidos.length >= maxEvidence) return false;
    elegidos.push(c);
    const doc = String(c.documentId || c.document_id || c.id);
    porDocumento.set(doc, (porDocumento.get(doc) || 0) + 1);
    return true;
  };

  for (const resultado of resultados.filter((r) => r.consulta.required)) agregar(candidatos.find((c) => c.queryKeys.includes(resultado.consulta.key)));
  for (const candidato of candidatos) agregar(candidato);
  const coverage = Object.fromEntries(resultados.map((r) => [r.consulta.key, elegidos.some((c) => c.queryKeys.includes(r.consulta.key))]));
  return { chunks: elegidos, coverage, complete: resultados.filter((r) => r.consulta.required).every((r) => coverage[r.consulta.key]) };
}

async function invocarLLM(llmProvider, solicitud) {
  if (typeof llmProvider === "function") return llmProvider(solicitud);
  if (typeof llmProvider?.call === "function") return llmProvider.call(solicitud);
  if (typeof llmProvider?.complete === "function") return llmProvider.complete(solicitud);
  throw new TypeError("llmProvider debe ser función o implementar call()/complete()");
}

const textoRespuesta = (respuesta) => typeof respuesta === "string" ? respuesta : String(respuesta?.text ?? respuesta?.content ?? "");

function limitesSemana(contexto) {
  const w = contexto.week || {};
  const start = iso(w.start_date || w.startDate || w.inicio || contexto.weekStart);
  const end = iso(w.end_date || w.endDate || contexto.weekEnd) || (start ? addDays(start, 6) : null);
  return { start, end };
}

function idsDisponibilidad(contexto) {
  const raw = contexto.availability || [];
  if (Array.isArray(raw)) return raw;
  return raw.days || raw.dias || [];
}

function validarSalida(bruto, contexto, analytics, evidence, guardrailConfig) {
  const parsed = parsearPlanSemanal(bruto);
  if (!parsed.ok) return { ok: false, output: null, schema: parsed, guardrails: null, errors: parsed.errors };
  const semana = limitesSemana(contexto);
  const schema = validarPlanSemanal(parsed.value, {
    evidenceIds: evidence.map((c) => c.id),
    availabilityDays: idsDisponibilidad(contexto),
    weekStart: semana.start,
    weekEnd: semana.end,
    masterPlanId: contexto.plan?.id || null,
    masterWeekId: contexto.week?.id || null,
    masterSessionIds: (contexto.week?.sessions || contexto.week?.sesiones || [])
      .map((session) => session.id || session.planned_session_id)
      .filter(Boolean),
    masterSessionCodes: (contexto.week?.sessions || contexto.week?.sesiones || [])
      .map((session) => session.master_session_code || session.codigo_sesion || session.session_code)
      .filter(Boolean),
    today: iso(contexto.now || new Date()),
  });
  if (!schema.ok) return { ok: false, output: null, schema, guardrails: null, errors: schema.errors };
  const guardrails = evaluarGuardrailsPlan(schema.value, contexto, analytics, guardrailConfig);
  return {
    ok: guardrails.valid,
    output: guardrails.valid ? schema.value : null,
    schema,
    guardrails,
    errors: guardrails.hard.map((e) => ({ path: e.path, code: e.code, message: e.message })),
  };
}

/**
 * Orquestador puro. No importa repositorios, rutas ni proveedores concretos y
 * no expone ninguna operación de persistencia o activación.
 */
export async function planificarSemana(contexto = {}, deps = {}) {
  const inicio = Date.now();
  const { retrieve, llmProvider, maxEvidence = 12, queryConfig = {}, guardrailConfig = {}, maxTokens = 3000 } = deps;
  const comunes = { analytics: null, queries: [], evidence: [], validation: null, provider: null, model: null, modelCalls: 0 };
  if (typeof retrieve !== "function" || !llmProvider || !contexto.profile || !contexto.plan || !contexto.week) {
    return respuestaFallback(inicio, "invalid", "invalid_context", contexto, comunes, "Se requieren profile, plan, week, retrieve y llmProvider.");
  }

  const contextoCanonico = contexto.acceptedRevision && contexto.acceptedSessions && !contexto.acceptedRevision.sessions
    ? { ...contexto, acceptedRevision: { ...contexto.acceptedRevision, sessions: contexto.acceptedSessions } }
    : contexto;
  const analytics = calcularAnaliticaEntrenamiento({ ...contextoCanonico, masterWeek: contexto.week }, { hoy: contexto.now || new Date() });
  comunes.analytics = analytics;
  /* Las señales clínicas graves no necesitan literatura para decidir que no se
     debe generar entrenamiento de impacto. */
  if (analytics.seguridad.dolorEnReposo || analytics.seguridad.redFlags.length) {
    return respuestaFallback(inicio, "fallback", "clinical_safety", contexto, comunes);
  }

  const queries = construirConsultasRAG({ ...contextoCanonico, masterWeek: contexto.week }, analytics, queryConfig);
  comunes.queries = queries;
  const settled = await Promise.allSettled(queries.map(async (query) => {
    const result = await retrieve(query.query, { queryKey: query.key, filters: query.filters, contexto: contextoCanonico });
    return normalizarResultadoRetrieval(result, query);
  }));
  const resultados = settled.map((r, i) => r.status === "fulfilled"
    ? r.value
    : { consulta: queries[i], chunks: [], diagnostico: null, motivo: "retrieval_failed" });
  const seleccion = seleccionarEvidencia(resultados, { maxEvidence, maxPerDocument: deps.maxPerDocument ?? 2 });
  comunes.evidence = seleccion.chunks;
  if (!seleccion.chunks.length || !seleccion.complete) {
    const falloTotal = settled.every((r) => r.status === "rejected");
    return respuestaFallback(inicio, "no_evidence", falloTotal ? "retrieval_failed" : "no_evidence", contexto, comunes, { coverage: seleccion.coverage });
  }

  /* Los mismos límites y la misma disponibilidad que usará validarSalida(): si
     el prompt y el validador no partieran de aquí, el modelo recibiría un
     calendario que el validador luego rechazaría. */
  const prompt = construirPromptPlanificador({
    contexto: contextoCanonico, analytics, queries, evidence: seleccion.chunks,
    semana: limitesSemana(contextoCanonico),
    disponibilidad: idsDisponibilidad(contextoCanonico),
  });
  let respuesta;
  try {
    comunes.modelCalls++;
    respuesta = await invocarLLM(llmProvider, { ...prompt, maxTokens, responseFormat: "json" });
  } catch (e) {
    return respuestaFallback(inicio, "fallback", "llm_failed", contexto, comunes, String(e?.message || e).slice(0, 200));
  }
  comunes.provider = respuesta?.provider || null;
  comunes.model = respuesta?.model || null;
  let bruto = textoRespuesta(respuesta);
  let validation = validarSalida(bruto, contextoCanonico, analytics, seleccion.chunks, guardrailConfig);

  if (!validation.ok) {
    try {
      comunes.modelCalls++;
      const reparacion = construirPromptReparacion({ errores: validation.errors, intentoAnterior: bruto });
      respuesta = await invocarLLM(llmProvider, {
        system: prompt.system,
        messages: [...prompt.messages, { role: "assistant", content: bruto }, reparacion],
        maxTokens,
        responseFormat: "json",
      });
      comunes.provider = respuesta?.provider || comunes.provider;
      comunes.model = respuesta?.model || comunes.model;
      bruto = textoRespuesta(respuesta);
      validation = validarSalida(bruto, contextoCanonico, analytics, seleccion.chunks, guardrailConfig);
    } catch (e) {
      comunes.validation = validation;
      return respuestaFallback(inicio, "fallback", "llm_failed", contexto, comunes, String(e?.message || e).slice(0, 200));
    }
  }

  comunes.validation = validation;
  if (!validation.ok) return respuestaFallback(inicio, "invalid", validation.guardrails ? "guardrail_failed" : "invalid_output", contexto, comunes, validation.errors);
  return resultadoBase(inicio, { ...comunes, status: "proposal", output: validation.output });
}

export function crearTrainingPlannerService(deps) {
  return { planificarSemana: (contexto) => planificarSemana(contexto, deps) };
}

export const planWeeklyTraining = planificarSemana;
