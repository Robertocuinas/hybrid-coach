import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  PlanningConflictError,
  acceptPlanChangeProposal,
  acceptWeeklyPlanRevision,
  createPlanChangeProposal,
  createPlanningDraft,
  getAcceptedWeeklyPlanRevision,
  getPlanChangeProposal,
  getWeeklyPlanRevision,
  hashPlanningInput,
  listPlanningRuns,
  readCanonicalPlanningContext,
  rejectWeeklyPlanRevision,
} from "./weeklyPlanning.js";

const migrationFiles = [
  "0001_init.js", "0002_auth_sessions.js", "0003_dual_write_reconciliation.js",
  "0004_document_legacy_id.js", "0005_embeddings_index.js", "0006_citations_ui.js",
  "0007_integrity_hardening.js", "0008_user_ai_settings.js",
  "0009_instance_embedding_settings.js", "0010_weekly_planning.js",
  "0011_planning_and_evidence_integrity.js",
];

async function database() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  const pgm = { sql: (statement) => db.exec(statement) };
  for (const file of migrationFiles) {
    const migration = await import(`../migrations/${file}`);
    await migration.up(pgm);
  }
  return db;
}

async function fixture(db, suffix = "a") {
  const { rows: users } = await db.query(
    `INSERT INTO users(email) VALUES($1) RETURNING id;`, [`${suffix}@example.test`],
  );
  const { rows: profiles } = await db.query(
    `INSERT INTO athlete_profiles(user_id,nombre,fecha_carrera,current_complaints)
     VALUES($1,'Atleta','2026-10-18','[{"zona":"gemelo","intensidad":3}]') RETURNING id;`,
    [users[0].id],
  );
  const profileId = profiles[0].id;
  const { rows: plans } = await db.query(
    `INSERT INTO training_plans(athlete_profile_id,total_semanas,activo,structure_hash)
     VALUES($1,10,true,$2) RETURNING id;`, [profileId, "a".repeat(64)],
  );
  const planId = plans[0].id;
  const { rows: weeks } = await db.query(
    `INSERT INTO training_weeks(training_plan_id,numero_semana,inicio)
     VALUES($1,1,'2026-08-10') RETURNING id;`, [planId],
  );
  await db.query(
    `INSERT INTO planned_sessions(training_week_id,dia_semana,codigo_sesion,tipo,duracion_min)
     VALUES($1,0,'GYM A','strength',45),($1,5,'RUN A','running',80);`, [weeks[0].id],
  );
  const { rows: docs } = await db.query(
    `INSERT INTO documents(titulo,autores,anio,study_type,evidence_grade,origen,revisado)
     VALUES('Concurrent training','Wilson',2012,'meta_analysis','fuerte','pdf',false) RETURNING id;`,
  );
  const { rows: chunks } = await db.query(
    `INSERT INTO document_chunks(document_id,chunk_index,seccion,pagina_inicio,texto)
     VALUES($1,0,'results',4,'Separar las modalidades reduce la interferencia.') RETURNING id;`, [docs[0].id],
  );
  await db.query(`UPDATE documents SET revisado=true WHERE id=$1;`, [docs[0].id]);
  const { rows: contextRows } = await db.query(
    `SELECT planning_context_version FROM athlete_profiles WHERE id=$1;`,
    [profileId],
  );
  return {
    profileId,
    planId,
    chunkId: chunks[0].id,
    planningContextVersion: Number(contextRows[0].planning_context_version),
    structureHash: "a".repeat(64),
  };
}

