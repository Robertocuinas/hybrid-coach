/* Persistencia de la conversación y compactación de turnos antiguos
   (docs/04-capa-ia.md §8, riesgo "conversación larga explota el contexto").

   Regla que no se negocia: los últimos LITERALES turnos van SIEMPRE textuales.
   Un resumen pierde matices —"el dolor era al empezar y se iba al calentar"
   se convierte en "tenía molestias"— y esos matices son justo lo que cambia
   una recomendación de entrenamiento. El resumen solo sustituye a lo viejo. */
import { pool } from "../../db/repositories/_helpers.js";

export const UMBRAL_RESUMEN = Number(process.env.CHAT_RESUMEN_UMBRAL || 30);
export const LITERALES = Number(process.env.CHAT_TURNOS_LITERALES || 12);

const SYS_RESUMEN = `Resumes la conversación previa entre un atleta y su entrenador para no perder contexto al continuar.

Devuelves SOLO prosa, en español, máximo 200 palabras. Conserva:
- decisiones tomadas y cambios aceptados o rechazados,
- lesiones, molestias y su evolución (zona, intensidad, cuándo aparecen),
- preferencias y restricciones que el atleta haya expresado,
- lo que quedó pendiente.
Omite saludos y cortesías. No inventes nada que no esté en la conversación.`;

/* El título es lo único que distingue una conversación de otra en el historial,
   así que sale de lo primero que preguntó el usuario. Un literal fijo dejaba
   una lista de entradas idénticas imposible de usar. */
export const tituloDesdeConsulta = (consulta) => {
  const limpio = String(consulta || "").replace(/\s+/g, " ").trim();
  if (!limpio) return "Conversación con el coach";
  return limpio.length > 60 ? limpio.slice(0, 60).trimEnd() + "…" : limpio;
};

export async function obtenerOCrearConversacion(profileId, { db = pool, conversationId = null, titulo = null } = {}) {
  if (conversationId) {
    const { rows } = await db.query(
      `SELECT * FROM conversations WHERE id = $1 AND athlete_profile_id = $2;`, [conversationId, profileId]);
    if (rows[0]) return rows[0];
    /* Un id que no existe o que es de otro perfil no puede secuestrar la
       conversación: se ignora y se abre una nueva propia. */
  }
  const { rows } = await db.query(
    `INSERT INTO conversations (athlete_profile_id, titulo, iniciada_en, ultimo_mensaje_en)
     VALUES ($1, $2, now(), now()) RETURNING *;`,
    [profileId, tituloDesdeConsulta(titulo)]
  );
  return rows[0];
}

export async function guardarMensaje(conversationId, { role, contenido, cambioPropuesto = null, citas = null }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO messages (conversation_id, role, contenido, cambio_propuesto, citas)
     VALUES ($1,$2,$3,$4,$5) RETURNING *;`,
    [conversationId, role, contenido, cambioPropuesto, citas?.length ? citas : null]
  );
  await db.query(`UPDATE conversations SET ultimo_mensaje_en = now() WHERE id = $1;`, [conversationId]);
  return rows[0];
}

export async function contarMensajes(conversationId, db = pool) {
  const { rows } = await db.query(`SELECT count(*)::int AS total FROM messages WHERE conversation_id = $1;`, [conversationId]);
  return rows[0].total;
}

/* Historial que se manda al modelo: el resumen (si existe) como primer turno
   de contexto, más los últimos LITERALES mensajes tal cual. */
export async function historialParaPrompt(conversationId, { db = pool, literales = LITERALES } = {}) {
  const { rows: conv } = await db.query(`SELECT resumen FROM conversations WHERE id = $1;`, [conversationId]);
  const { rows } = await db.query(
    `SELECT role, contenido FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2;`,
    [conversationId, literales]
  );
  const recientes = rows.reverse().map((m) => ({ role: m.role, content: m.contenido }));
  const resumen = conv[0]?.resumen;
  return resumen
    ? [{ role: "user", content: `RESUMEN DE LO HABLADO ANTES (no lo repitas, úsalo como contexto):\n${resumen}` }, ...recientes]
    : recientes;
}

/**
 * Compacta si la conversación supera el umbral. Resume TODO menos los últimos
 * `literales`, y borra los mensajes ya resumidos para que la tabla no crezca
 * sin límite con turnos que nadie va a volver a leer literalmente.
 */
export async function compactarSiHaceFalta(conversationId, { db = pool, llmProvider, umbral = UMBRAL_RESUMEN, literales = LITERALES } = {}) {
  const total = await contarMensajes(conversationId, db);
  if (total <= umbral || !llmProvider) return { compactado: false, total };

  const { rows: antiguos } = await db.query(
    `SELECT id, role, contenido FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at
      LIMIT GREATEST($2::int - $3::int, 0);`,
    [conversationId, total, literales]
  );
  if (!antiguos.length) return { compactado: false, total };

  const { rows: previo } = await db.query(`SELECT resumen FROM conversations WHERE id = $1;`, [conversationId]);
  const transcripcion = antiguos.map((m) => `${m.role === "user" ? "Atleta" : "Coach"}: ${m.contenido}`).join("\n");

  const respuesta = await llmProvider.call({
    system: SYS_RESUMEN,
    maxTokens: 400,
    messages: [{
      role: "user",
      content: previo[0]?.resumen
        ? `RESUMEN ANTERIOR:\n${previo[0].resumen}\n\nNUEVOS TURNOS A INCORPORAR:\n${transcripcion}`
        : transcripcion,
    }],
  });

  const resumen = String(respuesta.text || "").trim();
  if (!resumen) return { compactado: false, total };

  await db.query(`UPDATE conversations SET resumen = $2 WHERE id = $1;`, [conversationId, resumen]);
  await db.query(`DELETE FROM messages WHERE id = ANY($1::uuid[]);`, [antiguos.map((m) => m.id)]);

  return { compactado: true, total, resumidos: antiguos.length, literalesConservados: literales };
}
