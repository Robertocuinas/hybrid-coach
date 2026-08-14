import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { obtenerOCrearConversacion, tituloDesdeConsulta } from "./conversacion.js";
import { deleteConversation } from "../../db/repositories/aiConversations.js";

/* Esquema mínimo: solo las dos tablas que tocan estas pruebas, con el mismo
   ON DELETE CASCADE del esquema real para poder comprobar que borrar una
   conversación se lleva sus mensajes. */
async function baseDeDatos() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE TABLE athlete_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text);
    CREATE TABLE conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
      titulo text, resumen text, iniciada_en timestamptz, ultimo_mensaje_en timestamptz);
    CREATE TABLE messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role text, contenido text, created_at timestamptz DEFAULT now());
  `);
  return db;
}

const perfil = async (db, nombre) =>
  (await db.query(`INSERT INTO athlete_profiles (nombre) VALUES ($1) RETURNING id;`, [nombre])).rows[0].id;

test("el título sale de la consulta y se recorta para caber en el historial", () => {
  assert.equal(tituloDesdeConsulta("¿Qué toca hoy?"), "¿Qué toca hoy?");
  assert.equal(tituloDesdeConsulta("  hola   mundo \n otra "), "hola mundo otra", "los espacios se normalizan");
  assert.equal(tituloDesdeConsulta(""), "Conversación con el coach");
  assert.equal(tituloDesdeConsulta(null), "Conversación con el coach");
  const largo = tituloDesdeConsulta("x".repeat(200));
  assert.ok(largo.length <= 61 && largo.endsWith("…"), `debería recortarse: ${largo.length}`);
});

test("una conversación nueva se titula con la primera pregunta", async () => {
  const db = await baseDeDatos();
  const id = await perfil(db, "Ana");
  const conv = await obtenerOCrearConversacion(id, { db, titulo: "¿Por qué tengo esta sesión?" });
  assert.equal(conv.titulo, "¿Por qué tengo esta sesión?");
  await db.close();
});

test("se reutiliza la conversación existente en vez de crear una por turno", async () => {
  const db = await baseDeDatos();
  const id = await perfil(db, "Ana");
  const primera = await obtenerOCrearConversacion(id, { db, titulo: "Primera" });
  const misma = await obtenerOCrearConversacion(id, { db, conversationId: primera.id, titulo: "Otra" });

  assert.equal(misma.id, primera.id);
  assert.equal(misma.titulo, "Primera", "el título no se reescribe en cada mensaje");
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM conversations;`);
  assert.equal(rows[0].n, 1);
  await db.close();
});

/* Un id de otro atleta no puede secuestrar la conversación: es lo que impide
   que enviando un uuid ajeno se escriba dentro del historial de otra persona. */
test("un id de otro perfil no se reutiliza: se abre una conversación propia", async () => {
  const db = await baseDeDatos();
  const ana = await perfil(db, "Ana");
  const luis = await perfil(db, "Luis");
  const deAna = await obtenerOCrearConversacion(ana, { db, titulo: "Privada de Ana" });

  const deLuis = await obtenerOCrearConversacion(luis, { db, conversationId: deAna.id, titulo: "Intento" });
  assert.notEqual(deLuis.id, deAna.id);
  assert.equal(deLuis.athlete_profile_id, luis);
  await db.close();
});

test("borrar una conversación se lleva sus mensajes y respeta al dueño", async () => {
  const db = await baseDeDatos();
  const ana = await perfil(db, "Ana");
  const luis = await perfil(db, "Luis");
  const conv = await obtenerOCrearConversacion(ana, { db, titulo: "Con mensajes" });
  await db.query(`INSERT INTO messages (conversation_id, role, contenido) VALUES ($1,'user','hola'),($1,'assistant','qué tal');`, [conv.id]);

  assert.equal(await deleteConversation(conv.id, luis, db), false, "otro atleta no puede borrarla");
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM conversations;`)).rows[0].n, 1);

  assert.equal(await deleteConversation(conv.id, ana, db), true);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM conversations;`)).rows[0].n, 0);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM messages;`)).rows[0].n, 0, "los mensajes caen por cascada");

  assert.equal(await deleteConversation(conv.id, ana, db), false, "borrar dos veces no es un error, devuelve false");
  await db.close();
});
