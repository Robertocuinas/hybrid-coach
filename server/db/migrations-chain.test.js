import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrationFiles = [
  "0001_init.js", "0002_auth_sessions.js", "0003_dual_write_reconciliation.js",
  "0004_document_legacy_id.js", "0005_embeddings_index.js", "0006_citations_ui.js",
  "0007_integrity_hardening.js", "0008_user_ai_settings.js",
  "0009_instance_embedding_settings.js", "0010_weekly_planning.js",
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
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='instance_embedding_settings') AS embedding_settings,
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='planning_runs') AS planning_runs,
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='weekly_plan_revisions') AS weekly_revisions,
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_weekly_plan_one_accepted') AS one_weekly_accepted`);
  assert.deepEqual(result.rows[0], {
    state_time: true, one_active: true, role_check: true, ai_settings: true,
    embedding_settings: true, planning_runs: true, weekly_revisions: true,
    one_weekly_accepted: true,
  });
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

test("0010 deduplica sesiones maestras antes de imponer la clave estable", async () => {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  const pgm = { sql: (statement) => db.exec(statement) };
  for (const file of migrationFiles.slice(0, -1)) {
    const migration = await import(`./migrations/${file}`);
    await migration.up(pgm);
  }
  const { rows: users } = await db.query(`INSERT INTO users(email) VALUES('dedupe@test') RETURNING id;`);
  const { rows: profiles } = await db.query(`INSERT INTO athlete_profiles(user_id) VALUES($1) RETURNING id;`, [users[0].id]);
  const { rows: plans } = await db.query(`INSERT INTO training_plans(athlete_profile_id) VALUES($1) RETURNING id;`, [profiles[0].id]);
  const { rows: weeks } = await db.query(`INSERT INTO training_weeks(training_plan_id,numero_semana) VALUES($1,1) RETURNING id;`, [plans[0].id]);
  const { rows: duplicates } = await db.query(
    `INSERT INTO planned_sessions(training_week_id,dia_semana,codigo_sesion)
     VALUES($1,1,'RUN A'),($1,2,'RUN A') RETURNING id;`, [weeks[0].id],
  );
  await db.query(
    `INSERT INTO completed_sessions(athlete_profile_id,planned_session_id,fecha,tipo)
     VALUES($1,$2,'2026-08-11','running');`, [profiles[0].id, duplicates[1].id],
  );

  const migration = await import("./migrations/0010_weekly_planning.js");
  await migration.up(pgm);
  const { rows } = await db.query(`SELECT ps.id,cs.planned_session_id
    FROM planned_sessions ps JOIN completed_sessions cs ON cs.planned_session_id=ps.id
    WHERE ps.training_week_id=$1 AND ps.codigo_sesion='RUN A';`, [weeks[0].id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, rows[0].planned_session_id, "la sesión completada se reasigna antes de borrar el duplicado");
  await assert.rejects(
    () => db.query(`INSERT INTO planned_sessions(training_week_id,dia_semana,codigo_sesion) VALUES($1,3,'RUN A');`, [weeks[0].id]),
    /unique|duplicate/i,
  );
  await db.close();
});
