import { pool } from "./_helpers.js";

export async function createSession({ userId, tokenHash, expiresAt, activeProfileId = null }) {
  const { rows } = await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at, active_profile_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, tokenHash, expiresAt, activeProfileId]
  );
  return rows[0];
}

export async function findActiveSession(tokenHash) {
  const { rows } = await pool.query(
    `SELECT s.*, u.email, u.role FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [tokenHash]
  );
  return rows[0] || null;
}

export async function touchSession(id) {
  await pool.query(`UPDATE user_sessions SET last_seen_at = now() WHERE id = $1`, [id]);
}

export async function revokeSession(tokenHash) {
  await pool.query(`UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [tokenHash]);
}

export async function selectProfile(sessionId, userId, profileId) {
  const { rows } = await pool.query(
    `UPDATE user_sessions s SET active_profile_id = p.id
       FROM athlete_profiles p
      WHERE s.id = $1 AND p.id = $3 AND p.user_id = $2
      RETURNING s.*`, [sessionId, userId, profileId]
  );
  return rows[0] || null;
}