const draftInput = ({
  profileId, planId, chunkId, planningContextVersion, structureHash, baseRevisionId = null,
}) => ({
  profileId,
  planId,
  weekNumber: 1,
  run: {
    promptVersion: "planner-v1",
    schemaVersion: "week-v1",
    rulesVersion: "rules-v1",
    provider: "test",
    model: "deterministic-fixture",
    inputSnapshot: {
      context: {
        profile: { planning_context_version: planningContextVersion },
        plan: { structure_hash: structureHash },
        availability: [0, 2, 5],
        fatigue: 4,
      },
    },
    analytics: { km7d: 18 },
    queryPlan: [{ key: "concurrent", query: "fuerza y carrera" }],
    retrievalDiagnostics: { candidates: 1 },
    validatedOutput: { valid: true },
    validationResults: [],
    latencyMs: 25,
  },
  revision: {
    baseRevisionId,
    weekStartDate: "2026-08-10",
    weekEndDate: "2026-08-16",
    summary: "Separa fuerza y tirada larga.",
    confidence: 0.82,
    evidenceState: "sufficient",
  },
  sessions: [{
    sessionKey: "gym-a",
    sessionDate: "2026-08-10",
    dayOfWeek: 0,
    modality: "strength",
    sessionType: "full_body",
    sessionCode: "GYM A",
    title: "Fuerza A",
    priority: "high",
    durationMin: 45,
    intensity: { rpe_min: 6, rpe_max: 7 },
    prescription: { rir: 2 },
    objective: "Mantener fuerza",
    publicReason: "Lejos de la tirada larga.",
    changeType: "kept",
  }],
  evidence: [{
    chunkId,
    queryKey: "concurrent",
    queryText: "distribución fuerza y carrera",
    rank: 1,
    scores: { cosine: 0.76, rerank: 0.91 },
    scoreType: "rerank",
    sentToModel: true,
    usedByModel: true,
  }],
  guardrails: [{
    ruleKey: "min_rest",
    ruleVersion: "1",
    severity: "error",
    result: "pass",
    message: "Respeta el descanso mínimo",
  }],
});

test("crea de forma atómica un run, borrador, sesiones, evidencia y guardrails", async () => {
  const db = await database();
  const ids = await fixture(db);
  const created = await createPlanningDraft(draftInput(ids), db);

  assert.equal(created.revision.status, "draft");
  assert.equal(created.revision.revision, 1);
  assert.equal(created.sessions.length, 1);
  assert.deepEqual(created.sessions[0].intensity, { rpe_min: 6, rpe_max: 7 });
  assert.equal(created.evidence[0].used_by_model, true);
  assert.equal(created.guardrails[0].result, "pass");
  assert.equal(created.run.input_hash, hashPlanningInput(draftInput(ids).run.inputSnapshot));

  const loaded = await getWeeklyPlanRevision(created.revision.id, ids.profileId, db);
  assert.equal(loaded.sessions[0].session_code, "GYM A");
  assert.equal(loaded.evidence[0].titulo, "Concurrent training");
  assert.equal(loaded.guardrails[0].rule_key, "min_rest");
  await db.close();
});

