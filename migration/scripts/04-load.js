/* Paso 04 — carga en PostgreSQL. Todo en una transacción y todo idempotente:
   reejecutarlo no duplica filas (docs/06-migracion.md §1). La idempotencia se
   apoya en que los UUID los fija el paso 03 y se conservan en
   migration/transformed/migration.json — mientras ese fichero no se
   regenere, recargar produce exactamente las mismas filas.

   ON CONFLICT (id) DO UPDATE, no DO NOTHING: si se corrige un dato en el
   paso 03 y se recarga, la corrección debe llegar a la base de datos. */
import { Client } from "pg";
import { TRANSFORMED_FILE, readJson, logStep } from "./lib/util.js";

const EMAIL_INICIAL = process.env.MIGRATION_USER_EMAIL || "atleta@hybridcoach.local";

function cols(obj, keys) { return keys.map((k) => obj[k] ?? null); }

async function upsert(client, tabla, filas, columnas) {
  if (!filas.length) return 0;
  const listaCols = columnas.join(", ");
  const updateSet = columnas.filter((c) => c !== "id").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  for (const fila of filas) {
    const placeholders = columnas.map((_, i) => `$${i + 1}`).join(", ");
    await client.query(
      `INSERT INTO ${tabla} (${listaCols}) VALUES (${placeholders})
       ON CONFLICT (id) DO UPDATE SET ${updateSet};`,
      cols(fila, columnas)
    );
  }
  console.log(`  ${tabla}: ${filas.length}`);
  return filas.length;
}

