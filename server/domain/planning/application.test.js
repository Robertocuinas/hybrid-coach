import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalPlannerContext,
  generateWeeklyPlanningProposal,
  PlanningGenerationError,
  publicWeeklyProposal,
} from "./application.js";

const canonical = () => ({
  capturedAt: "2026-08-16T10:00:00.000Z",
  profile: {
    id: "profile-private", user_id: "user-private", nombre: "Nombre privado",
    distancia_objetivo: "Media maratón", fecha_carrera: "2026-10-18",
    prioridades: ["Rendimiento"], banderas: [], current_complaints: [],
  },
  injuries: [],
  availability: { dias: [0, 1, 3, 5], vigente_desde: "2026-08-01", min_gym: 45, min_run: 40, min_finde: 90 },
  masterPlan: { id: "plan-1", version: 1, distancia_objetivo: "Media maratón", total_semanas: 12, techo_tirada_larga_min: 90 },
  masterWeeks: [{
    id: "week-1", numero_semana: 3, inicio: "2026-08-17", fase: "Construcción",
    sessions: [
      { id: "m-easy", dia_semana: 0, codigo_sesion: "RUN C", tipo: "run", descripcion: "Rodaje fácil", duracion_min: 30 },
      { id: "m-strength", dia_semana: 1, codigo_sesion: "GYM A", tipo: "gym", descripcion: "Fuerza pesada", duracion_min: 45 },
      { id: "m-quality", dia_semana: 3, codigo_sesion: "RUN B", tipo: "run", descripcion: "Tempo controlado", duracion_min: 40 },
      { id: "m-long", dia_semana: 5, codigo_sesion: "RUN A", tipo: "run", descripcion: "Tirada larga", duracion_min: 70 },
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
  summary: { public_reason: "Distribución adaptada y separada.", confidence: 0.83, evidence_state: "sufficient" },
  sessions: [
    ["easy", "2026-08-17", 0, "running", "easy_run", "RUN C", "Rodaje fácil", "support", 30, "m-easy"],
    ["strength", "2026-08-18", 1, "strength", "heavy_strength", "GYM A", "Fuerza pesada", "support", 45, "m-strength"],
    ["quality", "2026-08-20", 3, "running", "tempo", "RUN B", "Tempo", "key", 40, "m-quality"],
    ["long", "2026-08-22", 5, "running", "long_run", "RUN A", "Tirada larga", "key", 70, "m-long"],
  ].map(([session_key, date, day_of_week, modality, session_type, master_session_code, title, priority, duration_min, master]) => ({
    session_key, date, day_of_week, modality, session_type, master_session_code,
    title, priority, duration_min, intensity: intensity(), prescription,
    objective: "Continuidad.", public_reason: "Respeta plan y recuperación.",
    evidence_ids: ["ev-weekly_distribution"],
    change_from_master: { type: "unchanged", master_session_id: master },
  })),
  changes_from_master_plan: [], warnings: [], mixed_evidence: [], missing_evidence: [],
});

test("la aplicación carga datos reales, llama RAG antes del LLM y guarda solo un draft", async () => {
  let saved = null;
  let recordCalled = false;
  const bundle = await generateWeeklyPlanningProposal("profile-1", {
    weekNumber: 3, availabilityDays: [0, 1, 3, 5], dolor: 2, fatiga: 4,
  }, {
    now: "2026-08-16",
    requireAvailability: true,
    readContext: async () => canonical(),
    retrieve: async (_query, { queryKey }) => ({ hayEvidencia: true, chunks: [{
      id: `ev-${queryKey}`, documentId: `doc-${queryKey}`, texto: "Fragmento real.",
      studyType: "systematic_review", evidenceGrade: "fuerte", scores: { umbral: 0.9 },
    }] }),
    llmProvider: { call: async () => ({ text: JSON.stringify(validOutput()), provider: "fake", model: "planner" }) },
    saveDraft: async (payload) => { saved = payload; return { revision: { id: "revision-1" } }; },
    readProposal: async () => ({
      revision: { id: "revision-1", revision: 1, status: "draft", week_number: 3, week_start: "2026-08-17", week_end: "2026-08-23", summary: "Distribución adaptada.", evidence_state: "sufficient" },
      sessions: [], evidence: [], guardrails: [],
    }),
    recordRun: async () => { recordCalled = true; },
  });

  assert.equal(bundle.revision.status, "draft");
  assert.equal(recordCalled, false);
  assert.equal(saved.kind, "weekly_plan");
  assert.equal(saved.sessions.length, 4);
  assert.equal(saved.run.status, "completed");
  assert.equal(saved.run.validatedOutput.schema_version, "weekly-plan.v1");
  assert.equal(saved.run.inputSnapshot.context.profile.user_id, undefined, "el id de cuenta no entra al prompt ni al snapshot");
  assert.equal(saved.run.inputSnapshot.context.profile.nombre, undefined, "el nombre no es necesario para decidir la semana");
  assert.equal(saved.run.inputSnapshot.context.checkins[0].dolor, 2);
  assert.equal(saved.run.inputSnapshot.context.recovery[0].fatiga, 4);
  assert.ok(saved.evidence.some((row) => row.usedByModel));
  assert.ok(saved.guardrails.some((row) => row.result === "pass"));
});

test("sin evidencia registra el intento y no crea una revisión inventada", async () => {
  let failedRun = null;
  let saved = false;
  await assert.rejects(() => generateWeeklyPlanningProposal("profile-1", {
    weekNumber: 3, availabilityDays: [0, 1, 3],
  }, {
    now: "2026-08-16", requireAvailability: true,
    readContext: async () => canonical(),
    retrieve: async () => ({ hayEvidencia: false, chunks: [], motivo: "sin resultados" }),
    llmProvider: { call: async () => { throw new Error("no debe llamarse"); } },
    recordRun: async (payload) => { failedRun = payload; },
    saveDraft: async () => { saved = true; },
  }), (error) => error instanceof PlanningGenerationError && error.code === "NO_EVIDENCE");
  assert.equal(saved, false);
  assert.equal(failedRun.run.status, "completed");
  assert.equal(failedRun.run.failure.code, "no_evidence");
  assert.equal(failedRun.kind, "weekly_plan");
});

test("el Coach viaja como petición no confiable y el DTO solo expone evidencia citable", () => {
  const context = buildCanonicalPlannerContext(canonical(), {
    weekNumber: 3, availabilityDays: null, allowRunning: true, allowStrength: true, pain: null, fatigue: null,
  }, { now: "2026-08-16", coachRequest: { cambio: { tipo: "mover", dia: "jueves" } } });
  assert.equal(context.coachRequest.cambio.tipo, "mover");
  assert.deepEqual(context.availability.dias, [0, 1, 3, 5]);

  const dto = publicWeeklyProposal({
    revision: { id: "revision-1", revision: 2, status: "draft", week_number: 3, week_start: "2026-08-17", week_end: "2026-08-23", summary: "Motivo breve", evidence_state: "limited", confidence: "0.6", validated_output: { warnings: [{ code: "LIMITED", severity: "warning", message: "Evidencia limitada", action: null }] } },
    sessions: [{ session_key: "easy", fecha: "2026-08-17" }],
    evidence: [{ document_chunk_id: "chunk-1", titulo: "Paper", autores: "Autora", anio: 2024, texto: "Fragmento", pagina_inicio: 8, used_by_model: true }],
    guardrails: [],
  });
  assert.equal(dto.proposal.revisionNumber, 2);
  assert.equal(dto.proposal.citations[0].page, 8);
  assert.equal(dto.proposal.citations[0].text, "Fragmento");
  assert.equal(Object.hasOwn(dto.proposal, "validated_output"), false);
});

