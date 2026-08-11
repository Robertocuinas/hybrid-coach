import { pool } from "./_helpers.js";

/* Un registro por atleta y día: upsert sobre (athlete_profile_id, fecha), que es
   el índice único de la tabla. */
export async function upsertRecoveryLog(profileId, fecha, datos = {}) {
  const { rows } = await pool.query(
    `INSERT INTO recovery_logs (athlete_profile_id, fecha, horas_sueno, calidad_sueno, fatiga, agujetas, estres, motivacion, dolor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (athlete_profile_id, fecha) DO UPDATE SET
       horas_sueno = EXCLUDED.horas_sueno,
       calidad_sueno = EXCLUDED.calidad_sueno,
       fatiga = EXCLUDED.fatiga,
       agujetas = EXCLUDED.agujetas,
       estres = EXCLUDED.estres,
       motivacion = EXCLUDED.motivacion,
       dolor = EXCLUDED.dolor
     RETURNING *;`,
    [
      profileId, fecha,
      datos.horasSueno ?? null, datos.calidadSueno ?? null, datos.fatiga ?? null,
      datos.agujetas ?? null, datos.estres ?? null, datos.motivacion ?? null, datos.dolor ?? null,
    ]
  );
  return rows[0];
}

export async function listRecoveryByProfile(profileId, limit = 60) {
  const { rows } = await pool.query(
    `SELECT * FROM recovery_logs WHERE athlete_profile_id = $1 ORDER BY fecha DESC LIMIT $2;`,
    [profileId, limit]
  );
  return rows;
}

export async function addFeedbackLog(profileId, datos = {}) {
  const { rows } = await pool.query(
    `INSERT INTO feedback_logs (athlete_profile_id, fecha, semana, rpe, sensacion, dolor, zona_dolor, tipo_dolor, cuando_aparece, energia, comentario)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *;`,
    [
      profileId, datos.fecha, datos.semana ?? null, datos.rpe ?? null, datos.sensacion ?? null,
      datos.dolor ?? null, datos.zonaDolor ?? null, datos.tipoDolor ?? null, datos.cuandoAparece ?? null,
      datos.energia ?? null, datos.comentario ?? null,
    ]
  );
  return rows[0];
}

export async function listFeedbackByProfile(profileId, limit = 60) {
  const { rows } = await pool.query(
    `SELECT * FROM feedback_logs WHERE athlete_profile_id = $1 ORDER BY fecha DESC LIMIT $2;`,
    [profileId, limit]
  );
  return rows;
}
