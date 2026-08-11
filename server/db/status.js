export async function checkDatabaseStatus() {
  if (!process.env.DATABASE_URL) return { db: false, pgvector: false };

  const pgvector = process.env.PGVECTOR_ENABLED === "true";
  return { db: true, pgvector };
}

export async function hasDatabaseConnection() {
  const pkg = await import("pg");
  const { Pool } = pkg;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();
    client.release();
    await pool.end();
    return true;
  } catch {
    await pool.end();
    return false;
  }
}
