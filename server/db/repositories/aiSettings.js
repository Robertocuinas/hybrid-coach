import { pool } from "./_helpers.js";

export async function findAISettingsByUser(userId, db = pool) {
  const { rows } = await db.query(`SELECT * FROM user_ai_settings WHERE user_id=$1`, [userId]);
  return rows[0] || null;
}

export async function saveAISettings({ userId, provider, model, apiKeyCiphertext }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO user_ai_settings (user_id,provider,model,api_key_ciphertext)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO UPDATE SET
       provider=EXCLUDED.provider,
       model=EXCLUDED.model,
       api_key_ciphertext=EXCLUDED.api_key_ciphertext,
       last_tested_at=NULL,
       last_test_ok=NULL,
       updated_at=now()
     RETURNING *`,
    [userId, provider, model, apiKeyCiphertext]
  );
  return rows[0];
}

export async function updateAISettingsTest(userId, ok, db = pool) {
  const { rows } = await db.query(
    `UPDATE user_ai_settings SET last_tested_at=now(),last_test_ok=$2,updated_at=now()
      WHERE user_id=$1 RETURNING *`,
    [userId, ok]
  );
  return rows[0] || null;
}

export async function deleteAISettings(userId, db = pool) {
  const result = await db.query(`DELETE FROM user_ai_settings WHERE user_id=$1`, [userId]);
  return result.rowCount > 0;
}
