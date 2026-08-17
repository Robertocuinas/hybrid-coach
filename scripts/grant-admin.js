/* Concede o retira el rol de administrador.
 *
 * Existe porque no había ninguna forma de crear el primer admin: el alta pública
 * crea siempre `athlete` (users.js), y todo el panel de administración —subir
 * bibliografía, configurar embeddings, ver el diagnóstico del planificador—
 * exige `admin`. Sin esto la única salida era escribir SQL a mano contra
 * producción, que es justo donde se cometen los errores caros.
 *
 * No es una puerta trasera: se ejecuta en el servidor y necesita DATABASE_URL,
 * así que quien puede lanzarlo ya tiene acceso directo a la base. Lo que aporta
 * es que valida la cuenta antes de tocarla y deja claro qué ha cambiado.
 *
 *   npm run admin:grant -- correo@ejemplo.com
 *   npm run admin:grant -- correo@ejemplo.com --revoke
 *   npm run admin:grant -- --list
 */
import { pathToFileURL } from "node:url";
import pool from "../server/db/pool.js";

export const ROLES = Object.freeze(["athlete", "admin"]);

/** Cambia el rol de una cuenta ya existente.
 *
 * Nunca crea la cuenta: un correo mal escrito debe fallar de forma visible, no
 * dejar un usuario admin fantasma que nadie recuerda haber creado.
 */
export async function setUserRole(email, role, db = pool) {
  const correo = String(email || "").trim().toLowerCase();
  if (!correo) throw new Error("Falta el correo de la cuenta");
  if (!ROLES.includes(role)) throw new Error(`Rol no válido: ${role}. Debe ser ${ROLES.join(" o ")}`);

  const { rows } = await db.query(
    `UPDATE users SET role=$2 WHERE lower(email)=$1 RETURNING id, email, role;`,
    [correo, role],
  );
  if (!rows.length) throw new Error(`No existe ninguna cuenta con el correo ${correo}`);
  return rows[0];
}

export async function listAdmins(db = pool) {
  const { rows } = await db.query(
    `SELECT email, role FROM users WHERE role='admin' ORDER BY email;`,
  );
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");
  const list = args.includes("--list");
  const email = args.find((a) => !a.startsWith("--"));

  if (list) {
    const admins = await listAdmins();
    console.log(admins.length
      ? `Administradores (${admins.length}):\n${admins.map((a) => `  ${a.email}`).join("\n")}`
      : "No hay ninguna cuenta con rol admin.");
    return 0;
  }
  if (!email) {
    console.error("Uso: npm run admin:grant -- correo@ejemplo.com [--revoke]\n     npm run admin:grant -- --list");
    return 1;
  }

  const usuario = await setUserRole(email, revoke ? "athlete" : "admin");
  console.log(`${usuario.email} pasa a rol ${usuario.role}.`);
  /* La sesión abierta sigue con el rol viejo: `req.auth.role` sale del JOIN con
     users en cada petición (sessions.js), así que basta con recargar. Se dice
     porque si no parece que el cambio no ha surtido efecto. */
  if (!revoke) console.log("Recarga la aplicación para que la sesión abierta vea el cambio.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(async (codigo) => { await pool.end().catch(() => {}); process.exitCode = codigo; })
    .catch(async (error) => {
      console.error(error.message);
      await pool.end().catch(() => {});
      process.exitCode = 1;
    });
}