test("aceptar usa la base esperada, sustituye la revisión previa y rechaza borradores obsoletos", async () => {
  const db = await database();
  const ids = await fixture(db);
  const first = await createPlanningDraft(draftInput(ids), db);
  await acceptWeeklyPlanRevision({
    revisionId: first.revision.id, profileId: ids.profileId, expectedRevision: 1,
  }, db);

  const secondInput = draftInput({ ...ids, baseRevisionId: first.revision.id });
  secondInput.changeProposal = {
    changeType: "mover", sourceSessionKey: "GYM A", targetSessionKey: "GYM A",
    payload: { dia: "miércoles" }, reason: "Separar cargas.", evidenceState: "sufficient", confidence: 0.8,
  };
  const second = await createPlanningDraft(secondInput, db);
  const stale = await createPlanningDraft(draftInput({ ...ids, baseRevisionId: first.revision.id }), db);
  const accepted = await acceptWeeklyPlanRevision({
    revisionId: second.revision.id, profileId: ids.profileId, expectedRevision: 2,
  }, db);
  assert.equal(accepted.revision.status, "accepted");
  const linkedAccepted = await db.query(`SELECT status FROM plan_change_proposals WHERE weekly_plan_revision_id=$1`, [second.revision.id]);
  assert.equal(linkedAccepted.rows[0].status, "accepted", "aceptar la semana resuelve también el cambio del Coach enlazado");

  const { rows: states } = await db.query(
    `SELECT revision,status FROM weekly_plan_revisions ORDER BY revision;`,
  );
  assert.deepEqual(states.slice(0, 2), [
    { revision: 1, status: "superseded" },
    { revision: 2, status: "accepted" },
  ]);
  await assert.rejects(
    () => acceptWeeklyPlanRevision({ revisionId: stale.revision.id, profileId: ids.profileId, expectedRevision: 3 }, db),
    (error) => error instanceof PlanningConflictError && error.status === 409,
  );

  const rejectedInput = draftInput({ ...ids, baseRevisionId: second.revision.id });
  rejectedInput.changeProposal = {
    changeType: "reducir_volumen", payload: { de: "RUN A" }, reason: "Fatiga.", evidenceState: "sufficient", confidence: 0.7,
  };
  const rejectedDraft = await createPlanningDraft(rejectedInput, db);
  const rejected = await rejectWeeklyPlanRevision({
    revisionId: rejectedDraft.revision.id, profileId: ids.profileId,
    expectedRevision: rejectedDraft.revision.revision,
  }, db);
  assert.equal(rejected.revision.status, "rejected");
  const linkedRejected = await db.query(`SELECT status FROM plan_change_proposals WHERE weekly_plan_revision_id=$1`, [rejectedDraft.revision.id]);
  assert.equal(linkedRejected.rows[0].status, "rejected");
  await db.close();
});

test("lee solo la revisión aceptada de la semana del plan activo y del perfil propietario", async () => {
  const db = await database();
  const owner = await fixture(db, "accepted-owner");
  const stranger = await fixture(db, "accepted-stranger");
  assert.equal(await getAcceptedWeeklyPlanRevision(owner.profileId, 1, db), null);

  const draft = await createPlanningDraft(draftInput(owner), db);
  await acceptWeeklyPlanRevision({
    revisionId: draft.revision.id,
    profileId: owner.profileId,
    expectedRevision: draft.revision.revision,
  }, db);

  const accepted = await getAcceptedWeeklyPlanRevision(owner.profileId, 1, db);
  assert.equal(accepted.revision.id, draft.revision.id);
  assert.equal(accepted.revision.status, "accepted");
  assert.equal(accepted.sessions[0].session_code, "GYM A");
  assert.equal(await getAcceptedWeeklyPlanRevision(stranger.profileId, 1, db), null);

  await db.query(`UPDATE training_plans SET activo=false WHERE id=$1`, [owner.planId]);
  assert.equal(await getAcceptedWeeklyPlanRevision(owner.profileId, 1, db), null, "una revisión de un plan histórico no se reactiva");
  await db.close();
});

test("un fallo en evidencia revierte también el run y el borrador", async () => {
  const db = await database();
  const ids = await fixture(db);
  const invalid = draftInput(ids);
  invalid.evidence[0].sentToModel = false;
  invalid.evidence[0].usedByModel = true;

  await assert.rejects(() => createPlanningDraft(invalid, db), /planning_run_evidence_usage_check/);
  const { rows } = await db.query(`SELECT
    (SELECT count(*)::int FROM planning_runs) AS runs,
    (SELECT count(*)::int FROM weekly_plan_revisions) AS revisions,
    (SELECT count(*)::int FROM weekly_plan_sessions) AS sessions;`);
  assert.deepEqual(rows[0], { runs: 0, revisions: 0, sessions: 0 });
  await db.close();
});

