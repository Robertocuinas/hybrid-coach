import { pool, insertRow } from "./_helpers.js";

export function createUser({ email, passwordHash = null, role = "athlete" }) {
  return insertRow("users", { email, password_hash: passwordHash, role });
}

export async function findUserByEmail(email) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1;`, [email]);
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1;`, [id]);
  return rows[0] || null;
}
