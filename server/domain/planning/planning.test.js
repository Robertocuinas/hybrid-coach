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

/* Segunda tanda de runs fallidos (weekly-planner.2): los schemaErrors ya eran
   cero, pero caían los guardarraíles con MAX_STREAK, HEAVY_BEFORE_LONG_RUN,
   SESSION_WITHOUT_EVIDENCE y SESSION_CHANGE_MISMATCH.

   La causa era la misma clase de omisión: el prompt decía "los guardarraíles los
   ejecuta código, no los discutas" sin decir CUÁLES son. Con L-M-X-J disponibles
   —cuatro días seguidos— y un tope de tres consecutivos, el modelo no podía
   saber que tenía que dejar uno sin sesión. */
test("el prompt anuncia los límites que después se validan, sin poder divergir", async () => {
  const { construirPromptPlanificador } = await import("./prompt.js");
  const { DEFAULT_GUARDRAIL_CONFIG } = await import("./guardrails.js");
  const prompt = construirPromptPlanificador({
    contexto: { plan: { id: "p" }, week: { id: "w" }, profile: {} },
    analytics: {}, queries: [], evidence: [],
    semana: { start: "2026-08-17", end: "2026-08-23" },
    disponibilidad: [0, 1, 2, 3],
  });
  const texto = prompt.messages[0].content;
  const limites = JSON.parse(texto.split("LIMITES_QUE_VALIDA_EL_CODIGO (tu propuesta se rechaza si los incumple)\n")[1].split("\n\n")[0]);

  assert.equal(limites.max_dias_consecutivos_con_sesion, DEFAULT_GUARDRAIL_CONFIG.maxConsecutiveTrainingDays,
    "el tope anunciado sale de la configuración real, no de una copia en prosa");
  assert.equal(limites.min_dias_entre_fuerza_pesada_y_tirada_larga, DEFAULT_GUARDRAIL_CONFIG.minHeavyBeforeLongRunDays);
  assert.equal(limites.evidencia_obligatoria_por_sesion, true);

  assert.equal(limites.racha_disponible_mas_larga, 4, "L-M-X-J son cuatro consecutivos");
  assert.match(limites.aviso, /caben 3 sesiones/,
    "cuatro días seguidos con tope de tres exige decir cuántas sesiones entran");
});

/* Un tope configurado más alto que la racha disponible no debe generar el aviso:
   si no, el modelo aprendería a ignorarlo por aparecer siempre. */
test("sin conflicto entre disponibilidad y tope no se avisa de nada", async () => {
  const { construirPromptPlanificador } = await import("./prompt.js");
  const prompt = construirPromptPlanificador({
    contexto: { plan: { id: "p" }, week: { id: "w" }, profile: {} },
    analytics: {}, queries: [], evidence: [],
    semana: { start: "2026-08-17", end: "2026-08-23" },
    disponibilidad: [0, 2, 4],
  });
  const texto = prompt.messages[0].content;
  const limites = JSON.parse(texto.split("LIMITES_QUE_VALIDA_EL_CODIGO (tu propuesta se rechaza si los incumple)\n")[1].split("\n\n")[0]);
  assert.equal(limites.racha_disponible_mas_larga, 1, "días alternos no hacen racha");
  assert.equal(limites.aviso, undefined);
});

/* La base con la que el validador calcula el diff y la que ve el modelo tienen
   que ser la misma lista: si se describieran por separado, acabarían separadas y
   volverían los SESSION_CHANGE_MISMATCH. */
test("la base activa del prompt es la que usa el diff de guardarraíles", async () => {
  const { construirPromptPlanificador } = await import("./prompt.js");
  const { derivarCambiosPlan } = await import("./guardrails.js");
  const contexto = {
    plan: { id: "p" }, week: { id: "w", sessions: [
      { id: "s1", codigo_sesion: "GYM A", dia_semana: 0, tipo: "strength", duracion_min: 45, fecha: "2026-08-17" },
      { id: "s2", codigo_sesion: "RUN A", dia_semana: 5, tipo: "running", duracion_min: 80, fecha: "2026-08-22" },
    ] },
    profile: {},
  };
  const prompt = construirPromptPlanificador({
    contexto, analytics: {}, queries: [], evidence: [],
    semana: { start: "2026-08-17", end: "2026-08-23" }, disponibilidad: [0, 5],
  });
  const texto = prompt.messages[0].content;
  assert.ok(texto.includes("BASE_ACTIVA"), "la base viaja en el prompt");
  const base = JSON.parse(texto.split("BASE_ACTIVA (con esto se calcula qué has cambiado; compara TU fecha con la de aquí)\n")[1].split("\n\n")[0]);
  const derivada = derivarCambiosPlan(contexto, []).filter((c) => c.before);
  assert.equal(base.length, derivada.length, "misma cantidad de sesiones base");
  assert.deepEqual(base.map((b) => b.session_key), derivada.map((c) => c.session_key));
});

