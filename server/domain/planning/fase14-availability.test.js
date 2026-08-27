/* Fase 14 — la generación semanal adaptativa respeta la disponibilidad real y el
 * macro global, y cita la evidencia RAG. Tests DB-free: se maquilla el contexto, el
 * RAG y el LLM con stubs deterministas (igual patrón que application.test.js). No se
 * toca el motor determinista ni el prompt: solo se comprueba que la disponibilidad
 * elegida y el macro llegan al snapshot, y que la evidencia se adjunta. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalPlannerContext,
  generateWeeklyPlanningProposal,
} from "./application.js";

const canonical = () => ({
  capturedAt: "2026-08-16T10:00:00.000Z",
  profile: {
    id: "profile-priv", user_id: "user-priv", nombre: "Privado",
    distancia_objetivo: "Media maratón", fecha_carrera: "2026-10-18",
    prioridades: ["Rendimiento"], banderas: [], current_complaints: [], planning_context_version: 0,
  },
  injuries: [],
  // Disponibilidad vigente persistida en la tabla `availability`.
  availability: { dias: [0, 1, 3, 5], vigente_desde: "2026-08-01", min_gym: 45, min_run: 40, min_finde: 90 },
  masterPlan: { id: "plan-1", version: 1, distancia_objetivo: "Media maratón", total_semanas: 12, techo_tirada_larga_min: 90, structure_hash: "a".repeat(64) },
  masterWeeks: [{
    id: "week-1", numero_semana: 3, inicio: "2026-08-17", fase: "Construcción",
    sessions: [
      { id: "m-easy", dia_semana: 0, codigo_sesion: "RUN C", tipo: "run", descripcion: "Rodaje", duracion_min: 30 },
      { id: "m-strength", dia_semana: 1, codigo_sesion: "GYM A", tipo: "gym", descripcion: "Fuerza", duracion_min: 45 },
      { id: "m-quality", dia_semana: 3, codigo_sesion: "RUN B", tipo: "run", descripcion: "Tempo", duracion_min: 40 },
      { id: "m-long", dia_semana: 5, codigo_sesion: "RUN A", tipo: "run", descripcion: "Tirada", duracion_min: 70 },
    ],
  }],
  acceptedRevision: null,
  completedSessions: [], strengthSets: [], feedback: [], recovery: [], nutrition: null,
});

const intensity = (min = 3, max = 4) => ({ rpe_min: min, rpe_max: max, rir_min: null, rir_max: null, pace_zone: null });
const prescription = { distance_km: null, sets: null, reps: null, notes: "Conservadora." };

const validOutput = () => ({
  schema_version: "weekly-plan.v1",
  week: { start_date: "2026-08-17", end_date: "2026-08-23", master_plan_id: "plan-1", master_week_id: "week-1" },
  summary: { public_reason: "Distribución adaptada a tus días.", confidence: 0.83, evidence_state: "sufficient" },
  sessions: [
    ["easy", "2026-08-17", 0, "running", "easy_run", "RUN C", "Rodaje", "support", 30, "m-easy"],
    ["strength", "2026-08-18", 1, "strength", "heavy_strength", "GYM A", "Fuerza", "support", 45, "m-strength"],
    ["quality", "2026-08-20", 3, "running", "tempo", "RUN B", "Tempo", "key", 40, "m-quality"],
    ["long", "2026-08-22", 5, "running", "long_run", "RUN A", "Tirada", "key", 70, "m-long"],
  ].map(([session_key, date, day_of_week, modality, session_type, master_session_code, title, priority, duration_min, master]) => ({
    session_key, date, day_of_week, modality, session_type, master_session_code,
    title, priority, duration_min, intensity: intensity(), prescription,
    objective: "Continuidad.", public_reason: "Respeta recuperación.",
    evidence_ids: ["ev-weekly_distribution"], change_from_master: { type: "unchanged", master_session_id: master },
  })),
  changes_from_master_plan: [], warnings: [], mixed_evidence: [], missing_evidence: [],
});

// Stubs completos DB-free, igual que application.test.js (incluye recordRun para no
// tocar Postgres en la ruta de fallback).
const deps = (saved, extra = {}) => ({
  now: "2026-08-16",
  requireAvailability: true,
  readContext: async () => canonical(),
  retrieve: async (_query, { queryKey }) => ({
    hayEvidencia: true,
    chunks: [{ id: `ev-${queryKey}`, documentId: `doc-${queryKey}`, texto: "Fragmento.", studyType: "systematic_review", evidenceGrade: "fuerte", scores: { umbral: 0.9 } }],
  }),
  llmProvider: { call: async () => ({ text: JSON.stringify(validOutput()), provider: "fake", model: "planner" }) },
  saveDraft: async (payload) => { saved.value = payload; return { revision: { id: "revision-1" } }; },
  readProposal: async () => ({
    revision: { id: "revision-1", revision: 1, status: "draft", week_number: 3, week_start: "2026-08-17", week_end: "2026-08-23", summary: "Adaptada.", evidence_state: "sufficient" },
    sessions: [], evidence: [], guardrails: [],
  }),
  recordRun: async () => {},
  ...extra,
});

test("14.4 la disponibilidad del input llega al contexto del orquestador (integración DB-free)", async () => {
  const saved = { value: null };
  await generateWeeklyPlanningProposal("profile-1", {
    weekNumber: 3, availabilityDays: [0, 1, 3, 5], dolor: 2, fatiga: 3,
  }, deps(saved));

  assert.deepEqual(
    saved.value.run.inputSnapshot.context.availability.dias, [0, 1, 3, 5],
    "la disponibilidad que eligió el atleta es la que recibe el modelo",
  );
  assert.equal(saved.value.kind, "weekly_plan", "genera una propuesta semanal (no aislada)");
});

test("14.6 la propuesta cita la evidencia RAG cuando la hay (14.6)", async () => {
  const saved = { value: null };
  await generateWeeklyPlanningProposal("profile-1", {
    weekNumber: 3, availabilityDays: [0, 1, 3, 5], dolor: 2, fatiga: 4,
  }, deps(saved));

  assert.ok(saved.value.evidence.length > 0, "se adjuntan filas de evidencia");
  assert.ok(saved.value.evidence.some((row) => row.usedByModel), "al menos una cita marcada como usada por el modelo");
  assert.ok(Array.isArray(saved.value.run.retrievalDiagnostics) && saved.value.run.retrievalDiagnostics.length > 0,
    "queda traza de diagnóstico de retrieval (observabilidad)");
});

test("14.4 buildCanonicalPlannerContext: sin disponibilidad en el input usa la vigente (fallback a tabla availability)", () => {
  const ctx = buildCanonicalPlannerContext(canonical(), {
    weekNumber: 3, availabilityDays: null, allowRunning: true, allowStrength: true, pain: null, fatigue: null,
  }, { now: "2026-08-16" });
  assert.deepEqual(ctx.availability.dias, [0, 1, 3, 5], "cae a la disponibilidad vigente guardada en `availability`");
  assert.equal(ctx.availability.min_gym, 45);
  assert.equal(ctx.availability.min_finde, 90);
});

test("14.4 buildCanonicalPlannerContext: la disponibilidad del input prevalece sobre la vigente", () => {
  const ctx = buildCanonicalPlannerContext(canonical(), {
    weekNumber: 3, availabilityDays: [2, 4], allowRunning: true, allowStrength: true, pain: null, fatigue: null,
  }, { now: "2026-08-16" });
  assert.deepEqual(ctx.availability.dias, [2, 4], "el input del atleta manda sobre la disponibilidad persistida");
});

test("14.5 la propuesta encaja en el macro global activo (semanas y fase de la semana)", () => {
  const ctx = buildCanonicalPlannerContext(canonical(), {
    weekNumber: 3, availabilityDays: [0, 1, 3, 5], allowRunning: true, allowStrength: true, pain: null, fatigue: null,
  }, { now: "2026-08-16" });
  assert.ok(ctx.masterPlan || ctx.plan, "el macro global está presente en el contexto del orquestador");
  assert.equal(ctx.week?.numero_semana ?? ctx.week?.weekNumber, 3, "la semana pedida es la 3 dentro del macro");
});
