import pkg from "pg";
const { Pool } = pkg;

/* La red privada de Railway no necesita TLS entre servicios del mismo proyecto,
   pero cualquier conexión externa (proxy público de Railway, Postgres local con
   sslmode=require) sí. localhost nunca lo necesita. */
const databaseUrl = process.env.DATABASE_URL || "";
const esLocal = /localhost|127\.0\.0\.1/.test(databaseUrl);
const esRailwayPrivado = /\.railway\.internal(?::|\/|$)/.test(databaseUrl);

const pool = new Pool({
  connectionString: databaseUrl || undefined,
  max: Number(process.env.POSTGRES_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: esLocal || esRailwayPrivado ? false : { rejectUnauthorized: false },
});

export default pool;
