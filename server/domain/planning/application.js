/* Capa de aplicación del planificador semanal.

   Une la lectura canónica de PostgreSQL, el retrieval, el orquestador puro y
   la persistencia auditable. Las rutas HTTP solo validan autenticación y
   traducen errores; ninguna decisión de entrenamiento vive en Express. */
import * as documentsRepo from "../../db/repositories/documents.js";
import {
  createPlanningDraft,
  createPlanningRun,
  getWeeklyPlanRevision,
  hashPlanningInput,
  readCanonicalPlanningContext,
} from "../../db/repositories/weeklyPlanning.js";
import { recuperar } from "../../rag/retrieval.js";
import { WEEKLY_PLAN_SCHEMA_VERSION } from "./schema.js";
import { planificarSemana } from "./service.js";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class PlanningRequestError extends Error {
  constructor(message, { code = "INVALID_PLANNING_REQUEST", status = 400, details = null } = {}) {
    super(message);
    this.name = "PlanningRequestError";
    this.code = code;
    this.publicCode = code;
    this.publicMessage = message;
    this.status = status;
    this.statusCode = status;
    this.details = details;
  }
}

export class PlanningGenerationError extends Error {
  constructor(message, { code = "PLANNING_NOT_GENERATED", status = 422, fallback = null } = {}) {
    super(message);
    this.name = "PlanningGenerationError";
    this.code = code;
    this.publicCode = code;
    this.publicMessage = message;
    this.status = status;
    this.statusCode = status;
    this.fallback = fallback;
  }
}

