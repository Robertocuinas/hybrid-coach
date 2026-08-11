import { pool, insertRow } from "./_helpers.js";

/* Mapeo casi 1:1 de perfilSemilla() en src/HybridCoach.jsx — ver docs/03-modelo-datos.md §2. */
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
