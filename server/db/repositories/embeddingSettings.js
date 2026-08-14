import { pool } from "./_helpers.js";

/* Tabla de fila única: la clave primaria es un booleano fijado a true, así que
   el UPSERT siempre cae sobre la misma fila (ver la migración 0009). */
export async function findInstanceEmbeddingSettings(db = pool) {
  const { rows } = await db.query(`SELECT * FROM instance_embedding_settings WHERE solo_una_fila;`);
  return rows[0] || null;
}

export async function saveInstanceEmbeddingSettings({ provider, model, apiKeyCiphertext, baseURL, updatedBy }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO instance_embedding_settings (solo_una_fila, provider, model, api_key_ciphertext, base_url, updated_by)
     VALUES (true, $1, $2, $3, $4, $5)
     ON CONFLICT (solo_una_fila) DO UPDATE SET
       provider=EXCLUDED.provider,
       model=EXCLUDED.model,
       api_key_ciphertext=EXCLUDED.api_key_ciphertext,
       base_url=EXCLUDED.base_url,
       updated_by=EXCLUDED.updated_by,
       last_tested_at=NULL,
       last_test_ok=NULL,
       updated_at=now()
     RETURNING *;`,
    [provider, model, apiKeyCiphertext ?? null, baseURL || null, updatedBy || null]
  );
  return rows[0];
}

export async function updateInstanceEmbeddingTest(ok, db = pool) {
  const { rows } = await db.query(
    `UPDATE instance_embedding_settings SET last_tested_at=now(), last_test_ok=$1, updated_at=now()
      WHERE solo_una_fila RETURNING *;`,
    [ok]
  );
  return rows[0] || null;
}

export async function deleteInstanceEmbeddingSettings(db = pool) {
  /* RETURNING en vez de rowCount, por la misma razón que en aiConversations:
     no todos los clientes exponen el recuento de filas afectadas. */
  const { rows } = await db.query(`DELETE FROM instance_embedding_settings WHERE solo_una_fila RETURNING solo_una_fila;`);
  return rows.length > 0;
}
