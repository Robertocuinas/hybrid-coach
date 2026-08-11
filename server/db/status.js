import pool from "./pool.js";

/* /api/estado debe reflejar la base de datos real, no solo si la variable de
   entorno existe: un DATABASE_URL mal escrito o una BD caída deben verse en false. */
export async function checkDatabaseStatus() {
  if (!process.env.DATABASE_URL) return { db: false, pgvector: false };

  try {
    const { rows } = await pool.query(
      "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS pgvector;"
    );
    return { db: true, pgvector: rows[0]?.pgvector === true };
  } catch {
    return { db: false, pgvector: false };
  }
}