export async function run() {
  logStep("04 · load");
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL.");

  const data = await readJson(TRANSFORMED_FILE);
  const esLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: esLocal ? false : { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query("BEGIN");

    /* legacy_id_map es temporal: existe solo mientras dura la migración y se
       borra al cerrar la Fase 3 (docs/03-modelo-datos.md §9). Por eso se crea
       aquí y no en una migración de esquema. */
    await client.query(`CREATE TABLE IF NOT EXISTS legacy_id_map (
      source text NOT NULL,
      tabla text NOT NULL,
      old_id text NOT NULL,
      new_id uuid NOT NULL,
      PRIMARY KEY (source, tabla, old_id)
    );`);

    /* No hay autenticación real todavía (Fase 3): se crea un único usuario
       propietario al que cuelgan todos los perfiles migrados. */
    const { rows: [usuario] } = await client.query(
      `INSERT INTO users (email, role) VALUES ($1, 'athlete')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id;`,
      [EMAIL_INICIAL]
    );
    console.log(`  users: 1 (${EMAIL_INICIAL})`);

    for (const p of data.athlete_profiles) p.user_id = usuario.id;

    await upsert(client, "athlete_profiles", data.athlete_profiles, [
      "id", "user_id", "nombre", "edad", "sexo", "altura_cm", "peso_kg", "grasa_pct",
      "distancia_objetivo", "fecha_carrera", "meta_tipo", "meta_tiempo", "prioridades",
      "exp_carrera", "km_semana", "sesiones_carrera", "tirada_larga_min", "ritmo_comodo",
      "paron", "superficie", "exp_fuerza", "equipamiento", "cargas", "tecnica", "estructural",
      "cirugias", "banderas", "momento_entreno", "cross_training", "horas_sueno",
      "calidad_sueno", "estres", "trabajo", "nutricion_objetivo", "suplementos", "reloj",
    ]);
    await upsert(client, "injuries", data.injuries, ["id", "athlete_profile_id", "zona", "recurrente", "contexto", "activa"]);
    await upsert(client, "availability", data.availability, ["id", "athlete_profile_id", "vigente_desde", "dias", "min_gym", "min_run", "min_finde"]);
    await upsert(client, "training_plans", data.training_plans, [
      "id", "athlete_profile_id", "version", "distancia_objetivo", "fecha_carrera", "total_semanas",
      "taper_semanas", "run_dias", "gym_dias", "techo_tirada_larga_min", "riesgo_score", "riesgo_causas", "activo",
    ]);
    await upsert(client, "strength_exercises", data.strength_exercises, ["id", "nombre", "grupo_muscular", "patron", "incremento_kg_default", "athlete_profile_id"]);
    await upsert(client, "completed_sessions", data.completed_sessions, ["id", "athlete_profile_id", "planned_session_id", "fecha", "tipo", "semana"]);
    await upsert(client, "running_sessions", data.running_sessions, [
      "id", "completed_session_id", "codigo_sesion", "distancia_km", "duracion_min", "ritmo",
      "fc_media", "fc_max", "desnivel", "cadencia", "rpe", "dolor", "notas", "origen", "external_id",
    ]);
    await upsert(client, "strength_sessions", data.strength_sessions, ["id", "completed_session_id", "codigo_sesion"]);
    await upsert(client, "strength_sets", data.strength_sets, ["id", "strength_session_id", "strength_exercise_id", "orden", "peso_kg", "reps", "rir", "notas"]);
    await upsert(client, "feedback_logs", data.feedback_logs, [
      "id", "athlete_profile_id", "fecha", "semana", "rpe", "sensacion", "dolor",
      "zona_dolor", "tipo_dolor", "cuando_aparece", "energia", "comentario",
    ]);
    await upsert(client, "plan_modifications", data.plan_modifications, ["id", "athlete_profile_id", "fecha", "semana", "plan_original", "cambio", "motivo", "origen"]);
    await upsert(client, "documents", data.documents, [
      "id", "titulo", "autores", "anio", "fuente_revista", "doi", "study_type", "evidence_grade",
      "poblacion", "population_type", "sample_size", "tema_principal", "tags", "resumen",
      "limites", "aplicacion_practica", "storage_key", "origen", "revisado",
    ]);
    await upsert(client, "meal_catalog", data.meal_catalog, ["id", "athlete_profile_id", "categoria", "opcion"]);
    await upsert(client, "conversations", data.conversations, ["id", "athlete_profile_id", "titulo", "iniciada_en", "ultimo_mensaje_en"]);
    await upsert(client, "messages", data.messages, ["id", "conversation_id", "role", "contenido", "cambio_propuesto", "citas", "created_at"]);

    /* recovery_logs tiene índice único (athlete_profile_id, fecha) además de
       la PK: un mismo día recargado debe actualizar, no chocar. */
    for (const r of data.recovery_logs) {
      await client.query(
        `INSERT INTO recovery_logs (id, athlete_profile_id, fecha, horas_sueno, calidad_sueno, fatiga, agujetas, estres, motivacion, dolor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (athlete_profile_id, fecha) DO UPDATE SET
           horas_sueno = EXCLUDED.horas_sueno, calidad_sueno = EXCLUDED.calidad_sueno,
           fatiga = EXCLUDED.fatiga, agujetas = EXCLUDED.agujetas, estres = EXCLUDED.estres,
           motivacion = EXCLUDED.motivacion, dolor = EXCLUDED.dolor;`,
        cols(r, ["id", "athlete_profile_id", "fecha", "horas_sueno", "calidad_sueno", "fatiga", "agujetas", "estres", "motivacion", "dolor"])
      );
    }
    if (data.recovery_logs.length) console.log(`  recovery_logs: ${data.recovery_logs.length}`);

    for (const m of data.legacy_id_map) {
      await client.query(
        `INSERT INTO legacy_id_map (source, tabla, old_id, new_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT (source, tabla, old_id) DO UPDATE SET new_id = EXCLUDED.new_id;`,
        [m.source, m.table, m.legacy_id, m.new_id]
      );
    }
    if (data.legacy_id_map.length) console.log(`  legacy_id_map: ${data.legacy_id_map.length}`);

    await client.query("COMMIT");
    console.log("\nCarga completada. Ejecuta el paso 05 para verificar.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
