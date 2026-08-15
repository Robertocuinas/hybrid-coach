import { pool, insertRow } from "./_helpers.js";
import { nombreCanonico } from "../../integrations/exercises/types.js";

export function createCompletedSession(profileId, { plannedSessionId = null, fecha, tipo, semana }, db = pool) {
  return insertRow("completed_sessions", {
    athlete_profile_id: profileId,
    planned_session_id: plannedSessionId,
    fecha,
    tipo,
    semana,
  }, "*", db);
}

/* "Últimos N días" — la consulta más frecuente del sistema, ver docs/03-modelo-datos.md §10. */
export async function listRecentByProfile(profileId, limit = 30) {
  const { rows } = await pool.query(
    `SELECT * FROM completed_sessions WHERE athlete_profile_id = $1 ORDER BY fecha DESC LIMIT $2;`,
    [profileId, limit]
  );
  return rows;
}

export function addRunningDetail(completedSessionId, datos = {}, db = pool) {
  return insertRow("running_sessions", {
    completed_session_id: completedSessionId,
    codigo_sesion: datos.codigoSesion ?? null,
    distancia_km: datos.distanciaKm ?? null,
    duracion_min: datos.duracionMin ?? null,
    ritmo: datos.ritmo ?? null,
    fc_media: datos.fcMedia ?? null,
    fc_max: datos.fcMax ?? null,
    desnivel: datos.desnivel ?? null,
    cadencia: datos.cadencia ?? null,
    rpe: datos.rpe ?? null,
    dolor: datos.dolor ?? null,
    notas: datos.notas ?? null,
    origen: datos.origen ?? "manual",
    external_id: datos.externalId ?? null,
  }, "*", db);
}

export function addStrengthSession(completedSessionId, codigoSesion, db = pool) {
  return insertRow("strength_sessions", { completed_session_id: completedSessionId, codigo_sesion: codigoSesion }, "*", db);
}

export function addStrengthSet(strengthSessionId, exerciseId, { orden, pesoKg, reps, rir = null, notas = null }, db = pool) {
  return insertRow("strength_sets", {
    strength_session_id: strengthSessionId,
    strength_exercise_id: exerciseId,
    orden,
    peso_kg: pesoKg,
    reps,
    rir,
    notas,
  }, "*", db);
}

/* progresionSugerida() necesita la última serie real de cada ejercicio. */
export async function lastSetForExercise(exerciseId) {
  const { rows } = await pool.query(
    `SELECT * FROM strength_sets WHERE strength_exercise_id = $1 ORDER BY created_at DESC LIMIT 1;`,
    [exerciseId]
  );
  return rows[0] || null;
}

/* Resolución de identidad en tres pasos, del más fiable al más laxo:

     1. (provider, external_id) — la identidad del catálogo de origen.
     2. canonical_name          — nombre normalizado, para los propios.
     3. crear.

   El paso 2 es lo que impide que "Press banca", "Press Banca" y "press-banca"
   acaben siendo tres ejercicios con tres historiales de carga separados, que
   es lo que ocurría comparando `nombre` en crudo. */
export async function findOrCreateExercise({
  nombre, grupoMuscular = null, patron = null, incrementoKgDefault = null, profileId = null,
  provider = "custom", externalId = null, target = null, secundarios = null,
  equipamiento = null, bodyPart = null, media = null,
}, db = pool) {
  if (externalId) {
    const { rows } = await db.query(
      `SELECT * FROM strength_exercises WHERE provider = $1 AND external_id = $2;`,
      [provider, externalId]
    );
    if (rows[0]) return rows[0];
  }

  const canonico = nombreCanonico(nombre);
  const { rows } = await db.query(
    `SELECT * FROM strength_exercises
      WHERE canonical_name = $1 AND athlete_profile_id IS NOT DISTINCT FROM $2
      ORDER BY external_id NULLS LAST LIMIT 1;`,
    [canonico, profileId]
  );
  if (rows[0]) return rows[0];

  return insertRow("strength_exercises", {
    nombre,
    canonical_name: canonico,
    provider,
    external_id: externalId,
    grupo_muscular: grupoMuscular,
    patron,
    incremento_kg_default: incrementoKgDefault,
    athlete_profile_id: profileId,
    target,
    secondary_muscles: secundarios,
    equipment: equipamiento,
    body_part: bodyPart,
    media_url: media,
    last_synced: externalId ? new Date() : null,
  }, "*", db);
}

export function addRoutineEntry(profileId, { codigoSesion, orden, exerciseId, series, reps, rir = null, prioritario = false, nota = null, origen = "generada" }, db = pool) {
  return insertRow("routines", {
    athlete_profile_id: profileId,
    codigo_sesion: codigoSesion,
    orden,
    strength_exercise_id: exerciseId,
    series,
    reps,
    rir,
    prioritario,
    nota,
    origen,
  }, "*", db);
}

export async function listRoutines(profileId) {
  const { rows } = await pool.query(
    `SELECT r.*, e.nombre AS ejercicio_nombre
       FROM routines r JOIN strength_exercises e ON e.id = r.strength_exercise_id
      WHERE r.athlete_profile_id = $1
      ORDER BY r.codigo_sesion, r.orden;`,
    [profileId]
  );
  return rows;
}