test("el contexto canónico incluye molestias, semana maestra y disponibilidad real", async () => {
  const db = await database();
  const ids = await fixture(db);
  await db.query(
    `INSERT INTO availability(athlete_profile_id,vigente_desde,dias,min_gym,min_run,min_finde)
     VALUES($1,'2026-08-01',ARRAY[0,2,5],45,30,90);`, [ids.profileId],
  );
  const context = await readCanonicalPlanningContext(ids.profileId, {
    db, planId: ids.planId, weekNumber: 1, today: new Date("2026-08-14T12:00:00Z"),
  });
  assert.deepEqual(context.profile.current_complaints, [{ zona: "gemelo", intensidad: 3 }]);
  assert.deepEqual(context.availability.dias, [0, 2, 5]);
  assert.equal(new Date(context.masterWeeks[0].inicio).toISOString().slice(0, 10), "2026-08-10");
  assert.equal(context.masterWeeks[0].sessions.length, 2);
  await db.close();
});

test("los cambios del Coach conservan ownership, revisión optimista y evidencia del run", async () => {
  const db = await database();
  const ids = await fixture(db);
  const draft = await createPlanningDraft(draftInput(ids), db);
  const proposal = await createPlanChangeProposal(ids.profileId, {
    planningRunId: draft.run.id,
    weeklyPlanRevisionId: draft.revision.id,
    changeType: "move",
    effectiveDate: "2026-08-10",
    sourceSessionKey: "gym-a",
    targetSessionKey: "gym-a-wed",
    payload: { from: "2026-08-10", to: "2026-08-12" },
    reason: "Más descanso tras la tirada.",
    evidenceState: "sufficient",
    confidence: 0.8,
  }, db);

  await assert.rejects(
    () => acceptPlanChangeProposal({ proposalId: proposal.id, profileId: ids.profileId, expectedRevision: 2 }, db),
    (error) => error instanceof PlanningConflictError && error.statusCode === 409,
  );
  const accepted = await acceptPlanChangeProposal({
    proposalId: proposal.id, profileId: ids.profileId, expectedRevision: 1,
  }, db);
  assert.equal(accepted.status, "accepted");

  const loaded = await getPlanChangeProposal(proposal.id, ids.profileId, db);
  assert.equal(loaded.evidence.length, 1);
  assert.equal(loaded.evidence[0].titulo, "Concurrent training");
  await db.close();
});

test("stale clinical data prevents accepting a draft", async () => {
  const db = await database();
  const ids = await fixture(db, "stale-clinical");
  const draft = await createPlanningDraft(draftInput(ids), db);
  await db.query(
    `INSERT INTO feedback_logs(athlete_profile_id,fecha,dolor,cuando_aparece)
     VALUES($1,'2026-08-11',6,'pain also at rest');`,
    [ids.profileId],
  );
  await assert.rejects(
    () => acceptWeeklyPlanRevision({
      revisionId: draft.revision.id,
      profileId: ids.profileId,
      expectedRevision: draft.revision.revision,
    }, db),
    (error) => error instanceof PlanningConflictError && error.status === 409,
  );
  const loaded = await getWeeklyPlanRevision(draft.revision.id, ids.profileId, db);
  assert.equal(loaded.revision.status, "draft");
  await db.close();
});

test("a draft from a replaced master plan cannot be accepted", async () => {
  const db = await database();
  const ids = await fixture(db, "stale-plan");
  const draft = await createPlanningDraft(draftInput(ids), db);
  await db.query(`UPDATE training_plans SET activo=false WHERE id=$1;`, [ids.planId]);
  await db.query(
    `INSERT INTO training_plans(athlete_profile_id,total_semanas,activo,structure_hash)
     VALUES($1,10,true,$2);`,
    [ids.profileId, "b".repeat(64)],
  );
  await assert.rejects(
    () => acceptWeeklyPlanRevision({
      revisionId: draft.revision.id,
      profileId: ids.profileId,
      expectedRevision: draft.revision.revision,
    }, db),
    (error) => error instanceof PlanningConflictError && error.status === 409,
  );
  await db.close();
});

/* El panel de administración lo mira otra persona, no el atleta. Que el
   diagnóstico de una generación no arrastre peso, dolor ni lesiones es la razón
   de que listPlanningRuns() use lista blanca en vez de SELECT *; sin este test,
   añadir un campo al SELECT filtraría datos de salud sin que nadie lo note. */