/* El recorte por fragmento es un PRESUPUESTO, no un número mágico: se recorta
   cuánto texto entra de cada fragmento y nunca cuántos fragmentos entran, que
   es lo que sostiene la cobertura por consulta.

   El valor concreto vive en server/ai/limits.js y se ajusta por entorno
   (PLANNER_EVIDENCE_CHARS). Este test fija las dos invariantes que de verdad
   importan —el número de fragmentos se conserva y cada uno se corta al
   presupuesto vigente— sin clavar una cifra que impida subirla para un modelo
   de ventana grande. */
test("el prompt acota el texto por fragmento sin recortar cuántos hay", async () => {
  const { construirPromptPlanificador, formatearEvidenciaPlanificador, PLANNER_CHARS_POR_CHUNK } = await import("./prompt.js");
  const { presupuestoEntrada } = await import("../../ai/limits.js");
  const evidence = Array.from({ length: 12 }, (_, i) => ({
    id: `c${i}`, titulo: `Paper ${i}`, texto: "x".repeat(50_000),
  }));

  const bloque = formatearEvidenciaPlanificador(evidence);
  assert.ok(PLANNER_CHARS_POR_CHUNK >= 300, "el presupuesto no puede degradar a un fragmento inservible");
  assert.equal((bloque.match(/x+/g) || []).length, 12, "siguen entrando los doce fragmentos");
  for (const texto of bloque.match(/x+/g)) {
    assert.equal(texto.length, PLANNER_CHARS_POR_CHUNK, "cada uno recortado al presupuesto");
  }

  /* El presupuesto se puede subir y bajar por entorno, y se acota por los dos
     extremos: ni un valor absurdo deja el fragmento sin texto ni uno enorme
     manda el corpus entero. */
  assert.equal(presupuestoEntrada({ PLANNER_EVIDENCE_CHARS: "8000" }).evidenciaChars, 8000);
  assert.equal(presupuestoEntrada({ PLANNER_EVIDENCE_CHARS: "1" }).evidenciaChars, 300);
  assert.equal(presupuestoEntrada({ PLANNER_EVIDENCE_CHARS: "999999" }).evidenciaChars, 40_000);
  assert.equal(presupuestoEntrada({ PLANNER_EVIDENCE_CHARS: "no-es-un-numero" }).evidenciaChars, 3000);

  /* Un recorte explícito manda sobre el presupuesto: es lo que permite bajarlo
     para un modelo pequeño sin tocar la configuración global. */
  const corto = formatearEvidenciaPlanificador(evidence, 400);
  for (const texto of corto.match(/x+/g)) assert.equal(texto.length, 400);

  const prompt = construirPromptPlanificador({
    contexto: { plan: { id: "p" }, week: { id: "w" }, profile: {} },
    analytics: { ventana7d: { km: 30 } }, queries: [], evidence,
    semana: { start: "2026-08-17", end: "2026-08-23" }, disponibilidad: [0, 2, 4],
  });
  /* La evidencia domina el prompt, así que el techo se expresa en función del
     presupuesto: lo que no puede pasar es que crezca por otro lado. */
  const techo = PLANNER_CHARS_POR_CHUNK * evidence.length + 30_000;
  const total = prompt.system.length + prompt.messages[0].content.length;
  assert.ok(total < techo, `el prompt completo debe caber en el presupuesto, son ${total} caracteres`);

  /* Los dos bloques grandes van sin sangría; los deterministas, con ella,
     porque el modelo tiene que copiarlos con precisión. */
  assert.ok(prompt.messages[0].content.includes('"ventana7d":{"km":30}'), "la analítica viaja compacta");
  assert.ok(prompt.messages[0].content.includes('"start_date": "2026-08-17"'), "WEEK_OBLIGATORIA sigue legible");
});

