import pool from "../pool.js";

/* INSERT genérico: `data` siempre lo construye el repositorio (nunca claves que
   vengan directas de una request), así que interpolar sus claves como nombres de
   columna es seguro — los valores sí van parametrizados. */
export async function insertRow(table, data, returning = "*", db = pool) {
  const cols = Object.keys(data);
  const values = Object.values(data);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await db.query(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders}) RETURNING ${returning};`,
    values
  );
  return rows[0];
}

export { pool };
