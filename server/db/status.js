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
  } catch (error) {
    /* El motivo se registra pero NO se devuelve al cliente: /health/ready y
       /api/estado son públicos y el mensaje de pg puede incluir host y usuario.
       Tragarse el error del todo dejaba un 503 sin ninguna pista en los logs,
       que es exactamente lo que impide diagnosticar una caída en Railway. */
    console.error("[db] comprobación de estado fallida:", error.code || error.name, describirErrorDb(error));
    return { db: false, pgvector: false, motivo: error.code || error.name || "error" };
  }
}

/* Mismo criterio que el trabajo de conciliación: se conserva host y ruta para
   poder diagnosticar, nunca la contraseña ni la URL completa. */
export function describirErrorDb(error, env = process.env) {
  let message = String(error?.message || error?.name || "Error desconocido");
  if (env.DATABASE_URL) message = message.split(env.DATABASE_URL).join("[DATABASE_URL]");
  message = message.replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/gi, "$1***@");
  return message.replace(/[\r\n]+/g, " ").slice(0, 300);
}
