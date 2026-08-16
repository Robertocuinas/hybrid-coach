import { pool, insertRow } from "./_helpers.js";

/* El objetivo de un día es un ESTADO, no un historial: recalcularlo debe
   sustituir la fila de esa fecha, no acumular una nueva. Sin esto, abrir la
   pantalla de nutrición diez veces dejaba diez filas del mismo día y cualquier
   consulta tenía que adivinar cuál era la buena.

   Se hace con UPDATE y, si no afectó a nada, INSERT: no hay índice único
   sobre (perfil, fecha) y añadirlo ahora fallaría en instalaciones que ya
   arrastren duplicados. */
export async function setNutritionTarget(profileId, datos = {}, db = pool) {
  const valores = {
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
  };
  const columnas = Object.keys(valores);
  const asignaciones = columnas.map((c, i) => `${c} = $${i + 3}`).join(", ");

  const actualizado = await db.query(
    `UPDATE nutrition_targets SET ${asignaciones}
      WHERE athlete_profile_id = $1 AND fecha = $2 RETURNING *;`,
    [profileId, datos.fecha, ...columnas.map((c) => valores[c])]
  );
  if (actualizado.rows[0]) return actualizado.rows[0];

  return insertRow("nutrition_targets", {
    athlete_profile_id: profileId, fecha: datos.fecha, ...valores,
  }, "*", db);
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
