/* Capa de aplicación del plan maestro IA+RAG.

   Une el retrieval RAG, el orquestador puro (masterPlan.js) y la persistencia
   auditable (trainingPlans.js). Las rutas HTTP solo validan auth y traducen
   errores; ninguna decisión de entrenamiento vive en Express. */
import * as documentsRepo from "../../db/repositories/documents.js";
import { saveMasterPlan } from "../../db/repositories/trainingPlans.js";
import { recuperar } from "../../rag/retrieval.js";
import { generarPlanMaestro } from "./masterPlan.js";
import { createHash } from "node:crypto";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class MasterPlanRequestError extends Error {
  constructor(message, { code = "INVALID_MASTER_PLAN_REQUEST", status = 400, details = null } = {}) {
    super(message);
    this.name = "MasterPlanRequestError";
    this.code = code;
    this.status = status;
    this.statusCode = status;
    this.details = details;
  }
}

function fecha(value) {
  if (!value) return null;
  if (typeof value === "string" && FECHA.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function hashEstructura(plan) {
  // Hash estable de la estructura para detectar cambios y versionar.
  return createHash("sha256").update(JSON.stringify({
    total: plan.total_semanas, mezcla: plan.mezcla, techo: plan.techo_tirada_larga_min,
    semanas: (plan.semanas || []).map((s) => ({ n: s.numero, f: s.fase, d: s.deload, t: s.taper,
      s: (s.sesiones || []).map((x) => [x.codigo, x.tipo, x.duracion_min]) })),
  })).digest("hex");
}

function contextoRetrieval(context) {
  const p = context.profile || {};
  return {
    distanciaObjetivo: p.distancia_objetivo || p.distancia,
    prioridad: Array.isArray(p.prioridades) ? p.prioridades[0] : null,
    lesiones: (p.lesiones || []).map((l) => ({ zona: l.zona, recurrente: l.recurrente })),
    molestias: (p.molestias || p.current_complaints || []).slice(0, 5),
  };
}

/** Genera y persiste un plan maestro nuevo a partir del perfil activo. */
export async function generateMasterPlanProposal(profileId, rawInput, deps = {}) {
  if (!profileId) throw new MasterPlanRequestError("Falta el perfil activo.", { status: 409, code: "ACTIVE_PROFILE_REQUIRED" });
  const input = rawInput && typeof rawInput === "object" ? rawInput : {};
  const now = deps.now || new Date();
  const db = deps.db;

  // El perfil viene del repositorio de perfiles, no del input del usuario.
  const profile = deps.profile || input.profile;
  if (!profile) throw new MasterPlanRequestError("Perfil no disponible para generar el plan.", { status: 409, code: "PROFILE_REQUIRED" });

  const contexto = { profile, now: fecha(now) };
  const evidenceRepo = deps.repo || documentsRepo;
  const trackedRetrieve = deps.retrieve || ((query, meta) => recuperar(query, {
    db, repo: evidenceRepo,
    embeddingProvider: deps.embeddingProvider,
    rerankProvider: deps.rerankProvider,
    indice: deps.indice,
    config: deps.config,
    contexto: contextoRetrieval(contexto),
    filtros: meta.filters,
  }));

  const result = await generarPlanMaestro(contexto, {
    retrieve: trackedRetrieve,
    llmProvider: deps.llmProvider,
    maxEvidence: deps.maxEvidence,
    queryConfig: deps.queryConfig,
    maxTokens: deps.maxTokens,
  });

  if (result.status !== "proposal" || !result.output) {
    const code = String(result.fallback?.code || result.status || "master_not_generated").toUpperCase();
    const status = ["llm_failed", "retrieval_failed", "no_evidence"].includes(result.fallback?.code) ? 503 : 422;
    // DIAGNÓSTICO TEMPORAL (auditoría): registrar por qué no se generó el plan.
    console.error("[master-plan] NO PROPUESTA:", code, "fallback:", JSON.stringify(result.fallback || null).slice(0, 800),
      "evidence:", (result.evidence || []).length, "validation:", JSON.stringify(result.validation?.errors || null).slice(0, 800),
      "guardrails:", JSON.stringify(result.validation?.guardrails?.hard || null).slice(0, 600));
    const mensaje = result.fallback?.message
      || "No se ha podido generar un plan maestro basado en evidencia. Se mantiene el plan previo si existía.";
    const err = new MasterPlanRequestError(mensaje, { code, status });
    err.fallback = result.fallback;
    throw err;
  }

  const hash = hashEstructura(result.output);
  const saved = await (deps.savePlan || saveMasterPlan)(profileId, result.output, { estructuraHash: hash }, db);
  const { rows: weeks } = await client_query(db,
    `SELECT tw.id, tw.numero_semana, tw.fase, tw.es_deload, tw.es_taper, tw.checkpoint,
            COALESCE(json_agg(json_build_object(
              'codigo', ps.codigo_sesion, 'tipo', ps.tipo, 'titulo', ps.descripcion,
              'duracion_min', ps.duracion_min) ORDER BY ps.codigo_sesion) FILTER (WHERE ps.id IS NOT NULL), '[]') AS sesiones
       FROM training_weeks tw
       LEFT JOIN planned_sessions ps ON ps.training_week_id = tw.id
      WHERE tw.training_plan_id = $1
      GROUP BY tw.id, tw.numero_semana, tw.fase, tw.es_deload, tw.es_taper, tw.checkpoint
      ORDER BY tw.numero_semana;`,
    [saved.id]
  );
  return { ok: true, plan: saved, weeks, evidence: result.evidence, evidenceState: result.output.evidence_state };
}

async function client_query(db, sql, params) {
  const client = typeof db.query === "function" ? db : await db;
  return client.query(sql, params);
}

export const generateMasterPlan = generateMasterPlanProposal;

/** Lee el plan maestro activo con sus semanas y sesiones maestras. */
export async function getActiveMasterPlan(profileId, deps = {}) {
  if (!profileId) throw new MasterPlanRequestError("Falta el perfil activo.", { status: 409, code: "ACTIVE_PROFILE_REQUIRED" });
  const db = deps.db;
  const { rows: planes } = await db.query(
    `SELECT * FROM training_plans WHERE athlete_profile_id = $1 AND activo = true ORDER BY generado_en DESC LIMIT 1;`,
    [profileId]
  );
  if (!planes[0]) return null;
  const plan = planes[0];
  const { rows: weeks } = await db.query(
    `SELECT tw.id, tw.numero_semana, tw.fase, tw.es_deload, tw.es_taper, tw.checkpoint,
            COALESCE(json_agg(json_build_object(
              'codigo', ps.codigo_sesion, 'tipo', ps.tipo, 'titulo', ps.descripcion,
              'duracion_min', ps.duracion_min) ORDER BY ps.codigo_sesion) FILTER (WHERE ps.id IS NOT NULL), '[]') AS sesiones
       FROM training_weeks tw
       LEFT JOIN planned_sessions ps ON ps.training_week_id = tw.id
      WHERE tw.training_plan_id = $1
      GROUP BY tw.id, tw.numero_semana, tw.fase, tw.es_deload, tw.es_taper, tw.checkpoint
      ORDER BY tw.numero_semana;`,
    [plan.id]
  );
  return { ok: true, plan, weeks };
}

export const getMasterPlan = getActiveMasterPlan;
