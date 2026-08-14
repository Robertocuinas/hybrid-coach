import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { compareSnapshotTimes, replaceProfileState } from "./sync.js";

test("una instantánea antigua nunca sustituye a otra más reciente", () => {
  assert.deepEqual(compareSnapshotTimes("2026-08-12T10:00:00Z", "2026-08-12T11:00:00Z"), { valid: true, newer: false });
  assert.deepEqual(compareSnapshotTimes("2026-08-12T12:00:00Z", "2026-08-12T11:00:00Z"), { valid: true, newer: true });
  assert.deepEqual(compareSnapshotTimes("fecha rota", null), { valid: false, newer: false });
});

test("un snapshot persiste perfil completo, disponibilidad, lesiones, plan maestro y actividad", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TYPE running_origen AS ENUM ('manual','strava');
    CREATE TABLE athlete_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text, edad int, sexo text,
      altura_cm int, peso_kg numeric, grasa_pct numeric, distancia_objetivo text, fecha_carrera date,
      meta_tipo text, meta_tiempo text, prioridades text[], exp_carrera text, km_semana int,
      sesiones_carrera int, tirada_larga_min int, ritmo_comodo text, paron text, superficie text[],
      exp_fuerza text, equipamiento text, cargas jsonb, tecnica text, estructural text[], cirugias text,
      banderas text[], momento_entreno text, cross_training text, horas_sueno numeric, calidad_sueno text,
      estres numeric, trabajo text, nutricion_objetivo text, suplementos text[], reloj text,
      current_complaints jsonb NOT NULL DEFAULT '[]'::jsonb, updated_at timestamptz DEFAULT now());
    CREATE TABLE injuries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid,
      zona text, recurrente boolean, contexto text, activa boolean DEFAULT true);
    CREATE TABLE availability (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid,
      vigente_desde date, dias int[], min_gym int, min_run int, min_finde int);
    CREATE TABLE training_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid,
      version int NOT NULL DEFAULT 1, distancia_objetivo text, fecha_carrera date, total_semanas int,
      taper_semanas int, run_dias int, gym_dias int, techo_tirada_larga_min int, riesgo_score numeric,
      riesgo_causas jsonb, activo boolean, structure_hash text, generado_en timestamptz DEFAULT now());
    CREATE TABLE training_weeks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), training_plan_id uuid,
      numero_semana int, inicio date, fase text, techo_tirada_larga_min int, es_deload boolean,
      es_taper boolean, checkpoint text, UNIQUE(training_plan_id,numero_semana));
    CREATE TABLE planned_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), training_week_id uuid,
      dia_semana int, codigo_sesion text, tipo text, descripcion text, duracion_min int, intensidad text,
      UNIQUE(training_week_id,codigo_sesion));
    CREATE TABLE completed_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid,
      planned_session_id uuid, fecha date, tipo text, semana int, created_at timestamptz DEFAULT now());
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
  const snapshot = { capturedAt: "2026-08-14T10:00:00Z", profile: {
    id: "local-1", nombre: "Atleta", perfil: {
      nombre: "Atleta", edad: 34, sexo: "Hombre", altura: 178, peso: 74.5, grasa: 13.2,
      distancia: "Media maratón", fechaCarrera: "2026-10-18", metaTipo: "Tiempo", metaTiempo: "01:35:00",
      prioridad: ["Rendimiento en carrera", "Fuerza"], expCarrera: "1-3 años", kmSemana: 28,
      sesionesCarrera: 3, tiradaLarga: 90, ritmoComodo: "5:30", paron: "Ninguno",
      superficie: ["Asfalto", "Pista"], expFuerza: "1-3 años", equipamiento: "Gimnasio completo",
      cargas: { sentadilla: 80 }, tecnica: "Intermedia", estructural: ["Tobillo rígido"],
      cirugias: "Ninguna", banderas: ["vigilar Aquiles"], momento: "Tarde", crossTraining: "Bicicleta",
      sueno: 7.5, calidadSueno: "Buena", estres: 4, trabajo: "Oficina", nutricion: "Rendimiento",
      suplementos: ["Creatina"], reloj: "Garmin", dias: [1, 3, 5], minGym: 50, minRun: 45, finde: 90,
      lesiones: [{ zona: "Tendón de Aquiles", recurrente: true, contexto: "Carga crónica" }],
      molestias: [{ zona: "Sóleo", intensidad: 3, activa: true }],
    },
    plan: {
      totalSemanas: 10, taper: 1, runDias: 2, gymDias: 2, techo: 90,
      riesgo: { score: 2, causas: ["historial de lesión"] }, gymCodes: ["GYM A", "GYM B"],
      semanas: [{ w: 1, inicio: "2026-08-10", fase: "Base", cp: "Adaptación",
        gym: "carga", deload: false, taper: false,
        runs: { "RUN A": { t: 45, d: "Rodaje fácil" }, "RUN B": { t: 60, d: "Calidad RPE 7" } } }],
    },
    weeks: { 1: { assign: [{ code: "GYM A", day: 1 }, { code: "RUN A", day: 3 },
      { code: "GYM B", day: 4 }, { code: "RUN B", day: 5 }] } },
    running: [{ id: "r1", date: "2026-08-12", semana: 1, session_code: "RUN A",
      distancia_km: 8.5, duracion_min: 45, source: "manual" }],
    strength: [{ id: "s1", date: "2026-08-11", semana: 1, session: "GYM A",
      exercise: "Sentadilla", set: 1, weight: 60, reps: 5 }],
    checkins: [{ date: "2026-08-12", semana: 1, rpe: 6 }], recovery: [],
  }, totals: { runningCount: 1, km: 8.5, strengthSets: 1, kg: 300, checkins: 1 } };
  await replaceProfileState(db, profileId, snapshot);

  const totals = await db.query(`SELECT
    (SELECT sum(distancia_km)::float8 FROM running_sessions) km,
    (SELECT sum(peso_kg*reps)::float8 FROM strength_sets) kg,
    (SELECT count(*)::int FROM feedback_logs) checkins`);
  assert.deepEqual(totals.rows[0], { km: 8.5, kg: 300, checkins: 1 });
  const savedProfile = await db.query(`SELECT nombre,edad,peso_kg::float8 AS peso_kg,prioridades,
    superficie,cargas,estructural,banderas,suplementos,current_complaints FROM athlete_profiles WHERE id=$1`, [profileId]);
  assert.deepEqual(savedProfile.rows[0], {
    nombre: "Atleta", edad: 34, peso_kg: 74.5,
    prioridades: ["Rendimiento en carrera", "Fuerza"], superficie: ["Asfalto", "Pista"],
    cargas: { sentadilla: 80 }, estructural: ["Tobillo rígido"], banderas: ["vigilar Aquiles"],
    suplementos: ["Creatina"], current_complaints: [{ zona: "Sóleo", intensidad: 3, activa: true }],
  });
  const injuries = await db.query(`SELECT zona,recurrente,contexto,activa FROM injuries WHERE athlete_profile_id=$1`, [profileId]);
  assert.deepEqual(injuries.rows, [{ zona: "Tendón de Aquiles", recurrente: true, contexto: "Carga crónica", activa: true }]);
  const availability = await db.query(`SELECT vigente_desde::text,dias,min_gym,min_run,min_finde FROM availability WHERE athlete_profile_id=$1`, [profileId]);
  assert.deepEqual(availability.rows, [{ vigente_desde: "2026-08-14", dias: [1, 3, 5], min_gym: 50, min_run: 45, min_finde: 90 }]);

  const plan = await db.query(`SELECT version,riesgo_causas,structure_hash,activo FROM training_plans`);
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(plan.rows[0].riesgo_causas, ["historial de lesión"]);
  assert.equal(plan.rows[0].version, 1);
  assert.equal(plan.rows[0].structure_hash.length, 64);
  assert.equal(plan.rows[0].activo, true);
  const weeks = await db.query(`SELECT numero_semana,inicio::text,fase,checkpoint FROM training_weeks`);
  assert.deepEqual(weeks.rows, [{ numero_semana: 1, inicio: "2026-08-10", fase: "Base", checkpoint: "Adaptación" }]);
  const planned = await db.query(`SELECT dia_semana,codigo_sesion,tipo,duracion_min,intensidad
    FROM planned_sessions ORDER BY codigo_sesion`);
  assert.deepEqual(planned.rows, [
    { dia_semana: 1, codigo_sesion: "GYM A", tipo: "gym", duracion_min: null, intensidad: "facil" },
    { dia_semana: 4, codigo_sesion: "GYM B", tipo: "gym", duracion_min: null, intensidad: "facil" },
    { dia_semana: 3, codigo_sesion: "RUN A", tipo: "run", duracion_min: 45, intensidad: "facil" },
    { dia_semana: 5, codigo_sesion: "RUN B", tipo: "run", duracion_min: 60, intensidad: "calidad" },
  ]);
  const linked = await db.query(`SELECT tipo,planned_session_id IS NOT NULL AS linked FROM completed_sessions ORDER BY tipo`);
  assert.deepEqual(linked.rows, [{ tipo: "running", linked: true }, { tipo: "strength", linked: true }]);

  await replaceProfileState(db, profileId, snapshot);
  const idempotency = await db.query(`SELECT
    (SELECT count(*)::int FROM training_plans) plans,
    (SELECT count(*)::int FROM training_weeks) weeks,
    (SELECT count(*)::int FROM planned_sessions) sessions,
    (SELECT count(*)::int FROM availability) availabilities`);
  assert.deepEqual(idempotency.rows[0], { plans: 1, weeks: 1, sessions: 4, availabilities: 1 });
  await db.close();
});
