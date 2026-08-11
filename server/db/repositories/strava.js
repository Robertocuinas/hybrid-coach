import { pool } from "./_helpers.js";

/* Resuelve el token único en memoria de server.js: uno por usuario, persistente
   entre redeploys. El cifrado de access_token/refresh_token se añade en la
   Fase 3 (docs/08-seguridad.md); aquí solo se define la forma de la tabla. */
export async function upsertConnection(userId, { athleteIdStrava = null, accessToken, refreshToken, expiresAt, scope = null }) {
  const { rows } = await pool.query(
    `INSERT INTO strava_connections (user_id, athlete_id_strava, access_token, refresh_token, expires_at, scope)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *;`,
    [userId, athleteIdStrava, accessToken, refreshToken, expiresAt, scope]
  );
  return rows[0];
}

export async function getConnectionByUser(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM strava_connections WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1;`,
    [userId]
  );
  return rows[0] || null;
}
