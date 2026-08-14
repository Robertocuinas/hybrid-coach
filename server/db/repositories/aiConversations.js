import { pool, insertRow } from "./_helpers.js";

/* `db` inyectable: el coach recibe un cliente por dependencia (y las pruebas
   le pasan PGlite). Sin este parámetro la escritura se iba al pool global y
   se saltaba la conexión con la que trabaja el resto de la operación. */
export async function createRecommendation(profileId, { origen, tipo, contenido, confianza, estado = "pendiente", provider = null, model = null }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO ai_recommendations (athlete_profile_id, origen, tipo, contenido, confianza, estado, provider, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *;`,
    [profileId, origen, tipo, contenido === null || contenido === undefined ? null : JSON.stringify(contenido), confianza, estado, provider, model]
  );
  return rows[0];
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

/* El perfil va en el WHERE, no se comprueba antes: así una conversación de
   otro atleta no se puede borrar ni conociendo su id. Los mensajes caen solos
   por el ON DELETE CASCADE de la tabla. */
export async function deleteConversation(conversationId, profileId, db = pool) {
  /* RETURNING y no rowCount: el recuento de filas afectadas no viaja igual en
     todos los clientes (PGlite, que usan las pruebas, no lo expone), mientras
     que las filas devueltas sí son parte del resultado en cualquiera. */
  const { rows } = await db.query(
    `DELETE FROM conversations WHERE id = $1 AND athlete_profile_id = $2 RETURNING id;`,
    [conversationId, profileId]
  );
  return rows.length > 0;
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
