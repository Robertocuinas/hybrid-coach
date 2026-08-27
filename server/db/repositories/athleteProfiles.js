import { pool, insertRow } from "./_helpers.js";

/* Mapeo del cuestionario de perfil del frontend — ver docs/03-modelo-datos.md §2. */
const CAMPOS_PERFIL = [
  "nombre", "edad", "sexo", "altura_cm", "peso_kg", "grasa_pct",
  "distancia_objetivo", "fecha_carrera", "meta_tipo", "meta_tiempo", "prioridades",
  "exp_carrera", "km_semana", "sesiones_carrera", "tirada_larga_min", "ritmo_comodo",
  "paron", "superficie", "exp_fuerza", "equipamiento", "cargas", "tecnica",
  "estructural", "cirugias", "banderas", "momento_entreno", "cross_training",
  "horas_sueno", "calidad_sueno", "estres", "trabajo", "nutricion_objetivo",
  "suplementos", "reloj",
];

export function createProfile(userId, datos = {}) {
  const fila = { user_id: userId };
  for (const campo of CAMPOS_PERFIL) if (campo in datos) fila[campo] = datos[campo];
  return insertRow("athlete_profiles", fila);
}

export async function findProfileById(id) {
  const { rows } = await pool.query(`SELECT * FROM athlete_profiles WHERE id = $1;`, [id]);
  return rows[0] || null;
}

export async function findOwnedProfile(id, userId, db = pool) {
  const { rows } = await db.query(
    `SELECT * FROM athlete_profiles WHERE id = $1 AND user_id = $2;`,
    [id, userId]
  );
  return rows[0] || null;
}

export async function listProfilesByUser(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM athlete_profiles WHERE user_id = $1 ORDER BY created_at;`,
    [userId]
  );
  return rows;
}

export async function updateProfile(id, cambios = {}) {
  const campos = Object.keys(cambios).filter((c) => CAMPOS_PERFIL.includes(c));
  if (!campos.length) return findProfileById(id);
  const set = campos.map((c, i) => `${c} = $${i + 2}`).join(", ");
  const valores = campos.map((c) => cambios[c]);
  const { rows } = await pool.query(
    `UPDATE athlete_profiles SET ${set}, updated_at = now() WHERE id = $1 RETURNING *;`,
    [id, ...valores]
  );
  return rows[0] || null;
}

export function addInjury(profileId, { zona, recurrente = false, contexto = null, activa = true }) {
  return insertRow("injuries", { athlete_profile_id: profileId, zona, recurrente, contexto, activa });
}

export async function listActiveInjuries(profileId) {
  const { rows } = await pool.query(
    `SELECT * FROM injuries WHERE athlete_profile_id = $1 AND activa = true ORDER BY created_at DESC;`,
    [profileId]
  );
  return rows;
}

/* Disponibilidad semanal del atleta (tabla `availability`).
 *
 *   Qué guarda: una sola fila "vigente" por atleta con la disponibilidad que
 *   rige desde `vigente_desde` (fecha). Sus columnas:
 *     - athlete_profile_id : dueño de la disponibilidad.
 *     - vigente_desde      : fecha de inicio de esta disponibilidad (la más
 *                            reciente <= hoy es la que aplica).
 *     - dias               : int[] con los índices de día disponibles, 0=lunes
 *                            … 6=domingo. Es lo que consume el planificador para
 *                            encajar la semana (nunca se inventa fuera de aquí).
 *     - min_gym / min_run / min_finde : minutos mínimos estimados de fuerza,
 *                            carrera y fin de semana, respectivamente, para que
 *                            la propuesta adaptive respete el tiempo real.
 *
 *   No es un histórico: getCurrentAvailability devuelve la fila vigente
 *   (vigente_desde <= hoy, la más reciente). setAvailability inserta una fila
 *   nueva; quien lea debe quedarse con la vigente, no acumular. El motor
 *   determinista y el orquestador IA la usan solo como SUGERENCIA de días:
 *   el plan recomienda, nunca excluye (CLAUDE.md §4.10), así que registrar una
 *   sesión sigue siendo siempre posible aunque caiga fuera de `dias`. */
export function setAvailability(profileId, { vigenteDesde, dias, minGym, minRun, minFinde }) {
  return insertRow("availability", {
    athlete_profile_id: profileId,
    vigente_desde: vigenteDesde,
    dias,
    min_gym: minGym,
    min_run: minRun,
    min_finde: minFinde,
  });
}

export async function getCurrentAvailability(profileId) {
  const { rows } = await pool.query(
    `SELECT * FROM availability WHERE athlete_profile_id = $1 ORDER BY vigente_desde DESC LIMIT 1;`,
    [profileId]
  );
  return rows[0] || null;
}