const fecha = (value) => {
  if (!value) return null;
  if (typeof value === "string" && FECHA.test(value)) return value;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const sumarDias = (value, days) => {
  const base = fecha(value);
  if (!base) return null;
  const parsed = new Date(`${base}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

/* Inicio (lunes) de la semana N de un plan maestro, contando hacia atrás desde
   la semana de la carrera. La semana `totalSemanas` es la de la carrera; la 1 es
   la más lejana. Devuelve null si faltan datos. */
function calcularInicioSemana(fechaCarrera, totalSemanas, numeroSemana) {
  const fc = fecha(fechaCarrera);
  const total = Number(totalSemanas);
  const n = Number(numeroSemana);
  if (!fc || !Number.isInteger(total) || !Number.isInteger(n) || n < 1 || n > total) return null;
  // Lunes de la semana de la carrera.
  const carrera = new Date(`${fc}T12:00:00Z`);
  const diaSemana = (carrera.getUTCDay() + 6) % 7; // 0=lunes
  const lunesCarrera = sumarDias(fc, -diaSemana);
  if (!lunesCarrera) return null;
  const semanasAtras = total - n;
  return sumarDias(lunesCarrera, -semanasAtras * 7);
}

const numeroONull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const elegir = (object, keys) => Object.fromEntries(keys
  .filter((key) => object?.[key] !== undefined)
  .map((key) => [key, object[key]]));

const PROFILE_FIELDS = Object.freeze([
  "edad", "sexo", "altura_cm", "peso_kg", "grasa_pct", "distancia_objetivo",
  "fecha_carrera", "meta_tipo", "meta_tiempo", "prioridades", "exp_carrera",
  "km_semana", "sesiones_carrera", "tirada_larga_min", "ritmo_comodo", "paron",
  "superficie", "exp_fuerza", "equipamiento", "cargas", "tecnica", "estructural",
  "cirugias", "banderas", "momento_entreno", "cross_training", "horas_sueno",
  "calidad_sueno", "estres", "trabajo", "nutricion_objetivo", "suplementos",
  "reloj", "current_complaints", "planning_context_version",
]);

const PLAN_FIELDS = Object.freeze([
  "id", "version", "distancia_objetivo", "fecha_carrera", "total_semanas",
  "taper_semanas", "run_dias", "gym_dias", "techo_tirada_larga_min",
  "riesgo_score", "riesgo_causas", "structure_hash",
]);

function diasDisponibles(value, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new PlanningRequestError("Indica al menos un día disponible.", { code: "AVAILABILITY_REQUIRED" });
    return null;
  }
  if (!Array.isArray(value)) throw new PlanningRequestError("Los días disponibles deben ser un array.");
  const parsed = [...new Set(value.map(Number))].sort((a, b) => a - b);
  if (!parsed.length || parsed.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new PlanningRequestError("Los días disponibles deben ser índices entre 0 (lunes) y 6 (domingo).", { code: "INVALID_AVAILABILITY" });
  }
  return parsed;
}

function escala(value, name, { min = 0, max = 10 } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new PlanningRequestError(`${name} debe ser un entero entre ${min} y ${max}.`, { code: "INVALID_WELLBEING_VALUE" });
  }
  return parsed;
}

export function normalizePlanningInput(input = {}, { requireAvailability = false } = {}) {
  const source = input && typeof input === "object" ? input : {};
  const weekNumber = Number(source.weekNumber ?? source.week ?? source.semana);
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 104) {
    throw new PlanningRequestError("La semana debe ser un entero entre 1 y 104.", { code: "INVALID_WEEK" });
  }
  const availabilityDays = diasDisponibles(
    source.availabilityDays ?? source.availableDays ?? source.dias,
    { required: requireAvailability },
  );
  const allowStrength = source.gym ?? source.gimnasio;
  const allowRunning = source.run ?? source.correr;
  if (allowStrength !== undefined && typeof allowStrength !== "boolean") {
    throw new PlanningRequestError("gym debe ser booleano.");
  }
  if (allowRunning !== undefined && typeof allowRunning !== "boolean") {
    throw new PlanningRequestError("correr debe ser booleano.");
  }
  if (allowStrength === false && allowRunning === false) {
    throw new PlanningRequestError("Activa carrera, fuerza o ambas para generar una semana.", { code: "NO_MODALITY_SELECTED" });
  }
  return {
    weekNumber,
    availabilityDays,
    allowStrength: allowStrength !== false,
    allowRunning: allowRunning !== false,
    pain: escala(source.pain ?? source.dolor, "dolor"),
    fatigue: escala(source.fatigue ?? source.fatiga, "fatiga"),
  };
}

function tipoSesion(code, description, modality) {
  const text = `${code || ""} ${description || ""}`.toLowerCase();
  if (modality === "strength") return /gym a|pesad|pierna/.test(text) ? "heavy_strength" : "strength";
  if (modality === "recovery") return "mobility";
  if (/competici|race/.test(text)) return "race";
  if (/run a|tirada|long/.test(text)) return "long_run";
  if (/interval|serie|repetici/.test(text)) return "intervals";
  if (/tempo|umbral|run b/.test(text)) return "tempo";
  if (/regener|recovery|run d/.test(text)) return "recovery_run";
  return "easy_run";
}

function normalizarSesionMaestra(session, weekStart) {
  const day = Number(session.dia_semana ?? session.day_of_week ?? session.day);
  const code = String(session.codigo_sesion ?? session.session_code ?? session.code ?? "").trim();
  const rawType = String(session.tipo ?? session.modality ?? "").toLowerCase();
  const modality = /gym|strength|fuerza/.test(`${rawType} ${code}`)
    ? "strength"
    : /recovery|recuper/.test(`${rawType} ${code}`) ? "recovery" : "running";
  const description = session.descripcion ?? session.title ?? code;
  return {
    id: session.id ?? session.planned_session_id ?? null,
    session_key: code || String(session.id || "master-session"),
    date: Number.isInteger(day) ? sumarDias(weekStart, day) : fecha(session.fecha ?? session.date),
    day_of_week: Number.isInteger(day) ? day : null,
    modality,
    session_type: tipoSesion(code, description, modality),
    master_session_code: code || null,
    title: String(description || code || "Sesión del plan maestro").slice(0, 120),
    duration_min: numeroONull(session.duracion_min ?? session.duration_min),
    intensity: session.intensidad ?? session.intensity ?? null,
  };
}

function normalizarSesionAceptada(session) {
  return {
    id: session.id,
    session_key: session.session_key,
    date: fecha(session.fecha ?? session.date),
    day_of_week: Number(session.day_of_week),
    modality: session.modality,
    session_type: session.session_type,
    master_session_code: session.session_code ?? session.master_session_code ?? null,
    title: session.title,
    priority: session.priority,
    duration_min: numeroONull(session.duration_min),
    intensity: session.intensity,
    prescription: session.prescription,
    objective: session.objective,
    public_reason: session.public_reason,
    change_from_master: { type: session.change_type || "unchanged", master_session_id: session.master_planned_session_id || null },
  };
}

function contextoRetrieval(context) {
  const complaints = Array.isArray(context.profile.current_complaints) ? context.profile.current_complaints : [];
  return {
    distanciaObjetivo: context.profile.distancia_objetivo || context.plan.distancia_objetivo,
    fase: context.week.fase,
    lesiones: context.injuries.map((item) => ({ zona: item.zona, recurrente: item.recurrente })),
    molestias: complaints.slice(0, 5),
    prioridad: Array.isArray(context.profile.prioridades) ? context.profile.prioridades[0] : null,
  };
}

/** Convierte filas SQL a un contrato mínimo, sin user_id ni metadatos de
 * cuenta. Este mismo objeto es el que recibe el modelo y el que se hashea para
 * trazabilidad. */
export function buildCanonicalPlannerContext(canonical, input, { now = new Date(), coachRequest = null } = {}) {
  const plan = canonical.masterPlan;
  if (!plan) throw new PlanningRequestError("No existe un plan maestro activo.", { code: "MASTER_PLAN_REQUIRED", status: 409 });
  const sourceWeek = (canonical.masterWeeks || []).find((item) => Number(item.numero_semana) === input.weekNumber);
  if (!sourceWeek) throw new PlanningRequestError("La semana solicitada no existe en el plan maestro.", { code: "MASTER_WEEK_NOT_FOUND", status: 409 });
  /* Fecha canónica de la semana: la prioriza el valor persistido (training_weeks.inicio);
     si está vacío (p.ej. plan maestro previo a la columna), se calcula desde la fecha de
     carrera contando hacia atrás. Evita depender de una migración para que el planner
     semanal siempre tenga una semana natural válida. */
  let weekStart = fecha(sourceWeek.inicio);
  if (!weekStart) {
    weekStart = fecha(calcularInicioSemana(plan?.fecha_carrera, plan?.total_semanas, sourceWeek.numero_semana));
  }
  if (!weekStart) {
    throw new PlanningRequestError("La semana todavía no tiene fecha canónica. Sincroniza el plan antes de generar una propuesta.", {
      code: "MASTER_WEEK_DATE_REQUIRED", status: 409,
    });
  }
  const storedDays = canonical.availability?.dias ?? canonical.availability?.days ?? null;
  const available = input.availabilityDays || diasDisponibles(storedDays, { required: true });
  const masterSessions = (sourceWeek.sessions || []).map((session) => normalizarSesionMaestra(session, weekStart));
  if (!masterSessions.length) {
    throw new PlanningRequestError("La semana no contiene sesiones maestras sincronizadas.", { code: "MASTER_SESSIONS_REQUIRED", status: 409 });
  }
  const acceptedSessions = (canonical.acceptedRevision?.sessions || []).map(normalizarSesionAceptada);
  const today = fecha(now);
  const profile = elegir(canonical.profile, PROFILE_FIELDS);
  const feedback = (canonical.feedback || []).map((item) => elegir(item, [
    "fecha", "rpe", "sensacion", "dolor", "zona_dolor", "tipo_dolor", "cuando_aparece", "energia", "comentario",
  ]));
  const recovery = (canonical.recovery || []).map((item) => elegir(item, [
    "fecha", "horas_sueno", "calidad_sueno", "fatiga", "agujetas", "estres", "motivacion", "dolor",
  ]));
  for (const complaint of Array.isArray(profile.current_complaints) ? profile.current_complaints : []) {
    const pain = numeroONull(complaint?.intensidad ?? complaint?.dolor ?? complaint?.pain);
    if (complaint?.activa !== false && pain !== null) feedback.unshift({
      fecha: today, dolor: pain, zona_dolor: complaint.zona ?? complaint.zone ?? null,
      tipo_dolor: complaint.tipo ?? null, cuando_aparece: complaint.cuando ?? null,
      origen: "current_complaint",
    });
  }
  if (input.pain !== null) feedback.unshift({ fecha: today, dolor: input.pain, origen: "weekly_planning_input" });
  if (input.fatigue !== null) recovery.unshift({ fecha: today, fatiga: input.fatigue, origen: "weekly_planning_input" });

  const context = {
    profile,
    plan: elegir(plan, PLAN_FIELDS),
    week: {
      id: sourceWeek.id,
      numero_semana: Number(sourceWeek.numero_semana),
      inicio: weekStart,
      start_date: weekStart,
      end_date: sumarDias(weekStart, 6),
      fase: sourceWeek.fase,
      techo_tirada_larga_min: sourceWeek.techo_tirada_larga_min,
      es_deload: sourceWeek.es_deload,
      es_taper: sourceWeek.es_taper,
      checkpoint: sourceWeek.checkpoint,
      sessions: masterSessions,
    },
    availability: { ...(canonical.availability ? elegir(canonical.availability, ["vigente_desde", "min_gym", "min_run", "min_finde"]) : {}), dias: available },
    constraints: { allowStrength: input.allowStrength, allowRunning: input.allowRunning },
    plannedSessions: acceptedSessions.length ? acceptedSessions : masterSessions,
    acceptedRevision: canonical.acceptedRevision ? {
      id: canonical.acceptedRevision.id,
      revision: canonical.acceptedRevision.revision,
      status: canonical.acceptedRevision.status,
      sessions: acceptedSessions,
    } : null,
    acceptedSessions,
    completedSessions: (canonical.completedSessions || []).map((item) => elegir(item, [
      "planned_session_id", "fecha", "tipo", "semana", "running_code", "strength_code",
      "distancia_km", "duracion_min", "ritmo", "fc_media", "fc_max", "desnivel",
      "cadencia", "rpe", "dolor", "running_notes", "running_source",
    ])),
    strengthSets: (canonical.strengthSets || []).map((item) => elegir(item, [
      "fecha", "codigo_sesion", "exercise", "orden", "peso_kg", "reps", "rir", "notas",
    ])),
    recovery,
    checkins: feedback,
    injuries: (canonical.injuries || []).map((item) => elegir(item, ["zona", "recurrente", "contexto"])),
    redFlags: Array.isArray(profile.banderas)
      ? profile.banderas.filter((flag) => flag && !/^ninguna$/i.test(String(flag).trim()))
      : [],
    now: today,
    coachRequest: coachRequest || null,
  };
  return context;
}

function resumenValidacion(validation) {
  return {
    schemaErrors: validation?.schema?.errors || [],
    schemaWarnings: validation?.schema?.warnings || [],
    hard: validation?.guardrails?.hard || [],
    soft: validation?.guardrails?.soft || [],
  };
}

function filasEvidencia(result) {
  const used = new Set([
    ...(result.output?.sessions || []).flatMap((session) => session.evidence_ids || []),
    ...(result.output?.changes_from_master_plan || []).flatMap((change) => change.evidence_ids || []),
  ].map(String));
  const queries = new Map((result.queries || []).map((query) => [query.key, query.query]));
  const rows = [];
  (result.evidence || []).forEach((chunk, index) => {
    for (const queryKey of chunk.queryKeys?.length ? chunk.queryKeys : ["weekly_distribution"]) {
      rows.push({
        chunkId: chunk.id,
        queryKey,
        queryText: queries.get(queryKey) || "consulta dinámica de planificación semanal",
        rank: index + 1,
        scores: chunk.scores || {},
        scoreType: chunk.scoreType || null,
        sentToModel: true,
        usedByModel: used.has(String(chunk.id)),
        isFill: !!(chunk._relleno || chunk.esRelleno),
      });
    }
  });
  return rows;
}

function filasGuardrails(result) {
  const rows = [{
    ruleKey: "SCHEMA_AND_HARD_GUARDRAILS",
    ruleVersion: result.rulesVersion,
    severity: "info",
    result: "pass",
    message: "El contrato JSON y los guardarraíles duros se validaron antes de persistir.",
  }];
  for (const item of result.validation?.guardrails?.soft || []) rows.push({
    ruleKey: item.code || "SOFT_GUARDRAIL",
    ruleVersion: result.rulesVersion,
    severity: "warning",
    result: "warn",
    message: item.message,
    details: { path: item.path, ...(item.details ? { details: item.details } : {}) },
  });
  return rows;
}

function sesionesPersistibles(output, context) {
  const masterById = new Map(context.week.sessions.filter((item) => item.id).map((item) => [String(item.id), item.id]));
  const masterByCode = new Map(context.week.sessions.filter((item) => item.master_session_code)
    .map((item) => [String(item.master_session_code), item.id]));
  return output.sessions.map((session, index) => {
    const explicit = session.change_from_master?.master_session_id;
    const masterPlannedSessionId = (explicit && masterById.get(String(explicit)))
      || masterByCode.get(String(session.master_session_code || "")) || null;
    return {
      masterPlannedSessionId,
      sessionKey: session.session_key,
      sessionDate: session.date,
      dayOfWeek: session.day_of_week,
      orderIndex: index,
      modality: session.modality,
      sessionType: session.session_type,
      sessionCode: session.master_session_code,
      title: session.title,
      priority: session.priority,
      durationMin: session.duration_min,
      intensity: session.intensity,
      prescription: session.prescription,
      objective: session.objective,
      publicReason: session.public_reason,
      changeType: session.change_from_master?.type,
    };
  });
}

function runRecord(result, context, diagnostics, { failed = false } = {}) {
  const inputSnapshot = {
    capturedAt: new Date().toISOString(),
    context,
  };
  return {
    status: failed ? "failed" : "completed",
    promptVersion: result.promptVersion,
    schemaVersion: WEEKLY_PLAN_SCHEMA_VERSION,
    rulesVersion: result.rulesVersion,
    provider: result.provider,
    model: result.model,
    inputSnapshot,
    // capturedAt es auditoría temporal, no parte de la identidad del input.
    // Dos contextos iguales deben producir el mismo hash aunque se ejecuten
    // en instantes distintos.
    inputHash: hashPlanningInput({ context }),
    analytics: result.analytics,
    queryPlan: result.queries,
    retrievalDiagnostics: diagnostics,
    validatedOutput: result.output,
    validationResults: resumenValidacion(result.validation),
    failure: result.status === "proposal" ? null : {
      status: result.status,
      code: result.fallback?.code || "planning_not_generated",
      details: result.fallback?.details || null,
    },
    latencyMs: result.latencyMs,
  };
}

function statusFallo(result) {
  const code = result.fallback?.code;
  return ["llm_failed", "retrieval_failed"].includes(code) ? 503 : 422;
}

function mensajeFallo(result) {
  const code = result.fallback?.code;
  if (code === "no_evidence") return "La biblioteca no contiene evidencia suficiente para justificar esta propuesta semanal.";
  if (code === "clinical_safety") return "Los datos actuales activan un límite de seguridad; no se generará entrenamiento de impacto.";
  if (code === "guardrail_failed" || code === "invalid_output") return "La propuesta de IA no superó las validaciones de seguridad y no se ha guardado.";
  return "No se ha podido generar una propuesta semanal basada en evidencia. Se mantiene el plan previamente aceptado.";
}

/** Ejecuta el flujo completo y devuelve siempre una propuesta en estado draft.
 * Ninguna rama acepta o activa la semana. */
export async function generateWeeklyPlanningProposal(profileId, rawInput, deps = {}) {
  if (!profileId) throw new PlanningRequestError("Falta el perfil activo.", { status: 409, code: "ACTIVE_PROFILE_REQUIRED" });
  const input = normalizePlanningInput(rawInput, { requireAvailability: !!deps.requireAvailability });
  const now = deps.now || new Date();
  const db = deps.db;
  const canonical = await (deps.readContext || readCanonicalPlanningContext)(profileId, {
    db,
    weekNumber: input.weekNumber,
    today: now,
    historyDays: 28,
  });
  const context = buildCanonicalPlannerContext(canonical, input, { now, coachRequest: deps.coachRequest || null });
  const retrievalDiagnostics = [];
  const evidenceRepo = deps.repo || documentsRepo;
  const citedIds = Array.isArray(deps.coachRequest?.citedChunkIds)
    ? [...new Set(deps.coachRequest.citedChunkIds.map(String))].slice(0, 8)
    : [];
  const citedRows = citedIds.length && typeof evidenceRepo.findReviewedChunkEvidence === "function"
    ? (await Promise.all(citedIds.map((id) => evidenceRepo.findReviewedChunkEvidence(id, db)))).filter(Boolean)
      .map((row) => ({
        ...row,
        id: String(row.id),
        documentId: row.document_id,
        studyType: row.study_type,
        evidenceGrade: row.evidence_grade,
        populationType: row.population_type,
        sampleSize: row.sample_size,
        paginaInicio: row.pagina_inicio,
        paginaFin: row.pagina_fin,
        scores: { coach_citation: 1 },
      }))
    : [];
  const baseRetrieve = deps.retrieve || ((query, meta) => recuperar(query, {
    db,
    repo: evidenceRepo,
    embeddingProvider: deps.embeddingProvider,
    rerankProvider: deps.rerankProvider,
    indice: deps.indice,
    config: deps.config,
    contexto: contextoRetrieval(context),
    filtros: meta.filters,
  }));
  const trackedRetrieve = async (query, meta = {}) => {
    let result = await baseRetrieve(query, meta);
    if (meta.queryKey === "coach_requested_change" && citedRows.length) {
      const chunks = Array.isArray(result) ? result : result?.chunks || [];
      const merged = [...chunks, ...citedRows.filter((row) => !chunks.some((chunk) => String(chunk.id) === row.id))];
      result = Array.isArray(result)
        ? merged
        : { ...(result || {}), hayEvidencia: true, chunks: merged };
    }
    retrievalDiagnostics.push({
      queryKey: meta.queryKey || null,
      hayEvidencia: result?.hayEvidencia ?? (Array.isArray(result) && result.length > 0),
      motivo: result?.motivo || null,
      chunks: Array.isArray(result) ? result.length : result?.chunks?.length || 0,
      diagnostico: result?.diagnostico || null,
    });
    return result;
  };
  const result = await planificarSemana(context, {
    retrieve: trackedRetrieve,
    llmProvider: deps.llmProvider,
    maxEvidence: deps.maxEvidence,
    maxPerDocument: deps.maxPerDocument,
    queryConfig: deps.queryConfig,
    guardrailConfig: deps.guardrailConfig,
    maxTokens: deps.maxTokens,
  });
  const planId = canonical.masterPlan?.id;
  const kind = deps.kind || (deps.coachRequest ? "coach_change" : "weekly_plan");
  if (result.status !== "proposal") {
    await (deps.recordRun || createPlanningRun)({
      profileId, planId, weekNumber: input.weekNumber, kind,
      run: runRecord(result, context, retrievalDiagnostics, {
        failed: ["llm_failed", "retrieval_failed"].includes(result.fallback?.code),
      }),
    }, db);
    throw new PlanningGenerationError(mensajeFallo(result), {
      code: String(result.fallback?.code || result.status || "planning_not_generated").toUpperCase(),
      status: statusFallo(result),
      fallback: result.fallback,
    });
  }

  const saved = await (deps.saveDraft || createPlanningDraft)({
    profileId,
    planId,
    weekNumber: input.weekNumber,
    kind,
    run: runRecord(result, context, retrievalDiagnostics),
    revision: {
      weekStartDate: result.output.week.start_date,
      weekEndDate: result.output.week.end_date,
      baseRevisionId: canonical.acceptedRevision?.id || null,
      summary: result.output.summary,
    },
    sessions: sesionesPersistibles(result.output, context),
    evidence: filasEvidencia(result),
    guardrails: filasGuardrails(result),
    changeProposal: deps.coachRequest?.cambio ? {
      conversationId: deps.coachRequest.conversationId || null,
      changeType: deps.coachRequest.cambio.tipo,
      sourceSessionKey: deps.coachRequest.cambio.de || null,
      targetSessionKey: deps.coachRequest.cambio.a || null,
      payload: deps.coachRequest.cambio,
      reason: deps.coachRequest.cambio.motivo || null,
      publicReason: result.output.summary.public_reason,
      evidenceState: result.output.summary.evidence_state,
      confidence: result.output.summary.confidence,
    } : null,
  }, db);
  return (deps.readProposal || getWeeklyPlanRevision)(saved.revision.id, profileId, db);
}

function citaPublica(item) {
  return {
    id: item.document_chunk_id,
    chunkId: item.document_chunk_id,
    title: item.titulo || null,
    authors: item.autores || null,
    year: item.anio || null,
    doi: item.doi || null,
    section: item.seccion || null,
    page: item.pagina_inicio || null,
    pageEnd: item.pagina_fin || null,
    text: item.texto || null,
    studyType: item.study_type || null,
    evidenceGrade: item.evidence_grade || null,
    usedByModel: !!item.used_by_model,
    scoreType: item.score_type || null,
    scores: item.scores || {},
  };
}

/** DTO propietario: expone la evidencia necesaria para "Ver evidencia", pero
 * nunca snapshots, prompts, claves de almacenamiento ni datos de otra cuenta. */
export function publicWeeklyProposal(bundle) {
  const revision = bundle?.revision || {};
  const output = revision.validated_output || {};
  const evidence = (bundle?.evidence || []).map(citaPublica);
  const proposal = {
    id: revision.id,
    status: revision.status,
    revision: revision.revision,
    revisionNumber: revision.revision,
    weekNumber: revision.week_number,
    weekStart: fecha(revision.week_start),
    weekEnd: fecha(revision.week_end),
    summary: revision.summary || output.summary?.public_reason || "Propuesta semanal basada en evidencia.",
    confidence: numeroONull(revision.confidence),
    evidenceState: revision.evidence_state || output.summary?.evidence_state || "none",
    sessions: bundle?.sessions || [],
    evidence,
    citations: evidence.filter((item) => item.usedByModel),
    guardrails: bundle?.guardrails || [],
    warnings: output.warnings || [],
    proposedAt: revision.proposed_at,
    acceptedAt: revision.accepted_at,
    rejectedAt: revision.rejected_at,
  };
  return { ok: true, proposal, sessions: proposal.sessions, evidence, guardrails: proposal.guardrails };
}
