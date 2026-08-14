import test from "node:test";
import assert from "node:assert/strict";
import { compareTotals, describeReconciliationError, runReconciliation } from "./reconciliation.js";

test("explica errores de conexión sin filtrar DATABASE_URL ni contraseñas", () => {
  assert.equal(
    describeReconciliationError({ code: "28P01" }, { DATABASE_URL: "postgresql://user:secret@db/railway" }),
    "PostgreSQL rechazó DATABASE_URL: usuario o contraseña no válidos. (28P01)",
  );
  const unknown = describeReconciliationError(
    new Error("falló postgresql://user:supersecret@db.internal/railway"),
    {},
  );
  assert.equal(unknown, "falló postgresql://user:***@db.internal/railway");
  assert.doesNotMatch(unknown, /supersecret/);
});

test("detecta diferencias reales con tolerancia numérica", () => {
  const diff = compareTotals(
    { runningCount: 2, km: 15, strengthSets: 4, kg: 1000, checkins: 2 },
    { runningCount: 2, km: 14.5, strengthSets: 4, kg: 1000, checkins: 1 },
  );
  assert.deepEqual(Object.keys(diff).sort(), ["checkins", "km"]);
});

test("registra rojo cuando PostgreSQL diverge del snapshot local", async () => {
  const inserts = [];
  const db = {
    async query(sql, params = []) {
      if (sql.includes("FROM client_state_snapshots")) return { rows: [{ athlete_profile_id: "profile-1",
        local_totals: { runningCount: 1, km: 10, strengthSets: 1, kg: 500, checkins: 1 },
        captured_at: "2026-08-11T08:00:00Z" }] };
      if (sql.includes("AS \"runningCount\"")) return { rows: [{ runningCount: 1, km: 9, strengthSets: 1, kg: 500, checkins: 1 }] };
      if (sql.includes("INSERT INTO reconciliation_runs")) { inserts.push(params); return { rowCount: 1, rows: [] }; }
      throw new Error(`SQL inesperado: ${sql}`);
    },
  };
  const results = await runReconciliation(db, () => new Date("2026-08-11T12:00:00Z"));
  assert.equal(results[0].status, "red");
  assert.deepEqual(results[0].differences.km, { local: 10, database: 9 });
  assert.equal(inserts[0][4], "red");
});