test("el diagnóstico de generaciones no expone datos de salud del atleta", async () => {
  const db = await database();
  const { profileId, planId } = await fixture(db, "runs");
  await db.query(
    `INSERT INTO planning_runs(athlete_profile_id,training_plan_id,week_number,kind,status,
       provider,model,latency_ms,completed_at,
       input_snapshot,analytics,query_plan,retrieval_diagnostics,validation_results,failure)
     VALUES($1,$2,1,'weekly_plan','failed','openai','gpt-x',8200,now(),
       $3,$4,$5,$6,$7,$8);`,
    [profileId, planId,
      JSON.stringify({ profile: { peso_kg: 74.5, lesiones: ["tendinitis aquiles"] } }),
      JSON.stringify({ seguridad: { dolorMaximo: 4 }, ventana7d: { fatigaMedia: 6 } }),
      JSON.stringify([{ key: "pain_safety", query: "dolor en gemelo izquierdo", required: true }]),
      JSON.stringify([{ queryKey: "pain_safety", chunks: 3, hayEvidencia: true, diagnostico: { latenciaMs: 640 } }]),
      JSON.stringify([{ path: "sessions.0.evidence_ids", code: "unknown_evidence_id" }]),
      JSON.stringify({ status: "invalid", code: "guardrail_failed" }),
    ],
  );

  const [run] = await listPlanningRuns({ limit: 5 }, db);
  const serializado = JSON.stringify(run);

  assert.equal(run.status, "failed");
  assert.equal(run.latency_ms, 8200);
  assert.deepEqual(run.failure, { status: "invalid", code: "guardrail_failed" });
  assert.equal(run.validation_results[0].code, "unknown_evidence_id", "el motivo del fallo sí debe llegar");
  assert.equal(run.retrieval_diagnostics[0].diagnostico.latenciaMs, 640, "y la latencia por consulta también");

  assert.equal(run.input_snapshot, undefined, "el snapshot lleva peso y lesiones");
  assert.equal(run.analytics, undefined, "la analítica lleva dolor y fatiga");
  assert.equal(run.validated_output, undefined);
  assert.deepEqual(run.queryPlan, [{ key: "pain_safety", required: true }], "del plan solo la clave");
  for (const filtrado of ["74.5", "tendinitis", "gemelo izquierdo", "dolorMaximo"]) {
    assert.ok(!serializado.includes(filtrado), `no debe viajar "${filtrado}"`);
  }
  await db.close();
});

/* Una generación que termina pero cuya salida no pasa los guardarraíles se
   guarda como `completed` con un `failure` dentro: filtrar por status='failed'
   la escondía, que es exactamente el caso que hay que diagnosticar. */
test("el filtro de fallos encuentra también las generaciones que terminaron sin propuesta", async () => {
  const db = await database();
  const { profileId, planId } = await fixture(db, "fallos");
  const insertar = (status, failure) => db.query(
    `INSERT INTO planning_runs(athlete_profile_id,training_plan_id,week_number,kind,status,completed_at,failure)
     VALUES($1,$2,1,'weekly_plan',$3,now(),$4);`,
    [profileId, planId, status, failure],
  );
  await insertar("completed", JSON.stringify({ code: "guardrail_failed" }));
  await insertar("failed", JSON.stringify({ code: "llm_failed" }));
  await insertar("completed", null);

  const fallidas = await listPlanningRuns({ onlyFailed: true }, db);
  assert.deepEqual(
    fallidas.map((r) => r.failure.code).sort(),
    ["guardrail_failed", "llm_failed"],
    "las dos formas de no acabar en propuesta",
  );
  assert.equal((await listPlanningRuns({ status: "failed" }, db)).length, 1, "el estado solo ve la externa");
  assert.equal((await listPlanningRuns({}, db)).length, 3);
  await db.close();
});
