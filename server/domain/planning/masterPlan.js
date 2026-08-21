/* Orquestador de generación del PLAN MAESTRO por IA+RAG.

   Sustituye al motor determinista del frontend (buildPlan) como fuente de
   verdad de la ESTRUCTURA del plan: semanas, fases, tirada larga, sesiones
   maestras. La IA decide guiada por la bibliografía recuperada; el código
   valida el contrato (masterPlanSchema) y aplica los guardarraíles clínicos
   antes de devolver algo persistente.

   Es un orquestador PURO: no importa repos, rutas ni proveedores. Las
   dependencias entran por `deps` para poder probarlo con fakes. */

import { calcularAnaliticaEntrenamiento } from "./analytics.js";
import { construirConsultasMaestro } from "./masterQueries.js";
import { parsearPlanMaestro, validarPlanMaestro, MASTER_PLAN_SCHEMA_VERSION } from "./masterPlanSchema.js";
import { construirPromptMaestro, construirPromptReparacionMaestro, MASTER_PLANNER_PROMPT_VERSION } from "./masterPlanPrompt.js";
import { crearFallbackSeguro } from "./fallback.js";

const JERARQUIA = Object.freeze({ meta_analysis: 6, systematic_review: 5, rct: 4, observational: 3, position_statement: 2, narrative_review: 1, preprint: 0 });
const GRADO = Object.freeze({ fuerte: 4, moderada: 3, debil: 2, débil: 2, practica: 1, práctica: 1 });

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
    promptVersion: MASTER_PLANNER_PROMPT_VERSION,
    schemaVersion: MASTER_PLAN_SCHEMA_VERSION,
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