/* Que el plan maestro no encaje en la disponibilidad de la semana es normal, no
   un error: con L-M-X-J y un tope de 3 consecutivos solo caben 3 sesiones y el
   maestro trae 4. Antes eso acababa en propuesta rechazada entera y el atleta se
   quedaba sin nada. El prompt tiene que decirle cuántas caben y pedirle que ceda
   con una recomendación, no que se rinda. */
test("el prompt calcula cuántas sesiones caben y pide ceder en vez de bloquear", async () => {
  const { construirPromptPlanificador, SYSTEM_PROMPT_PLANIFICADOR } = await import("./prompt.js");
  const limitesDe = (disponibilidad) => {
    const prompt = construirPromptPlanificador({
      contexto: { plan: { id: "p" }, week: { id: "w" }, profile: {} },
      analytics: {}, queries: [], evidence: [],
      semana: { start: "2026-08-17", end: "2026-08-23" }, disponibilidad,
    });
    return JSON.parse(prompt.messages[0].content
      .split("LIMITES_QUE_VALIDA_EL_CODIGO (tu propuesta se rechaza si los incumple)\n")[1].split("\n\n")[0]);
  };

  /* L-M-X-J: cuatro consecutivos, tope 3 -> hay que descansar uno. */
  const cuatroSeguidos = limitesDe([0, 1, 2, 3]);
  assert.equal(cuatroSeguidos.max_sesiones_que_caben, 3);
  assert.match(cuatroSeguidos.aviso, /caben 3 sesiones/);
  assert.match(cuatroSeguidos.aviso, /menor prioridad/, "dice qué hacer, no solo que no cabe");

  /* Toda la semana disponible: se descuenta el descanso obligatorio y el tope
     de racha, no se devuelven siete. */
  assert.equal(limitesDe([0, 1, 2, 3, 4, 5, 6]).max_sesiones_que_caben, 6);
  /* Días alternos: ninguna racha, cabe todo lo disponible. */
  assert.equal(limitesDe([0, 2, 4, 6]).max_sesiones_que_caben, 4);
  /* Dos bloques separados se cuentan por separado: L-M-X (3) + V-S (2). */
  assert.equal(limitesDe([0, 1, 2, 4, 5]).max_sesiones_que_caben, 5);

  /* Y el orden de cesión es explícito, con lo clínico fuera de la negociación. */
  assert.match(SYSTEM_PROMPT_PLANIFICADOR, /CUANDO NO CABE TODO/);
  assert.match(SYSTEM_PROMPT_PLANIFICADOR, /Jamás relajes un límite clínico/);
  assert.match(SYSTEM_PROMPT_PLANIFICADOR, /recomendación CONCRETA/);
});

/* El diff marcaba como "moved" TODAS las sesiones, siempre, hiciera lo que
   hiciera el modelo: `planned_sessions` guarda `dia_semana` y no tiene columna
   de fecha, así que una sesión del plan maestro no lleva ninguna y la
   comparación era null !== "2026-08-18". El modelo veía date:null en la base,
   declaraba "unchanged" con toda la lógica del mundo, y el guardarraíl lo
   contradecía sesión por sesión. Era imposible que acertara. */
test("una sesión del maestro que se deja en su día no cuenta como movida", async () => {
  const { derivarCambiosPlan } = await import("./guardrails.js");
  /* Tal y como sale de planned_sessions: día de la semana, sin fecha. */
  const contexto = { week: { sessions: [
    { id: "s1", codigo_sesion: "GYM A", dia_semana: 0, tipo: "strength", duracion_min: 45 },
    { id: "s2", codigo_sesion: "RUN A", dia_semana: 2, tipo: "running", duracion_min: 60 },
  ] } };

  const enSuSitio = derivarCambiosPlan(contexto, [
    { session_key: "GYM A", master_session_code: "GYM A", date: "2026-08-17", day_of_week: 0, modality: "strength", session_type: "strength", duration_min: 45 },
    { session_key: "RUN A", master_session_code: "RUN A", date: "2026-08-19", day_of_week: 2, modality: "running", session_type: "running", duration_min: 60 },
  ]);
  assert.deepEqual(enSuSitio.map((c) => c.type), ["unchanged", "unchanged"],
    "mismo día de la semana que el maestro: no se ha movido nada");

  const movida = derivarCambiosPlan(contexto, [
    { session_key: "GYM A", master_session_code: "GYM A", date: "2026-08-18", day_of_week: 1, modality: "strength", session_type: "strength", duration_min: 45 },
    { session_key: "RUN A", master_session_code: "RUN A", date: "2026-08-19", day_of_week: 2, modality: "running", session_type: "running", duration_min: 60 },
  ]);
  assert.deepEqual(movida.map((c) => c.type), ["moved", "unchanged"],
    "solo la que cambia de día cuenta como movida");
});

