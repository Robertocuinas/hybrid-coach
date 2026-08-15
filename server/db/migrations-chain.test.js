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
  "0011_planning_and_evidence_integrity.js", "0012_exercise_identity.js", "0013_consumed_foods.js",
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
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_weekly_plan_one_accepted') AS one_weekly_accepted,
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='athlete_profiles' AND column_name='planning_context_version') AS planning_context_version`);
  assert.deepEqual(result.rows[0], {
    state_time: true, one_active: true, role_check: true, ai_settings: true,
    embedding_settings: true, planning_runs: true, weekly_revisions: true,
    one_weekly_accepted: true, planning_context_version: true,
  });
  await db.close();
});

/* La configuración de embeddings tiene que ser única para toda la instancia:
   dos filas significarían dos modelos vectorizando la misma biblioteca, y el
   retrieval solo ve el índice activo. La restricción lo hace imposible desde
   la propia base de datos, no solo desde el código que escribe. */
/* La identidad externa es lo que impide importar dos veces el mismo ejercicio
   del catálogo. Los propios no llevan external_id y no quedan afectados. */
test("un ejercicio externo no se puede duplicar, y los propios no se estorban", async () => {
  const db = await baseMigrada();

  await db.query(`INSERT INTO strength_exercises (nombre, canonical_name, provider, external_id)
                  VALUES ('Barbell Bench Press', 'barbell bench press', 'exercisedb', 'abc123');`);

  await assert.rejects(
    () => db.query(`INSERT INTO strength_exercises (nombre, canonical_name, provider, external_id)
                    VALUES ('Bench Press', 'bench press', 'exercisedb', 'abc123');`),
    /duplicate key|unique/i,
    "el mismo external_id no puede entrar dos veces",
  );

  /* Varios ejercicios propios conviven sin external_id: el índice único no
     los alcanza porque PostgreSQL no compara NULL entre sí. */
  await db.query(`INSERT INTO strength_exercises (nombre, canonical_name, provider)
                  VALUES ('Press banca', 'press banca', 'custom'), ('Sentadilla', 'sentadilla', 'custom');`);

  const total = await db.query(`SELECT count(*)::int AS n FROM strength_exercises;`);
  assert.equal(total.rows[0].n, 3);
  await db.close();
});

/* El relleno de la migración debe dejar los nombres ya normalizados: si no,
   el primer registro de un ejercicio existente crearía un duplicado. */
test("la migración normaliza el nombre de los ejercicios que ya existían", async () => {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  const pgm = { sql: (statement) => db.exec(statement) };
  for (const file of migrationFiles.slice(0, migrationFiles.indexOf("0012_exercise_identity.js"))) {
    await (await import(`./migrations/${file}`)).up(pgm);
  }
  await db.query(`INSERT INTO strength_exercises (nombre) VALUES ('Elevación de gemelo SENTADO'), ('  Press-Banca  ');`);

  await (await import("./migrations/0012_exercise_identity.js")).up(pgm);

  const { rows } = await db.query(`SELECT canonical_name, provider FROM strength_exercises ORDER BY canonical_name;`);
  assert.deepEqual(rows.map((r) => r.canonical_name), ["elevacion de gemelo sentado", "press banca"]);
  assert.ok(rows.every((r) => r.provider === "custom"), "lo que ya existía es del atleta");
  await db.close();
});

/* El snapshot nutricional es lo que hace reproducible el historial: si mañana
   corrigen la ficha de ese producto en Open Food Facts, lo que comiste hace
   tres meses no debe cambiar. */
test("el consumo guarda un snapshot, y un macro desconocido queda en NULL", async () => {
  const db = await baseMigrada();
  const { rows: u } = await db.query(`INSERT INTO users(email) VALUES('come@test') RETURNING id;`);
  const { rows: p } = await db.query(`INSERT INTO athlete_profiles(user_id) VALUES($1) RETURNING id;`, [u[0].id]);

  await db.query(
    `INSERT INTO consumed_foods (athlete_profile_id, fecha, nombre, gramos, kcal, proteina_g, fibra_g)
     VALUES ($1, '2026-08-15', 'Yogur griego', 150, 154.5, 8.7, NULL);`, [p[0].id]);

  const { rows } = await db.query(`SELECT * FROM consumed_foods;`);
  assert.equal(Number(rows[0].kcal), 154.5);
  assert.equal(rows[0].fibra_g, null, "lo que no se sabe se guarda como NULL, no como 0");
  assert.equal(rows[0].provider, "openfoodfacts");
  assert.equal(rows[0].tipo, "alimento");
  await db.close();
});

test("una cantidad imposible no llega a guardarse", async () => {
  const db = await baseMigrada();
  const { rows: u } = await db.query(`INSERT INTO users(email) VALUES('x@test') RETURNING id;`);
  const { rows: p } = await db.query(`INSERT INTO athlete_profiles(user_id) VALUES($1) RETURNING id;`, [u[0].id]);

  for (const gramos of [0, -10, 9000]) {
    await assert.rejects(
      () => db.query(`INSERT INTO consumed_foods (athlete_profile_id, fecha, nombre, gramos)
                      VALUES ($1, '2026-08-15', 'X', $2);`, [p[0].id, gramos]),
      /gramos_check/, `${gramos} g debería rechazarse`,
    );
  }
  await db.close();
});

test("un proveedor de ejercicios desconocido se rechaza en la base", async () => {
  const db = await baseMigrada();
  await assert.rejects(
    () => db.query(`INSERT INTO strength_exercises (nombre, provider) VALUES ('X', 'inventado');`),
    /provider_check/,
  );
  await db.close();
});

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
  for (const file of migrationFiles.slice(0, migrationFiles.indexOf("0010_weekly_planning.js"))) {
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

test("0011 desactiva evidencia no confirmable y versiona cambios del contexto", async () => {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  const pgm = { sql: (statement) => db.exec(statement) };
  const cutoff = migrationFiles.indexOf("0011_planning_and_evidence_integrity.js");
  for (const file of migrationFiles.slice(0, cutoff)) {
    const migration = await import("./migrations/" + file);
    await migration.up(pgm);
  }
  const users = await db.query("INSERT INTO users(email) VALUES('integrity@test') RETURNING id;");
  const profiles = await db.query(
    "INSERT INTO athlete_profiles(user_id) VALUES($1) RETURNING id;",
    [users.rows[0].id],
  );
  const pdf = await db.query(
    "INSERT INTO documents(titulo,origen,revisado) VALUES('PDF autoaprobado','pdf',true) RETURNING id;",
  );
  await db.query(
    "INSERT INTO document_chunks(document_id,chunk_index,seccion,texto) VALUES($1,0,'results','Texto verificable');",
    [pdf.rows[0].id],
  );
  const manual = await db.query(
    "INSERT INTO documents(titulo,origen,revisado) VALUES('Ficha sola','manual',true) RETURNING id;",
  );

  const migration = await import("./migrations/0011_planning_and_evidence_integrity.js");
  await migration.up(pgm);
  const reviewState = await db.query("SELECT titulo,revisado FROM documents ORDER BY titulo;");
  assert.deepEqual(reviewState.rows, [
    { titulo: "Ficha sola", revisado: false },
    { titulo: "PDF autoaprobado", revisado: false },
  ]);
  await assert.rejects(
    () => db.query("UPDATE documents SET revisado=true WHERE id=$1;", [manual.rows[0].id]),
    /sin fragmentos|23514/i,
  );
  await db.query(
    "INSERT INTO document_chunks(document_id,chunk_index,seccion,texto) VALUES($1,0,'abstract','Texto real');",
    [manual.rows[0].id],
  );
  await db.query("UPDATE documents SET revisado=true WHERE id=$1;", [manual.rows[0].id]);
  await db.query("DELETE FROM document_chunks WHERE document_id=$1;", [manual.rows[0].id]);
  const afterDelete = await db.query("SELECT revisado FROM documents WHERE id=$1;", [manual.rows[0].id]);
  assert.equal(afterDelete.rows[0].revisado, false);

  const before = await db.query(
    "SELECT planning_context_version FROM athlete_profiles WHERE id=$1;",
    [profiles.rows[0].id],
  );
  assert.equal(Number(before.rows[0].planning_context_version), 0);
  await db.query(
    "INSERT INTO feedback_logs(athlete_profile_id,fecha,dolor) VALUES($1,'2026-08-14',3);",
    [profiles.rows[0].id],
  );
  const after = await db.query(
    "SELECT planning_context_version FROM athlete_profiles WHERE id=$1;",
    [profiles.rows[0].id],
  );
  assert.equal(Number(after.rows[0].planning_context_version), 1);
  await db.close();
});
