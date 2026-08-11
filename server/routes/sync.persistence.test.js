import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { replaceProfileState } from "./sync.js";

test("un snapshot del frontend persiste km, kg y check-ins en PostgreSQL", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TYPE running_origen AS ENUM ('manual','strava');
    CREATE TABLE athlete_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text, edad int, sexo text,
      altura_cm int, peso_kg numeric, grasa_pct numeric, distancia_objetivo text, fecha_carrera date,
      meta_tipo text, meta_tiempo text, prioridades text[], updated_at timestamptz DEFAULT now());
    CREATE TABLE training_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid,
      distancia_objetivo text, fecha_carrera date, total_semanas int, taper_semanas int, run_dias int,
      gym_dias int, techo_tirada_larga_min int, riesgo_score numeric, riesgo_causas jsonb, activo boolean,
      generado_en timestamptz DEFAULT now());
    CREATE TABLE completed_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid,
      fecha date, tipo text, semana int);
    CREATE TABLE running_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), completed_session_id uuid REFERENCES completed_sessions(id) ON DELETE CASCADE,
      codigo_sesion text, distancia_km numeric, duracion_min int, ritmo numeric, fc_media numeric, fc_max numeric,
      desnivel numeric, cadencia numeric, rpe int, dolor int, notas text, origen running_origen, external_id text);
    CREATE TABLE strength_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), completed_session_id uuid REFERENCES completed_sessions(id) ON DELETE CASCADE, codigo_sesion text);
    CREATE TABLE strength_exercises (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text, athlete_profile_id uuid);
    CREATE TABLE strength_sets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), strength_session_id uuid REFERENCES strength_sessions(id) ON DELETE CASCADE,
      strength_exercise_id uuid, orden int, peso_kg numeric, reps int, rir int, notas text);
    CREATE TABLE feedback_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid, fecha date,
      semana int, rpe int, sensacion text, dolor numeric, zona_dolor text, tipo_dolor text, cuando_aparece text, energia numeric, comentario text);
    CREATE TABLE recovery_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid, fecha date,
      horas_sueno numeric, calidad_sueno numeric, fatiga numeric, agujetas numeric, estres numeric, motivacion numeric, dolor numeric);
  `);
  const profile = await db.query(`INSERT INTO athlete_profiles (nombre) VALUES ('Inicial') RETURNING id`);
  const profileId = profile.rows[0].id;
  await replaceProfileState(db, profileId, { profile: {
    id: "local-1", nombre: "Atleta", perfil: { nombre: "Atleta", fechaCarrera: "2026-10-18" },
    plan: { totalSemanas: 10, taper: 1, runDias: 2, gymDias: 2, techo: 90, riesgo: { score: 2, causas: [] } },
    running: [{ id: "r1", date: "2026-08-10", distancia_km: 8.5, duracion_min: 45, source: "manual" }],
    strength: [{ id: "s1", date: "2026-08-10", session: "GYM A", exercise: "Sentadilla", set: 1, weight: 60, reps: 5 }],
    checkins: [{ date: "2026-08-10", rpe: 6 }], recovery: [],
  }, totals: { runningCount: 1, km: 8.5, strengthSets: 1, kg: 300, checkins: 1 } });

  const totals = await db.query(`SELECT
    (SELECT sum(distancia_km)::float8 FROM running_sessions) km,
    (SELECT sum(peso_kg*reps)::float8 FROM strength_sets) kg,
    (SELECT count(*)::int FROM feedback_logs) checkins`);
  assert.deepEqual(totals.rows[0], { km: 8.5, kg: 300, checkins: 1 });
  await db.close();
});
