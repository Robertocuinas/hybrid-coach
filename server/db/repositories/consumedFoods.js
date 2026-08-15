import { pool, insertRow } from "./_helpers.js";

/* Registro de lo consumido. Los macros llegan ya calculados por
   `macrosPara()`: aquí no se hace aritmética nutricional, solo se persiste el
   snapshot con su procedencia. */
export function registrarConsumo(profileId, {
  fecha, momento = null, provider = "openfoodfacts", externalId = null,
  nombre, marca = null, gramos, macros = {}, tipo = "alimento",
}, db = pool) {
  return insertRow("consumed_foods", {
    athlete_profile_id: profileId,
    fecha,
    momento,
    provider,
    external_id: externalId,
    nombre,
    marca,
    gramos,
    /* `?? null` y no `|| 0`: un macro desconocido se guarda como NULL para que
       el total sepa que le falta un dato en vez de sumar un cero. */
    kcal: macros.kcal ?? null,
    proteina_g: macros.proteina ?? null,
    carbohidrato_g: macros.carbohidrato ?? null,
    grasa_g: macros.grasa ?? null,
    fibra_g: macros.fibra ?? null,
    tipo,
  }, "*", db);
}

export async function listarConsumoDelDia(profileId, fecha, db = pool) {
  const { rows } = await db.query(
    `SELECT * FROM consumed_foods
      WHERE athlete_profile_id = $1 AND fecha = $2
      ORDER BY creado_en;`,
    [profileId, fecha]
  );
  return rows;
}

/* El perfil va en el WHERE, no se comprueba antes: un registro de otro atleta
   no se puede borrar ni conociendo su id. */
export async function borrarConsumo(id, profileId, db = pool) {
  const { rows } = await db.query(
    `DELETE FROM consumed_foods WHERE id = $1 AND athlete_profile_id = $2 RETURNING id;`,
    [id, profileId]
  );
  return rows.length > 0;
}
