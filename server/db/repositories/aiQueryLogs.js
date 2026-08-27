/* Repositorio de consultas a la tabla ai_query_logs (Fase 10).

   Persiste el protocolo de cada consulta al RAG para auditoría y para ejecutar
   la evaluación completa en un comando (npm run eval).
*/

import { pool } from "./_helpers.js";

class AiQueryLogsRepo {
  async create( registro, db ) {
    const {
      athlete_profile_id,
      tipo,
      consulta,
      latencia_ms,
      hay_evidencia,
      fragmentos_entregados,
      provider = null,
      model = null,
    } = registro;
    return db.query(
      `INSERT INTO ai_query_logs
        (athlete_profile_id, tipo, consulta, latencia_ms, hay_evidencia,
         fragmentos_entregados, provider, model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at;`,
      [athlete_profile_id, tipo, consulta, latencia_ms, hay_evidencia,
       fragmentos_entregados, provider, model]
    );
  }

  async readByProfile(athlete_profile_id, desde = null, hasta = null, limite = 200) {
    let sql = `SELECT * FROM ai_query_logs
               WHERE athlete_profile_id = $1
               ORDER BY created_at DESC LIMIT $2`;
    const params = [athlete_profile_id, limite];
    if (desde || hasta) {
      const condiciones = [];
      if (desde) { condiciones.push(`created_at >= $${params.length + 1}`); params.push(desde); }
      if (hasta)  { condiciones.push(`created_at <= $${params.length + 1}`); params.push(hasta); }
      sql = `SELECT * FROM ai_query_logs
             WHERE athlete_profile_id = $1 AND ${condiciones.join(" AND ")}
             ORDER BY created_at DESC LIMIT $2`;
    }
    return pool.query(sql, params);
  }

  async deleteExpired(db, { olderThanDays = 90 } = {}) {
    const umbral = new Date();
    umbral.setDate(umbral.getDate() - olderThanDays);
    return db.query(`DELETE FROM ai_query_logs WHERE created_at < $1`, [umbral]);
  }
}

export const aiQueryLogs = new AiQueryLogsRepo();
