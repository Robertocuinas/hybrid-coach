import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrationFiles = [
  "0001_init.js", "0002_auth_sessions.js", "0003_dual_write_reconciliation.js",
  "0004_document_legacy_id.js", "0005_embeddings_index.js", "0006_citations_ui.js",
  "0007_integrity_hardening.js",
];

test("las migraciones 0001-0007 se aplican en orden sobre una base vacía", async () => {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  const pgm = { sql: (statement) => db.exec(statement) };
  for (const file of migrationFiles) {
    const migration = await import(`./${file}`);
    await migration.up(pgm);
  }
  const result = await db.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='client_state_snapshots' AND column_name='state_captured_at') AS state_time,
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_training_plans_one_active') AS one_active,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_role_check') AS role_check`);
  assert.deepEqual(result.rows[0], { state_time: true, one_active: true, role_check: true });
  await db.close();
});
