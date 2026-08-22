/* Base de datos local efímera para desarrollo y auditoría end-to-end.
 *
 * Levanta PGlite (Postgres compilado a WASM) con pgvector y pgcrypto y lo
 * expone por el protocolo de cable de PostgreSQL, de modo que `pg` —y por tanto
 * el servidor entero, sin cambiar una línea— se conecta como a un Postgres real.
 *
 *   node scripts/dev-db.js            # datos en memoria, se pierden al parar
 *   node scripts/dev-db.js --dir=.tmp-devdb --port=5433
 *
 * No sustituye a Railway ni a un Postgres de verdad: es la forma de arrancar la
 * aplicación completa en un portátil sin instalar nada.
 */
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const arg = (nombre, porDefecto) => {
  const encontrado = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.split("=").slice(1).join("=") : porDefecto;
};

const port = Number(arg("port", 5433));
const dataDir = arg("dir", "");

const db = await PGlite.create({
  ...(dataDir ? { dataDir } : {}),
  extensions: { vector, pgcrypto },
});
await db.waitReady;

const server = new PGLiteSocketServer({
  db,
  port,
  host: "127.0.0.1",
  /* PGlite ejecuta una consulta cada vez y el servidor las encola por su
     cuenta, pero por defecto solo admite UNA conexión abierta: con eso el
     pool de `pg` deja fuera a las demás y node-pg-migrate falla con
     ECONNRESET. Las conexiones se permiten; la serialización la sigue
     haciendo la cola de consultas. */
  maxConnections: Number(arg("max", 20)),
  debug: process.argv.includes("--debug"),
});

await server.start();

console.log(`[dev-db] PostgreSQL (PGlite) escuchando en 127.0.0.1:${port}`);
console.log(`[dev-db] almacenamiento: ${dataDir || "memoria"}`);
console.log("[dev-db] DATABASE_URL=postgres://postgres:postgres@127.0.0.1:" + port + "/postgres");

const parar = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", parar);
process.on("SIGTERM", parar);
