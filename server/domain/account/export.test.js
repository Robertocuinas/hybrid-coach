import test from "node:test";
import assert from "node:assert/strict";
import { exportUserData } from "./export.js";

test("la exportación no incluye hash de contraseña ni tokens de sesión", async () => {
  const db = { query: async (sql) => {
    if (sql.includes("FROM users")) return { rows: [{ id: "u1", email: "a@example.test", role: "athlete", created_at: "2026-01-01" }] };
    if (sql.includes("FROM athlete_profiles")) return { rows: [] };
    if (sql.includes("FROM sync_operations")) return { rows: [] };
    throw new Error(`consulta inesperada: ${sql}`);
  } };
  const exported = await exportUserData("u1", db);
  const serialized = JSON.stringify(exported);
  assert.equal(exported.account.email, "a@example.test");
  assert.doesNotMatch(serialized, /password_hash|token_hash|user_sessions/);
  assert.deepEqual(exported.planning_runs, []);
  assert.deepEqual(exported.weekly_plan_revisions, []);
  assert.deepEqual(exported.weekly_plan_sessions, []);
  assert.deepEqual(exported.planning_run_evidence, []);
  assert.deepEqual(exported.guardrail_results, []);
  assert.deepEqual(exported.plan_change_proposals, []);
});

test("la exportación de planning recorre solo padres pertenecientes a la cuenta", async () => {
  const calls = [];
  const profileIds = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
  const runId = "10000000-0000-4000-8000-000000000001";
  const revisionId = "20000000-0000-4000-8000-000000000001";
  const db = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("FROM users")) {
      return { rows: [{ id: "u1", email: "a@example.test", role: "athlete", created_at: "2026-01-01" }] };
    }
    if (sql.includes("FROM athlete_profiles")) {
      return { rows: profileIds.map((id) => ({ id, user_id: "u1" })) };
    }
    if (sql.includes("FROM planning_runs")) {
      assert.deepEqual(params, [profileIds]);
      return { rows: [{ id: runId, athlete_profile_id: profileIds[0] }] };
    }
    if (sql.includes("FROM weekly_plan_revisions")) {
      assert.deepEqual(params, [profileIds]);
      return { rows: [{ id: revisionId, athlete_profile_id: profileIds[0], planning_run_id: runId }] };
    }
    if (sql.includes("FROM plan_change_proposals")) {
      assert.deepEqual(params, [profileIds]);
      return { rows: [{ id: "change-owned", athlete_profile_id: profileIds[1], planning_run_id: runId }] };
    }
    if (sql.includes("FROM weekly_plan_sessions")) {
      assert.deepEqual(params, [[revisionId]]);
      return { rows: [{ id: "session-owned", weekly_plan_revision_id: revisionId }] };
    }
    if (sql.includes("FROM planning_run_evidence")) {
      assert.deepEqual(params, [[runId]]);
      return { rows: [{ id: "evidence-owned", planning_run_id: runId }] };
    }
    if (sql.includes("FROM guardrail_results")) {
      assert.deepEqual(params, [[runId]]);
      return { rows: [{ id: "guardrail-owned", planning_run_id: runId }] };
    }
    if (sql.includes("FROM sync_operations")) return { rows: [] };
    return { rows: [] };
  } };

  const exported = await exportUserData("u1", db);

  assert.deepEqual(exported.planning_runs.map((row) => row.id), [runId]);
  assert.deepEqual(exported.weekly_plan_revisions.map((row) => row.id), [revisionId]);
  assert.deepEqual(exported.weekly_plan_sessions.map((row) => row.id), ["session-owned"]);
  assert.deepEqual(exported.planning_run_evidence.map((row) => row.id), ["evidence-owned"]);
  assert.deepEqual(exported.guardrail_results.map((row) => row.id), ["guardrail-owned"]);
  assert.deepEqual(exported.plan_change_proposals.map((row) => row.id), ["change-owned"]);

  const childQueries = calls.filter(({ sql }) => /weekly_plan_sessions|planning_run_evidence|guardrail_results/.test(sql));
  assert.equal(childQueries.length, 3);
  assert.doesNotMatch(JSON.stringify(childQueries), /foreign|other-profile/);
});
