import { pool, insertRow } from "./_helpers.js";

export function createRecommendation(profileId, { origen, tipo, contenido, confianza, estado = "pendiente", provider = null, model = null }) {
  return insertRow("ai_recommendations", {
    athlete_profile_id: profileId,
    origen,
    tipo,
    contenido,
    confianza,
    estado,
    provider,
    model,
  });
}

export async function listRecommendationsByProfile(profileId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT * FROM ai_recommendations WHERE athlete_profile_id = $1 ORDER BY created_at DESC LIMIT $2;`,
    [profileId, limit]
  );
  return rows;
}

export function createConversation(profileId, titulo = null) {
  return insertRow("conversations", {
    athlete_profile_id: profileId,
    titulo,
    iniciada_en: new Date(),
    ultimo_mensaje_en: new Date(),
  });
}

export async function listConversationsByProfile(profileId) {
  const { rows } = await pool.query(
    `SELECT * FROM conversations WHERE athlete_profile_id = $1 ORDER BY ultimo_mensaje_en DESC;`,
    [profileId]
  );
  return rows;
}

export async function addMessage(conversationId, { role, contenido, cambioPropuesto = null, citas = null }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO messages (conversation_id, role, contenido, cambio_propuesto, citas)
       VALUES ($1, $2, $3, $4, $5) RETURNING *;`,
      [conversationId, role, contenido, cambioPropuesto, citas]
    );
    await client.query(`UPDATE conversations SET ultimo_mensaje_en = now() WHERE id = $1;`, [conversationId]);
    await client.query("COMMIT");
    return rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function listMessages(conversationId, limit = 100) {
  const { rows } = await pool.query(
    `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at LIMIT $2;`,
    [conversationId, limit]
  );
  return rows;
}