export function seleccionarEvidenciaMaestro(resultados, { maxEvidence = 14, maxPerDocument = 2 } = {}) {
  const mapa = new Map();
  for (const resultado of resultados) {
    for (const chunk of resultado.chunks || []) {
      if (!chunk?.id || chunk._relleno || chunk.esRelleno) continue;
      const id = String(chunk.id);
      const previo = mapa.get(id);
      if (previo) {
        previo.queryKeys = [...new Set([...previo.queryKeys, resultado.consulta.key])];
        if (calidad(chunk) > calidad(previo)) Object.assign(previo, chunk);
      } else {
        mapa.set(id, { ...chunk, id, queryKeys: [resultado.consulta.key] });
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
  for (const candidato of candidatos) agregar(candidato);
  return { chunks: elegidos, complete: true };
}

async function invocarLLM(llmProvider, solicitud) {
  if (typeof llmProvider === "function") return llmProvider(solicitud);
  if (typeof llmProvider?.call === "function") return llmProvider.call(solicitud);
  if (typeof llmProvider?.complete === "function") return llmProvider.complete(solicitud);
  throw new TypeError("llmProvider debe ser función o implementar call()/complete()");
}

const textoRespuesta = (respuesta) => typeof respuesta === "string" ? respuesta : String(respuesta?.text ?? respuesta?.content ?? "");

/* Guardarraíles de estructura del plan maestro. Duros: invalidan la propuesta.
   No se relajan nunca —protegen la integridad física del atleta. */
function evaluarGuardarrailesMaestro(plan, contexto = {}, analytics = {}) {
  const hard = [];
  const registrar = (code, message, path) => hard.push({ code, message, path });
  const semanas = Array.isArray(plan?.semanas) ? plan.semanas : [];
  if (!semanas.length) return { valid: false, hard, soft: [] };

  const riesgo = Number(plan.riesgo?.score ?? 0);
  // Progresión de tirada larga: nunca un salto disparatado entre semanas.
  const largos = semanas.map((s) => {
    const larga = s.sesiones?.find((x) => /RUN A/i.test(x.codigo));
    return larga ? Number(larga.duracion_min ?? larga.duracionMin ?? 0) : 0;
  });
  for (let i = 1; i < largos.length; i++) {
    if (largos[i] > largos[i - 1] * 1.25 && largos[i - 1] > 0) {
      registrar("LONG_RUN_PROGRESSION", `La tirada larga no puede subir más de un 25% entre semanas (${largos[i - 1]}→${largos[i]} min).`, `$.semanas[${i}]`);
    }
  }
  // Densidad de carrera: no más de 4 sesiones de carrera en una semana.
  semanas.forEach((s, i) => {
    const carrera = (s.sesiones || []).filter((x) => /^RUN/.test(String(x.codigo))).length;
    if (carrera > 4) registrar("TOO_MANY_RUN_SESSIONS", "Más de 4 sesiones de carrera en una semana.", `$.semanas[${i}]`);
    const fuerza = (s.sesiones || []).filter((x) => /^GYM/.test(String(x.codigo))).length;
    if (fuerza > 4) registrar("TOO_MANY_STRENGTH_SESSIONS", "Más de 4 sesiones de fuerza en una semana.", `$.semanas[${i}]`);
  });
  // Riesgo alto: caminar-correr inicial o descargas más frecuentes.
  if (riesgo >= 6) {
    const primera = semanas[0];
    const tieneCaminarCorrer = (primera?.sesiones || []).some((x) => /RUN A/i.test(x.codigo) && /camin|corr/.test(String(x.objetivo || x.descripcion || "")));
    if (!tieneCaminarCorrer) registrar("HIGH_RISK_BASELINE", "Perfil de riesgo alto: la primera semana debe fraccionar el impacto (caminar-correr).", "$.semanas[0]");
  }
  // Cada sesión necesita evidencia (si la hubo disponible).
  semanas.forEach((s, i) => (s.sesiones || []).forEach((x, j) => {
    if (x.evidence_ids !== undefined && (!Array.isArray(x.evidence_ids) || !x.evidence_ids.length)) {
      registrar("SESSION_WITHOUT_EVIDENCE", "Cada sesión maestra debe citar la evidencia usada cuando la hay.", `$.semanas[${i}].sesiones[${j}]`);
    }
  }));
  return { valid: hard.length === 0, hard, soft: [] };
}

function normalizarPlanMaestroBruto(valor) {
  if (!valor || typeof valor !== "object") return valor;
  if (Array.isArray(valor.semanas)) {
    valor.semanas = valor.semanas.map((s) => {
      if (!s || typeof s !== "object") return s;
      const norm = { ...s };
      // El modelo a veces omite campos en semanas lejanas: se completan con
      // valores neutros para no rechazar todo el plan por un campo faltante.
      if (norm.checkpoint === undefined) norm.checkpoint = "";
      if (norm.nota === undefined) norm.nota = "";
      if (norm.gym === undefined) norm.gym = "carga";
      if (norm.deload === undefined) norm.deload = false;
      if (norm.taper === undefined) norm.taper = false;
      if (!Array.isArray(norm.sesiones)) norm.sesiones = [];
      norm.sesiones = norm.sesiones.map((x) => {
        if (!x || typeof x !== "object") return x;
        const n = { ...x };
        // titulo/objetivo son opcionales; si el modelo los puso pero con un tipo
        // inválido (numero, null, cadena vacia), se eliminan en vez de rechazar.
        if (n.titulo !== undefined && (typeof n.titulo !== "string" || n.titulo.length < 1 || n.titulo.length > 120)) delete n.titulo;
        if (n.objetivo !== undefined && (typeof n.objetivo !== "string" || n.objetivo.length > 300)) delete n.objetivo;
        if (n.dia !== undefined && (!Number.isInteger(n.dia) || n.dia < 1 || n.dia > 7)) delete n.dia;
        return n;
      });
      return norm;
    });
  }
  return valor;
}

function validarSalida(bruto, contexto, analytics, evidence) {
  const parsed = parsearPlanMaestro(bruto);
  if (!parsed.ok) return { ok: false, output: null, schema: parsed, errors: parsed.errors };
  const normalizado = normalizarPlanMaestroBruto(parsed.value);
  const schema = validarPlanMaestro(normalizado, {});
  if (!schema.ok) return { ok: false, output: null, schema, errors: schema.errors };
  const guardrails = evaluarGuardarrailesMaestro(schema.value, contexto, analytics);
  return {
    ok: guardrails.valid,
    output: guardrails.valid ? schema.value : null,
    schema,
    guardrails,
    errors: guardrails.hard.map((e) => ({ path: e.path, code: e.code, message: e.message })),
  };
}

/**
 * Genera un plan maestro completo (estructura) mediante IA+RAG.
 * Devuelve siempre un resultado; si la validación falla, un fallback seguro.
 */
export async function generarPlanMaestro(contexto = {}, deps = {}) {
  const inicio = Date.now();
  const { retrieve, llmProvider, maxEvidence = 14, queryConfig = {}, maxTokens = 4000 } = deps;
  const comunes = { analytics: null, queries: [], evidence: [], validation: null, provider: null, model: null, modelCalls: 0 };
  if (typeof retrieve !== "function" || !llmProvider || !contexto.profile) {
    return respuestaFallback(inicio, "invalid", "invalid_context", contexto, comunes, "Se requieren profile, retrieve y llmProvider.");
  }

  const analytics = calcularAnaliticaEntrenamiento({ ...contexto }, { hoy: contexto.now || new Date() });
  comunes.analytics = analytics;
  if (analytics.seguridad.dolorEnReposo || analytics.seguridad.redFlags.length) {
    return respuestaFallback(inicio, "fallback", "clinical_safety", contexto, comunes);
  }

  const queries = construirConsultasMaestro(contexto, analytics, queryConfig);
  comunes.queries = queries;
  const settled = await Promise.allSettled(queries.map(async (query) => {
    const result = await retrieve(query.query, { queryKey: query.key, filters: query.filters, contexto });
    return normalizarResultadoRetrieval(result, query);
  }));
  const resultados = settled.map((r, i) => r.status === "fulfilled"
    ? r.value
    : { consulta: queries[i], chunks: [], diagnostico: null, motivo: "retrieval_failed" });
  const seleccion = seleccionarEvidenciaMaestro(resultados, { maxEvidence });
  comunes.evidence = seleccion.chunks;
  if (!seleccion.chunks.length) {
    return respuestaFallback(inicio, "no_evidence", "no_evidence", contexto, comunes, { coverage: true });
  }

  const prompt = construirPromptMaestro({ contexto, analytics, evidence: seleccion.chunks });
  let respuesta;
  try {
    comunes.modelCalls++;
    /* El plan maestro completo (12 semanas x sesiones) es una salida grande:
       gpt-4.1-mini necesita hasta ~16k tokens de salida o el JSON se trunca y
       la validación falla. Se sube el tope y se pide JSON compacto. */
    respuesta = await invocarLLM(llmProvider, { ...prompt, maxTokens: Math.min(deps.maxTokens || 16000, 16000), responseFormat: "json" });
  } catch (e) {
    return respuestaFallback(inicio, "fallback", "llm_failed", contexto, comunes, String(e?.message || e).slice(0, 200));
  }
  comunes.provider = respuesta?.provider || null;
  comunes.model = respuesta?.model || null;
  let bruto = textoRespuesta(respuesta);
  let validation = validarSalida(bruto, contexto, analytics, seleccion.chunks);

  if (!validation.ok) {
    try {
      comunes.modelCalls++;
      const reparacion = construirPromptReparacionMaestro({ errores: validation.errors, intentoAnterior: bruto });
      respuesta = await invocarLLM(llmProvider, {
        system: prompt.system,
        messages: [...prompt.messages, { role: "assistant", content: bruto }, reparacion],
        maxTokens, responseFormat: "json",
      });
      comunes.provider = respuesta?.provider || comunes.provider;
      comunes.model = respuesta?.model || comunes.model;
      bruto = textoRespuesta(respuesta);
      validation = validarSalida(bruto, contexto, analytics, seleccion.chunks);
    } catch (e) {
      comunes.validation = validation;
      return respuestaFallback(inicio, "fallback", "llm_failed", contexto, comunes, String(e?.message || e).slice(0, 200));
    }
  }

  comunes.validation = validation;
  if (!validation.ok) {
    return respuestaFallback(inicio, "invalid", validation.guardrails ? "guardrail_failed" : "invalid_output", contexto, comunes, validation.errors);
  }
  return resultadoBase(inicio, { ...comunes, status: "proposal", output: validation.output });
}

export const generateMasterPlan = generarPlanMaestro;
