import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrationFiles = [
  "0001_init.js", "0002_auth_sessions.js", "0003_dual_write_reconciliation.js",
  "0004_document_legacy_id.js", "0005_embeddings_index.js", "0006_citations_ui.js",
  "0007_integrity_hardening.js", "0008_user_ai_settings.js",
  "0009_instance_embedding_settings.js",
];

const baseMigrada = async () => {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  const pgm = { sql: (statement) => db.exec(statement) };
  for (const file of migrationFiles) {
    const migration = await import(`./migrations/${file}`);
    await migration.up(pgm);
  }
  return db;
};

test("las migraciones se aplican en orden sobre una base vacía", async () => {
  const db = await baseMigrada();
  const result = await db.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='client_state_snapshots' AND column_name='state_captured_at') AS state_time,
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_training_plans_one_active') AS one_active,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_role_check') AS role_check,
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='user_ai_settings') AS ai_settings,
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='instance_embedding_settings') AS embedding_settings`);
  assert.deepEqual(result.rows[0], { state_time: true, one_active: true, role_check: true, ai_settings: true, embedding_settings: true });
  await db.close();
});

/* La configuración de embeddings tiene que ser única para toda la instancia:
   dos filas significarían dos modelos vectorizando la misma biblioteca, y el
   retrieval solo ve el índice activo. La restricción lo hace imposible desde
   la propia base de datos, no solo desde el código que escribe. */
test("la configuración de embeddings no admite una segunda fila", async () => {
  const db = await baseMigrada();
  await db.query(`INSERT INTO instance_embedding_settings (provider, model) VALUES ('voyage', 'voyage-3');`);

  await assert.rejects(
    () => db.query(`INSERT INTO instance_embedding_settings (solo_una_fila, provider, model) VALUES (false, 'openai', 'text-embedding-3-small');`),
    /solo_una_fila/,
    "una fila con solo_una_fila=false debe violar el CHECK",
  );
  await assert.rejects(
    () => db.query(`INSERT INTO instance_embedding_settings (provider, model) VALUES ('openai', 'text-embedding-3-small');`),
    /duplicate key|unique/i,
    "y una segunda con el valor por defecto choca con la clave primaria",
  );

  const { rows } = await db.query(`SELECT count(*)::int AS n FROM instance_embedding_settings;`);
  assert.equal(rows[0].n, 1);
  await db.close();
});

test("solo se aceptan proveedores de embeddings que el código sabe instanciar", async () => {
  const db = await baseMigrada();
  await assert.rejects(
    () => db.query(`INSERT INTO instance_embedding_settings (provider, model) VALUES ('anthropic', 'claude-opus-5');`),
    /provider_check/,
    "Anthropic no tiene API de embeddings: la base de datos no debe dejar guardarlo",
  );
  await db.close();
});
