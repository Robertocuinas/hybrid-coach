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
});
