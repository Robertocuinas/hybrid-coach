import pkg from "pg";
const { Pool } = pkg;

/* La red privada de Railway no necesita TLS entre servicios del mismo proyecto,
   pero cualquier conexión externa (proxy público de Railway, Postgres local con
   sslmode=require) sí. localhost nunca lo necesita. */
const databaseUrl = process.env.DATABASE_URL || "";
const esLocal = /localhost|127\.0\.0\.1/.test(databaseUrl);
const esRailwayPrivado = /\.railway\.internal(?::|\/|$)/.test(databaseUrl);
const databaseSSL = String(process.env.DATABASE_SSL || "auto").trim().toLowerCase();
if (!["auto", "require", "disable"].includes(databaseSSL)) {
  throw new Error("DATABASE_SSL debe ser auto, require o disable");
}

/* Nunca se baja silenciosamente de TLS a texto plano. Algunos templates de
   pgvector publicados detrás del TCP proxy no ofrecen SSL: para una base de
   pruebas se puede habilitar de forma explícita con DATABASE_SSL=disable. */
export function resolveDatabaseSSL({ mode = databaseSSL, local = esLocal, railwayPrivate = esRailwayPrivado } = {}) {
  if (mode === "disable") return false;
  if (mode === "require") return { rejectUnauthorized: false };
  return local || railwayPrivate ? false : { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: databaseUrl || undefined,
  max: Number(process.env.POSTGRES_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: resolveDatabaseSSL(),
});

export default pool;
