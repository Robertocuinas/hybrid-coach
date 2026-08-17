import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularAnaliticaEntrenamiento,
  construirConsultasRAG,
  evaluarGuardrailsPlan,
  parsearPlanSemanal,
  planificarSemana,
  seleccionarEvidencia,
  validarPlanSemanal,
} from "./index.js";

const WEEK_START = "2026-08-17";
const WEEK_END = "2026-08-23";

const baseSessions = [
  { id: "m-easy", session_key: "easy", fecha: "2026-08-17", tipo: "running", codigo_sesion: "RUN C", duracion_min: 30 },
  { id: "m-strength", session_key: "strength", fecha: "2026-08-18", tipo: "strength", codigo_sesion: "GYM A", duracion_min: 45 },
  { id: "m-quality", session_key: "quality", fecha: "2026-08-20", tipo: "running", codigo_sesion: "RUN B", duracion_min: 40 },
  { id: "m-long", session_key: "long", fecha: "2026-08-22", tipo: "running", codigo_sesion: "RUN A", duracion_min: 70 },
];

function context(overrides = {}) {
  return {
    profile: { distancia_objetivo: "Media maratón", prioridades: ["Rendimiento en carrera"] },
    plan: { id: "plan-1", techo_tirada_larga_min: 90 },
    week: { id: "week-1", start_date: WEEK_START, end_date: WEEK_END, fase: "Construcción", sessions: baseSessions },
    availability: [0, 1, 3, 5],
    plannedSessions: baseSessions,
    acceptedRevision: { id: "revision-1", sessions: baseSessions },
    completedSessions: [],
    strengthSets: [],
    recovery: [],
    checkins: [],
    now: "2026-08-16",
    ...overrides,
  };
}

const intensity = (rpeMin = 3, rpeMax = 4) => ({ rpe_min: rpeMin, rpe_max: rpeMax, rir_min: null, rir_max: null, pace_zone: null });
const prescription = (distance = null, notes = null) => ({ distance_km: distance, sets: null, reps: null, notes });

function outputFor(sessions = null, extra = {}) {
  const defaultSessions = [
    ["easy", "2026-08-17", 0, "running", "easy_run", "RUN C", "Rodaje fácil", "support", 30, "m-easy"],
    ["strength", "2026-08-18", 1, "strength", "strength", "GYM A", "Fuerza general", "support", 45, "m-strength"],
    ["quality", "2026-08-20", 3, "running", "intervals", "RUN B", "Intervalos controlados", "key", 40, "m-quality"],
    ["long", "2026-08-22", 5, "running", "long_run", "RUN A", "Tirada larga", "key", 70, "m-long"],
  ].map(([key, date, day, modality, type, code, title, priority, duration, master]) => ({
    session_key: key, date, day_of_week: day, modality, session_type: type,
    master_session_code: code, title, priority, duration_min: duration,
    intensity: intensity(type === "intervals" ? 6 : 3, type === "intervals" ? 7 : 4),
    prescription: prescription(null, "Prescripción conservadora."),
    objective: "Continuidad del plan maestro.", public_reason: "Mantiene el objetivo semanal.",
    evidence_ids: ["ev-weekly_distribution"], change_from_master: { type: "unchanged", master_session_id: master },
  }));
  return {
    schema_version: "weekly-plan.v1",
    week: { start_date: WEEK_START, end_date: WEEK_END, master_plan_id: "plan-1", master_week_id: "week-1" },
    summary: { public_reason: "Semana adaptada a la disponibilidad.", confidence: 0.8, evidence_state: "sufficient" },
    sessions: sessions || defaultSessions,
    changes_from_master_plan: [], warnings: [], mixed_evidence: [], missing_evidence: [],
    ...extra,
  };
}

function depsFor(output, overrides = {}) {
  let calls = 0;
  const deps = {
    retrieve: async (_query, { queryKey }) => ({ hayEvidencia: true, chunks: [{
      id: `ev-${queryKey}`, documentId: `doc-${queryKey}`, texto: `Evidence for ${queryKey}`,
      studyType: "systematic_review", evidenceGrade: "fuerte", scores: { umbral: 0.9 },
    }] }),
    llmProvider: { call: async () => { calls++; return { text: JSON.stringify(output), provider: "fake", model: "planner-test" }; } },
    ...overrides,
  };
  return { deps, calls: () => calls };
}

