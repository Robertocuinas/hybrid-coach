import { pool, insertRow } from "./_helpers.js";

export function setNutritionTarget(profileId, datos = {}) {
  return insertRow("nutrition_targets", {
    athlete_profile_id: profileId,
    fecha: datos.fecha,
    semana: datos.semana ?? null,
    sesiones: datos.sesiones ?? null,
    min_entreno: datos.minEntreno ?? null,
    kcal: datos.kcal ?? null,
    proteina_g: datos.proteinaG ?? null,
    carbohidrato_g: datos.carbohidratoG ?? null,
    grasa_g: datos.grasaG ?? null,
    fibra_g: datos.fibraG ?? null,
    agua_l: datos.aguaL ?? null,
    momento_entreno: datos.momentoEntreno ?? null,
    fijado_por_usuario: datos.fijadoPorUsuario ?? false,
    recortado_por_suelo: datos.recortadoPorSuelo ?? false,
  });
}

export async function listNutritionTargets(profileId, limit = 30) {
  const { rows } = await pool.query(
    `SELECT * FROM nutrition_targets WHERE athlete_profile_id = $1 ORDER BY fecha DESC LIMIT $2;`,
    [profileId, limit]
  );
  return rows;
}

export function addMealOption(profileId, categoria, opcion) {
  return insertRow("meal_catalog", { athlete_profile_id: profileId, categoria, opcion });
}

export async function listMealCatalog(profileId) {
  const { rows } = await pool.query(
    `SELECT * FROM meal_catalog WHERE athlete_profile_id = $1 ORDER BY categoria;`,
    [profileId]
  );
  return rows;
}
