import pkg from "pg";
const { Pool, types } = pkg;

/* Una columna `date` es un día del calendario, no un instante. node-pg la
   convierte por defecto a un Date de JavaScript interpretado en la zona horaria
   del proceso, y al serializar a JSON sale como instante UTC. En España
   (UTC+1/+2) eso significaba que un entrenamiento registrado el 25 volvía de la
   API como "2026-12-24T23:00:00.000Z": el día anterior. El usuario registraba
   una tirada el viernes y la aplicación se la pintaba el jueves.

   El resto del sistema ya trata las fechas como cadenas "YYYY-MM-DD" (helper
   `iso()` en el cliente, `src/agenda.js` entero), así que lo coherente es que la
   capa de datos devuelva exactamente eso y no un instante con zona horaria.
   1082 es el OID del tipo `date` en PostgreSQL. */
types.setTypeParser(1082, (valor) => valor);

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