test("analítica calcula ventanas 7/28d, adherencia, rachas y contexto ayer/hoy/mañana", () => {
  const analytics = calcularAnaliticaEntrenamiento({
    completedSessions: [
      { id: "c1", plannedSessionId: "p1", fecha: "2026-08-13", tipo: "running", distancia_km: 8, duracion_min: 50, rpe: 5 },
      { id: "c2", fecha: "2026-08-14", tipo: "strength", duracion_min: 45, rpe: 6 },
      { id: "c3", fecha: "2026-07-25", tipo: "running", distancia_km: 10, duracion_min: 60, rpe: 4 },
    ],
    plannedSessions: [
      { id: "p1", fecha: "2026-08-13", tipo: "running", codigo_sesion: "RUN C" },
      { id: "p2", fecha: "2026-08-15", tipo: "running", codigo_sesion: "RUN B" },
      { id: "p3", fecha: "2026-08-17", tipo: "running", codigo_sesion: "RUN A" },
    ],
    recovery: [{ fecha: "2026-08-15", fatiga: 8, horas_sueno: 5.5 }],
    strengthSets: [
      { fecha: "2026-08-14", exercise: "Sentadilla", peso_kg: 80, reps: 5, rir: 2 },
      { fecha: "2026-07-20", exercise: "Sentadilla", peso_kg: 70, reps: 5, rir: 3 },
    ],
  }, { hoy: "2026-08-16" });
  assert.equal(analytics.ventana7d.km, 8);
  assert.equal(analytics.ventana28d.km, 18);
  assert.equal(analytics.adherencia.ratio, 0.5);
  assert.equal(analytics.adherencia.perdidas[0].id, "p2");
  assert.equal(analytics.rachas.maxima28d, 2);
  assert.equal(analytics.temporal.manana.planificadas[0].id, "p3");
  assert.equal(analytics.progresoFuerza.volumenKg7d, 400);
  assert.equal(analytics.progresoFuerza.ultimasPorEjercicio.Sentadilla.rir, 2);
});

test("escenario 1: cuatro días disponibles producen una propuesta válida y no aplicada", async () => {
  const entrada = context();
  const snapshot = JSON.stringify(entrada);
  const { deps, calls } = depsFor(outputFor());
  const result = await planificarSemana(entrada, deps);
  assert.equal(result.status, "proposal");
  assert.equal(result.output.sessions.length, 4);
  assert.equal(result.validation.guardrails.valid, true);
  assert.equal(calls(), 1);
  assert.equal(JSON.stringify(entrada), snapshot, "el dominio no debe mutar ni aceptar el plan");
});

test("escenario 2: tres días disponibles validan una semana reducida", async () => {
  const three = outputFor().sessions.filter((s) => ["strength", "quality", "long"].includes(s.session_key));
  const propuesta = outputFor(three, { changes_from_master_plan: [{
    type: "removed", session_key: "easy", before: { date: "2026-08-17" }, after: null,
    reason: "Se priorizan las sesiones clave.", evidence_ids: ["ev-weekly_distribution"],
  }] });
  const { deps } = depsFor(propuesta);
  const result = await planificarSemana(context({ availability: [1, 3, 5] }), deps);
  assert.equal(result.status, "proposal");
  assert.deepEqual(result.output.sessions.map((s) => s.day_of_week), [1, 3, 5]);
});

test("escenario 3: fatiga alta construye consulta específica de recuperación", () => {
  const analytics = calcularAnaliticaEntrenamiento({ recovery: [{ fecha: "2026-08-16", fatiga: 9, horas_sueno: 5 }] }, { hoy: "2026-08-16" });
  const queries = construirConsultasRAG({ ...context(), masterWeek: context().week }, analytics);
  assert.ok(queries.some((q) => q.key === "recovery_load"));
  assert.ok(queries.some((q) => q.key === "weekly_distribution"));
  assert.ok(queries.length <= 5);
});

