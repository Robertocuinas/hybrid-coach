import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptPlanningProposal, createWeekProposal, normalizeProposal,
  formatPlanningIntensity, proposalSessionsToAssignments, rejectPlanningProposal,
} from "./planningApi.js";

const response = (body, { ok = true, status = 200 } = {}) => ({
  ok, status, text: async () => body === null ? "" : JSON.stringify(body),
});

test("crea y normaliza una propuesta semanal", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options]);
    return response({ proposal: { id: 42, sessions: [], evidence_state: "limited", week_summary: "Semana conservadora" } });
  };
  const proposal = await createWeekProposal(3, { availabilityDays: [0, 2] }, fetchImpl);
  assert.equal(calls[0][0], "/api/planning/weeks/3/proposals");
  assert.deepEqual(JSON.parse(calls[0][1].body), { availabilityDays: [0, 2] });
  assert.equal(proposal.id, "42");
  assert.equal(proposal.evidenceState, "limited");
  assert.equal(proposal.summary, "Semana conservadora");
});

test("materializa sesiones por indice, nombre o fecha", () => {
  assert.deepEqual(proposalSessionsToAssignments([
    { day: 0, code: "GYM A" },
    { day: "Miércoles", sessionCode: "RUN B" },
    { date: "2026-08-16", session_code: "RUN A" },
  ], "2026-08-10"), [
    { day: 0, code: "GYM A" }, { day: 2, code: "RUN B" }, { day: 6, code: "RUN A" },
  ]);
});

test("adapta el schema semanal del servidor", () => {
  const proposal = normalizeProposal({ id: "p1", summary: { public_reason: "Reducimos carga", confidence: 0.8, evidence_state: "mixed" }, sessions: [] });
  assert.equal(proposal.summary, "Reducimos carga");
  assert.equal(proposal.evidenceState, "mixed");
  assert.equal(proposal.confidence, 0.8);
  assert.deepEqual(proposalSessionsToAssignments([
    { day_of_week: 1, master_session_code: "GYM B" },
    { day_of_week: 5, session_type: "long_run" },
  ], "2026-08-10"), [{ day: 1, code: "GYM B" }, { day: 5, code: "RUN A" }]);
  assert.equal(formatPlanningIntensity({ rpe_min: 3, rpe_max: 4, rir_min: null, rir_max: null, pace_zone: "Z2" }), "RPE 3-4 · Z2");
});

test("normaliza el envelope persistido con revision, sesiones, evidencia y guardrails", () => {
  const proposal = normalizeProposal({
    proposal: { revision: { id: "rev-1", revision: 3, status: "draft", summary: "Semana prudente", evidence_state: "limited", confidence: 0.72, week_number: 4 } },
    sessions: [{ fecha: "2026-08-11", day_of_week: 1, session_code: "GYM A", title: "Fuerza", duration_min: 48, intensity: { rpe_min: null, rpe_max: null, rir_min: 2, rir_max: 3, pace_zone: null } }],
    evidence: [
      { id: "row-1", document_chunk_id: "chunk-1", used_by_model: true, document_title: "Concurrent training", chunk_text: "Separación entre estímulos." },
      { id: "row-2", document_chunk_id: "chunk-2", used_by_model: false },
    ],
    guardrails: [{ rule_key: "MIN_REST", result: false, severity: "error", message: "Falta descanso" }],
  });
  assert.equal(proposal.id, "rev-1");
  assert.equal(proposal.revisionNumber, 3);
  assert.equal(proposal.weekNumber, 4);
  assert.equal(proposal.summary, "Semana prudente");
  assert.equal(proposal.sessions[0].session_code, "GYM A");
  assert.equal(proposal.citations.length, 1);
  assert.equal(proposal.citations[0].chunkId, "chunk-1");
  assert.equal(proposal.warnings[0].message, "Falta descanso");
});

test("normaliza tambien un envelope con revision en la raiz", () => {
  const proposal = normalizeProposal({
    revision: { id: "rev-2", revision_number: 5, summary: "Sin cambios", evidence_state: "sufficient" },
    sessions: [{ date: "2026-08-16", day_of_week: 6, session_code: "RUN A" }],
    evidence: [], guardrails: { valid: true, hard: [], soft: [] },
  });
  assert.equal(proposal.id, "rev-2");
  assert.equal(proposal.revisionNumber, 5);
  assert.equal(proposal.evidenceState, "sufficient");
});

test("rechaza sesiones incompatibles con la agenda local", () => {
  assert.throws(() => proposalSessionsToAssignments([{ day: 0, code: "RUN A" }, { day: 0, code: "GYM A" }], "2026-08-10"), /dos sesiones/);
  assert.throws(() => proposalSessionsToAssignments([{ day: 0, code: "RUN A" }, { day: 2, code: "RUN A" }], "2026-08-10"), /no puede distinguir/);
  assert.throws(() => proposalSessionsToAssignments([{ title: "Rodaje" }], "2026-08-10"), /falta día o código/);
  assert.throws(() => normalizeProposal({ id: "x" }), /id y sesiones/);
});

test("acepta y rechaza por endpoints separados", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push([url, JSON.parse(options.body)]); return response(null); };
  await acceptPlanningProposal("abc/1", fetchImpl);
  await rejectPlanningProposal("abc/1", 7, fetchImpl);
  assert.deepEqual(calls, [
    ["/api/planning/proposals/abc%2F1/accept", {}],
    ["/api/planning/proposals/abc%2F1/reject", { expectedRevision: 7 }],
  ]);
});

test("expone un error de API legible", async () => {
  await assert.rejects(
    createWeekProposal(2, {}, async () => response({ message: "RAG no disponible", code: "RAG_DOWN" }, { ok: false, status: 503 })),
    (error) => error.status === 503 && error.code === "RAG_DOWN" && /RAG no disponible/.test(error.message),
  );
});
