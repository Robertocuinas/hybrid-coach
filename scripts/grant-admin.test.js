import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { listAdmins, setUserRole } from "./grant-admin.js";

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE NOT NULL,
      role text NOT NULL DEFAULT 'athlete',
      CONSTRAINT users_role_check CHECK (role IN ('athlete','admin'))
    );`);
  await db.query(`INSERT INTO users(email) VALUES('atleta@test'),('otro@test');`);
  return db;
}

test("concede y retira el rol de administrador", async () => {
  const db = await database();

  const concedido = await setUserRole("atleta@test", "admin", db);
  assert.equal(concedido.role, "admin");
  assert.deepEqual((await listAdmins(db)).map((a) => a.email), ["atleta@test"]);

  const retirado = await setUserRole("atleta@test", "athlete", db);
  assert.equal(retirado.role, "athlete");
  assert.deepEqual(await listAdmins(db), []);
  await db.close();
});

/* El correo se teclea a mano contra producción: que las mayúsculas o un espacio
   al pegar impidan encontrar la cuenta sería una trampa innecesaria. */
test("el correo no distingue mayúsculas ni espacios alrededor", async () => {
  const db = await database();
  const usuario = await setUserRole("  Atleta@TEST  ", "admin", db);
  assert.equal(usuario.email, "atleta@test");
  await db.close();
});

/* Un correo mal escrito tiene que fallar de forma visible. Si el script crease
   la cuenta que falta, un dedazo dejaría un admin fantasma que nadie recuerda
   haber creado y que no aparece en ninguna revisión de accesos. */
test("un correo inexistente falla y no crea ninguna cuenta", async () => {
  const db = await database();
  await assert.rejects(
    () => setUserRole("nadie@test", "admin", db),
    /No existe ninguna cuenta/,
  );
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM users;`);
  assert.equal(rows[0].n, 2, "no se ha creado ningún usuario");
  await db.close();
});

test("solo se aceptan los roles que la base permite", async () => {
  const db = await database();
  await assert.rejects(() => setUserRole("atleta@test", "superadmin", db), /Rol no válido/);
  await assert.rejects(() => setUserRole("", "admin", db), /Falta el correo/);
  await db.close();
});