test("escenario 4: dolor >=5 bloquea una propuesta con carrera", () => {
  const proposal = outputFor();
  const analytics = calcularAnaliticaEntrenamiento({ checkins: [{ fecha: "2026-08-16", dolor: 6 }] }, { hoy: "2026-08-16" });
  const result = evaluarGuardrailsPlan(proposal, context({ checkins: [{ fecha: "2026-08-16", dolor: 6 }] }), analytics);
  assert.equal(result.valid, false);
  assert.ok(result.hard.some((x) => x.code === "PAIN_HIGH_IMPACT"));
});

test("las modalidades desactivadas por el atleta son un guardrail duro", () => {
  const proposal = outputFor();
  const noRunning = evaluarGuardrailsPlan(proposal, context({ constraints: { allowRunning: false, allowStrength: true } }), {});
  const noStrength = evaluarGuardrailsPlan(proposal, context({ constraints: { allowRunning: true, allowStrength: false } }), {});
  assert.ok(noRunning.hard.some((item) => item.code === "RUNNING_NOT_SELECTED"));
  assert.ok(noStrength.hard.some((item) => item.code === "STRENGTH_NOT_SELECTED"));
});

test("dolor en reposo con la forma real de feedback activa fallback antes de retrieval o LLM", async () => {
  let retrievals = 0, calls = 0;
  const result = await planificarSemana(context({ checkins: [{ fecha: "2026-08-16", dolor: 4, cuando_aparece: "También en reposo" }] }), {
    retrieve: async () => { retrievals++; return []; },
    llmProvider: async () => { calls++; return "{}"; },
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.fallback.code, "clinical_safety");
  assert.equal(retrievals, 0);
  assert.equal(calls, 0);
});

test("escenario 5: una sesión perdida no se recupera añadiendo o doblando carga", () => {
  const analytics = { adherencia: { ratio: 0.5, perdidas: [{ id: "lost" }] }, seguridad: { dolorMaximo: 0, redFlags: [] } };
  const extra = { ...outputFor().sessions[0], session_key: "catch-up", date: "2026-08-17", change_from_master: { type: "added", master_session_id: null }, public_reason: "Recuperar la sesión perdida" };
  const proposal = outputFor([...outputFor().sessions, extra]);
  const result = evaluarGuardrailsPlan(proposal, context(), analytics);
  assert.ok(result.hard.some((x) => x.code === "NO_CATCH_UP"));
});

test("escenario 6: una petición originada en Coach solo devuelve propuesta", async () => {
  const entrada = context({ kind: "coach_change", request: "mover la sesión" });
  const before = structuredClone(entrada.acceptedRevision);
  const { deps } = depsFor(outputFor());
  const result = await planificarSemana(entrada, deps);
  assert.equal(result.status, "proposal");
  assert.deepEqual(entrada.acceptedRevision, before);
  assert.equal(Object.hasOwn(result, "accepted"), false);
});

test("escenario 7: RAG sin resultados no llama al LLM ni inventa semana", async () => {
  let calls = 0;
  const result = await planificarSemana(context(), {
    retrieve: async () => ({ hayEvidencia: false, chunks: [] }),
    llmProvider: async () => { calls++; return "{}"; },
  });
  assert.equal(result.status, "no_evidence");
  assert.equal(result.output, null);
  assert.equal(result.fallback.retainedSource, "accepted_revision");
  assert.equal(calls, 0);
});

test("escenario 8: evidencia contradictoria se conserva estructurada con elección conservadora", async () => {
  const mixed = outputFor(null, {
    summary: { public_reason: "La evidencia es mixta; se elige la opción conservadora.", confidence: 0.55, evidence_state: "mixed" },
    mixed_evidence: [{ topic: "Separación concurrente", positions: [
      { summary: "Posición A", evidence_ids: ["ev-weekly_distribution"] },
      { summary: "Posición B", evidence_ids: ["ev-conflict"] },
    ], conservative_choice: "Mantener más separación y menor carga." }],
  });
  const { deps } = depsFor(mixed, {
    retrieve: async (_q, { queryKey }) => ({ hayEvidencia: true, chunks: [
      { id: `ev-${queryKey}`, documentId: `doc-${queryKey}`, texto: "A", studyType: "systematic_review", evidenceGrade: "fuerte" },
      { id: "ev-conflict", documentId: "doc-conflict", texto: "B", studyType: "rct", evidenceGrade: "moderada" },
    ] }),
  });
  const result = await planificarSemana(context(), deps);
  assert.equal(result.status, "proposal");
  assert.equal(result.output.summary.evidence_state, "mixed");
  assert.equal(result.output.mixed_evidence[0].positions.length, 2);
});

test("escenario 9: fallo del LLM conserva el plan aceptado", async () => {
  const result = await planificarSemana(context(), {
    retrieve: async (_q, { queryKey }) => ({ chunks: [{ id: `ev-${queryKey}`, documentId: `doc-${queryKey}`, texto: "Evidence", studyType: "rct" }] }),
    llmProvider: async () => { throw new Error("timeout"); },
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.fallback.code, "llm_failed");
  assert.equal(result.fallback.retainedPlan.id, "revision-1");
});

test("escenario 10: rechazar queda fuera del dominio y la revisión aceptada permanece intacta", async () => {
  const entrada = context();
  const referencia = entrada.acceptedRevision;
  const { deps } = depsFor(outputFor());
  const result = await planificarSemana(entrada, deps);
  assert.equal(result.status, "proposal");
  assert.strictEqual(entrada.acceptedRevision, referencia);
  assert.equal(entrada.acceptedRevision.id, "revision-1");
});

test("schema rechaza propiedades libres, fechas no disponibles y citas no entregadas", () => {
  const proposal = outputFor();
  proposal.sessions[0].evidence_ids = ["inventada"];
  proposal.sessions[0].extra = "orden oculta";
  const parsed = parsearPlanSemanal(`\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\``);
  assert.equal(parsed.ok, true);
  const validated = validarPlanSemanal(parsed.value, { evidenceIds: ["ev-weekly_distribution"], availabilityDays: [1, 3, 5], weekStart: WEEK_START, weekEnd: WEEK_END });
  assert.equal(validated.ok, false);
  assert.ok(validated.errors.some((e) => e.code === "UNKNOWN_PROPERTY"));
  assert.ok(validated.errors.some((e) => e.code === "UNKNOWN_EVIDENCE"));
  assert.ok(validated.errors.some((e) => e.code === "UNAVAILABLE"));
});

test("una respuesta inválida usa exactamente una reparación y luego queda invalid", async () => {
  let calls = 0;
  const result = await planificarSemana(context(), {
    retrieve: async (_q, { queryKey }) => ({ chunks: [{ id: `ev-${queryKey}`, documentId: `doc-${queryKey}`, texto: "Evidence", studyType: "rct" }] }),
    llmProvider: async () => { calls++; return { text: "{no-json" }; },
  });
  assert.equal(result.status, "invalid");
  assert.equal(result.modelCalls, 2);
  assert.equal(calls, 2);
});

test("una única reparación puede convertir JSON inválido en propuesta válida", async () => {
  let calls = 0;
  const valid = outputFor();
  const result = await planificarSemana(context(), {
    retrieve: async (_q, { queryKey }) => ({ chunks: [{ id: `ev-${queryKey}`, documentId: `doc-${queryKey}`, texto: "Evidence", studyType: "rct" }] }),
    llmProvider: async () => ({ text: ++calls === 1 ? "{roto" : JSON.stringify(valid), provider: "fake", model: "repair" }),
  });
  assert.equal(result.status, "proposal");
  assert.equal(result.modelCalls, 2);
  assert.equal(calls, 2);
});

test("selección de evidencia deduplica, prioriza jerarquía y limita diversidad por documento", () => {
  const query = { key: "base", required: true };
  const selection = seleccionarEvidencia([{ consulta: query, chunks: [
    { id: "rct", documentId: "doc-1", studyType: "rct", evidenceGrade: "fuerte" },
    { id: "meta", documentId: "doc-2", studyType: "meta_analysis", evidenceGrade: "moderada" },
    { id: "meta", documentId: "doc-2", studyType: "meta_analysis", evidenceGrade: "moderada" },
    { id: "narrative", documentId: "doc-2", studyType: "narrative_review", evidenceGrade: "debil" },
  ] }], { maxEvidence: 3, maxPerDocument: 1 });
  assert.equal(selection.chunks[0].id, "meta");
  assert.deepEqual(selection.chunks.map((x) => x.id), ["meta", "rct"]);
  assert.equal(selection.complete, true);
});

test("adherence links accepted sessions to their master FK and does not lose today's session", () => {
  const analytics = calcularAnaliticaEntrenamiento({
    plannedSessions: [
      { id: "weekly-1", master_planned_session_id: "master-1", fecha: "2026-08-14", tipo: "running", codigo_sesion: "RUN C" },
      { id: "weekly-2", master_planned_session_id: "master-2", fecha: "2026-08-16", tipo: "running", codigo_sesion: "RUN A" },
    ],
    completedSessions: [
      { id: "done-1", planned_session_id: "master-1", fecha: "2026-08-14", tipo: "running", codigo_sesion: "RUN C", duracion_min: 30 },
    ],
  }, { hoy: "2026-08-16" });
  assert.equal(analytics.adherencia.planificadasVencidas, 1);
  assert.equal(analytics.adherencia.completadas, 1);
  assert.equal(analytics.adherencia.ratio, 1);
  assert.equal(analytics.adherencia.perdidas.length, 0);
});

test("schema rejects incompatible modality, empty weeks and duplicate agenda codes", () => {
  const incompatible = outputFor();
  incompatible.sessions[0].modality = "strength";
  incompatible.sessions[0].session_type = "race";
  const invalidPair = validarPlanSemanal(incompatible, {
    evidenceIds: ["ev-weekly_distribution"], availabilityDays: [0, 1, 3, 5],
    weekStart: WEEK_START, weekEnd: WEEK_END,
  });
  assert.ok(invalidPair.errors.some((item) => item.code === "MODALITY_MISMATCH"));

  const empty = validarPlanSemanal(outputFor([]), {
    evidenceIds: ["ev-weekly_distribution"], availabilityDays: [0, 1, 3, 5],
    weekStart: WEEK_START, weekEnd: WEEK_END,
  });
  assert.ok(empty.errors.some((item) => item.path === "$.sessions" && item.code === "RANGE"));

  const duplicate = outputFor();
  duplicate.sessions[1].master_session_code = "RUN C";
  const invalidDuplicate = validarPlanSemanal(duplicate, {
    evidenceIds: ["ev-weekly_distribution"], availabilityDays: [0, 1, 3, 5],
    weekStart: WEEK_START, weekEnd: WEEK_END,
  });
  assert.ok(invalidDuplicate.errors.some((item) => item.code === "DUPLICATE_AGENDA_CODE"));
});

test("guardrails derive the real diff and reject a misleading unchanged label", () => {
  const proposal = outputFor();
  proposal.sessions[0].date = "2026-08-18";
  proposal.sessions[0].day_of_week = 1;
  proposal.sessions[0].change_from_master.type = "unchanged";
  const result = evaluarGuardrailsPlan(proposal, context(), {});
  assert.ok(result.hard.some((item) => item.code === "SESSION_CHANGE_MISMATCH"));
  assert.ok(result.hard.some((item) => item.code === "MISSING_OR_INCORRECT_CHANGE"));
});

test("running load uses the conservative history and limits distance too", () => {
  const proposal = outputFor();
  proposal.sessions.filter((s) => s.modality === "running").forEach((s) => { s.prescription.distance_km = 40; });
  const result = evaluarGuardrailsPlan(proposal, context(), {
    comparativaAnterior7d: { minutosCarrera: 30, km: 5 },
    seguridad: { dolorMaximo: 0, redFlags: [] },
  });
  assert.ok(result.hard.some((item) => item.code === "WEEKLY_PROGRESSION_LIMIT"));
  assert.ok(result.hard.some((item) => item.code === "WEEKLY_DISTANCE_PROGRESSION_LIMIT"));
  assert.ok(result.hard.some((item) => item.code === "IMPLAUSIBLE_RUNNING_DISTANCE"));
});

test("a completed accepted session is immutable when its FK points to the master session", () => {
  const accepted = outputFor().sessions.map((s, index) => ({
    ...s, id: `weekly-${index}`, master_planned_session_id: s.change_from_master.master_session_id,
  }));
  const changed = structuredClone(outputFor());
  changed.sessions[0].date = "2026-08-18";
  changed.sessions[0].day_of_week = 1;
  changed.sessions[0].change_from_master.type = "moved";
  changed.changes_from_master_plan = [{
    type: "moved", session_key: "easy", before: { date: "2026-08-17" }, after: { date: "2026-08-18" },
    reason: "Move", evidence_ids: ["ev-weekly_distribution"],
  }];
  const result = evaluarGuardrailsPlan(changed, context({
    acceptedRevision: { id: "revision-1", sessions: accepted },
    completedSessions: [{ planned_session_id: "m-easy", fecha: "2026-08-17", tipo: "running", codigo_sesion: "RUN C", duracion_min: 30 }],
  }), {});
  assert.ok(result.hard.some((item) => item.code === "COMPLETED_IMMUTABLE"));
});

test("mid-week replanning keeps completed days even when availability only lists future days", () => {
  const proposal = outputFor();
  const result = evaluarGuardrailsPlan(proposal, context({
    now: "2026-08-19",
    availability: [3, 5],
    completedSessions: [{ planned_session_id: "m-easy", fecha: "2026-08-17", tipo: "running", codigo_sesion: "RUN C", duracion_min: 30 }],
  }), { calculadaEn: "2026-08-19", seguridad: { dolorMaximo: 0, redFlags: [] } });
  assert.equal(result.hard.some((item) => item.code === "UNAVAILABLE_DAY" && item.path === "$.sessions[0].date"), false);
});

/* Los cinco runs fallidos de producción (2026-08-17, gpt-4.1-mini) fallaron
   SIEMPRE por lo mismo, nunca por azar del modelo: el contrato de salida no
   describía `week`, no decía que aquí la semana empieza en lunes y no decía que
   before/after son objetos. El modelo rellenaba esos huecos copiando la semana
   maestra de la entrada —que viajaba bajo la misma clave `week`— y numerando
   los días como JavaScript.

   Este test comprueba que el prompt entrega resuelto todo lo que el validador
   va a exigir. Si alguien vuelve a dejar que el modelo lo deduzca, falla aquí y
   no en producción tras 50 segundos y dos llamadas al modelo. */
test("el prompt entrega resueltos week y el calendario que exige el validador", async () => {
  const { construirPromptPlanificador } = await import("./prompt.js");
  const { diaDeFecha } = await import("./schema.js");
  const contexto = {
    plan: { id: "plan-1" },
    week: { id: "week-9", numero_semana: 2, inicio: "2026-08-17", fase: "Base", es_deload: false },
    profile: { nombre: "A" },
  };
  const prompt = construirPromptPlanificador({
    contexto, analytics: {}, queries: [], evidence: [],
    semana: { start: "2026-08-17", end: "2026-08-23" },
    disponibilidad: [0, 2, 4],
  });
  const texto = prompt.messages[0].content;
  const bloque = JSON.parse(texto.split("WEEK_OBLIGATORIA (cópiala literalmente como campo `week` de tu respuesta)\n")[1].split("\n\n")[0]);
  const calendario = JSON.parse(texto.split("CALENDARIO_DE_LA_SEMANA (day_of_week ya resuelto; solo puedes usar las fechas disponibles)\n")[1].split("\n\n")[0]);

  assert.deepEqual(Object.keys(bloque).sort(), ["end_date", "master_plan_id", "master_week_id", "start_date"],
    "exactamente las claves que exige el schema, ni una más");
  assert.equal(bloque.master_plan_id, "plan-1");
  assert.equal(bloque.master_week_id, "week-9");

  assert.equal(calendario.length, 7);
  assert.equal(calendario[0].day_of_week, 0, "2026-08-17 es lunes y aquí lunes es 0");
  for (const dia of calendario) {
    assert.equal(dia.day_of_week, diaDeFecha(dia.date), "el calendario usa la misma conversión que el validador");
  }
  assert.deepEqual(calendario.filter((d) => d.disponible).map((d) => d.day_of_week), [0, 2, 4]);

  /* La semana maestra sigue viajando, pero bajo otra clave: es la colisión de
     nombres lo que hacía que el modelo copiara la forma equivocada. */
  assert.ok(texto.includes('"master_week"'), "la semana maestra se entrega como master_week");
  assert.ok(!/"week":\s*\{\s*"id"/.test(texto), "y nunca como `week` con la forma de la tabla");
});