/* Cuando la base SÍ tiene fecha —una revisión ya aceptada— manda la fecha, que
   es más precisa que el día de la semana. */
test("con una revisión aceptada el movimiento se mide por fecha", async () => {
  const { seHaMovido } = await import("./guardrails.js");
  assert.equal(seHaMovido({ date: "2026-08-17", day_of_week: 0 }, { date: "2026-08-17", day_of_week: 0 }), false);
  assert.equal(seHaMovido({ date: "2026-08-17", day_of_week: 0 }, { date: "2026-08-24", day_of_week: 0 }), true,
    "misma posición en la semana pero otra semana: se ha movido");
  /* Sin nada comparable no se inventa un movimiento. */
  assert.equal(seHaMovido({}, { date: "2026-08-17" }), false);
});

/* En producción, SESSION_CHANGE_MISMATCH y MISSING_OR_INCORRECT_CHANGE salían en
   casi todas las generaciones: el modelo movía sesiones y las etiquetaba
   "unchanged". Perder la semana entera por eso es castigar al atleta por un dato
   DERIVADO —el diff lo calcula el código, no el modelo— así que ahora se
   normaliza antes de validar en vez de rechazar. */
test("una etiqueta de cambio equivocada se corrige, no tumba la propuesta", async () => {
  /* El modelo intercambia los días de dos sesiones y jura que no ha tocado nada. */
  const sesiones = outputFor().sessions.map((s) => {
    if (s.session_key === "easy") return { ...s, date: "2026-08-18", day_of_week: 1 };
    if (s.session_key === "strength") return { ...s, date: "2026-08-17", day_of_week: 0 };
    return s;
  });
  const { deps, calls } = depsFor(outputFor(sesiones, { changes_from_master_plan: [] }));
  const result = await planificarSemana(context(), deps);

  assert.equal(result.status, "proposal", "antes se rechazaba entera por una etiqueta");
  assert.equal(calls(), 1, "y sin gastar una segunda llamada de reparación");

  const porClave = Object.fromEntries(result.output.sessions.map((s) => [s.session_key, s.change_from_master.type]));
  assert.equal(porClave.easy, "moved", "la etiqueta pasa a ser la que calcula el código");
  assert.equal(porClave.strength, "moved");
  assert.equal(porClave.quality, "unchanged", "lo que no se movió se queda como estaba");

  const cambios = result.output.changes_from_master_plan;
  assert.deepEqual(cambios.map((c) => c.session_key).sort(), ["easy", "strength"],
    "los cambios que el modelo omitió se reconstruyen");
  for (const cambio of cambios) {
    assert.ok(cambio.evidence_ids.length, "con la evidencia de su propia sesión, no inventada");
    assert.ok(cambio.reason, "y con un motivo tomado de lo que el modelo escribió");
  }
});

/* La normalización NO puede convertirse en una puerta trasera: lo que toca son
   datos derivados, y todo lo demás sigue validándose igual. */
test("normalizar el diff no relaja ningún límite clínico", async () => {
  const sesiones = outputFor().sessions.map((s) => (s.session_key === "easy"
    ? { ...s, date: "2026-08-18", day_of_week: 1 } : s));
  const { deps } = depsFor(outputFor(sesiones, { changes_from_master_plan: [] }));
  const conDolor = context({ checkins: [{ fecha: "2026-08-16", dolor: 7 }] });
  const result = await planificarSemana(conDolor, deps);

  assert.notEqual(result.status, "proposal", "con dolor 7/10 y carrera no puede salir propuesta");
  assert.ok(result.validation.guardrails.hard.some((x) => x.code === "PAIN_HIGH_IMPACT"));
});
