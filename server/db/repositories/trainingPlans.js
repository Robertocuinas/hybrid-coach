import { pool, insertRow } from "./_helpers.js";

export function createPlanVersion(profileId, datos = {}) {
  return insertRow("training_plans", {
    athlete_profile_id: profileId,
    version: datos.version ?? 1,
    distancia_objetivo: datos.distanciaObjetivo ?? null,
    fecha_carrera: datos.fechaCarrera ?? null,
    total_semanas: datos.totalSemanas ?? null,
    taper_semanas: datos.taperSemanas ?? null,
    run_dias: datos.runDias ?? null,
    gym_dias: datos.gymDias ?? null,
    techo_tirada_larga_min: datos.techoTiradaLargaMin ?? null,
    riesgo_score: datos.riesgoScore ?? null,
    riesgo_causas: datos.riesgoCausas ?? null,
    activo: true,
  });
}

/* Regenerar un plan no borra el anterior: se marca inactivo y la versión nueva
   queda como activa, en la misma transacción. */
export async function activarPlan(profileId, planId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE training_plans SET activo = false WHERE athlete_profile_id = $1 AND id <> $2;`,
      [profileId, planId]
    );
    const { rows } = await client.query(
      `UPDATE training_plans SET activo = true WHERE id = $1 RETURNING *;`,
      [planId]
    );
    await client.query("COMMIT");
    return rows[0] || null;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function getActivePlan(profileId) {
  const { rows } = await pool.query(
    `SELECT * FROM training_plans WHERE athlete_profile_id = $1 AND activo = true ORDER BY generado_en DESC LIMIT 1;`,
    [profileId]
  );
  return rows[0] || null;
}

export function addWeek(planId, { numeroSemana, fase, techoTiradaLargaMin, esDeload = false, esTaper = false, checkpoint = null }) {
  return insertRow("training_weeks", {
    training_plan_id: planId,
    numero_semana: numeroSemana,
    fase,
    techo_tirada_larga_min: techoTiradaLargaMin,
    es_deload: esDeload,
    es_taper: esTaper,
    checkpoint,
  });
}

export function addPlannedSession(weekId, { diaSemana, codigoSesion, tipo, descripcion, duracionMin, intensidad }) {
  return insertRow("planned_sessions", {
    training_week_id: weekId,
    dia_semana: diaSemana,
    codigo_sesion: codigoSesion,
    tipo,
    descripcion,
    duracion_min: duracionMin,
    intensidad,
  });
}

export async function listWeeksWithSessions(planId) {
  const { rows } = await pool.query(
    `SELECT tw.*,
            COALESCE(json_agg(ps.* ORDER BY ps.dia_semana) FILTER (WHERE ps.id IS NOT NULL), '[]') AS sesiones
       FROM training_weeks tw
       LEFT JOIN planned_sessions ps ON ps.training_week_id = tw.id
      WHERE tw.training_plan_id = $1
      GROUP BY tw.id
      ORDER BY tw.numero_semana;`,
    [planId]
  );
  return rows;
}

export function addDecision(planId, { titulo, justificacion, fuente, confianza, estado = "pendiente", sinRespaldo = false, invadeEstructura = false }) {
  return insertRow("plan_decisions", {
    training_plan_id: planId,
    titulo,
    justificacion,
    fuente,
    confianza,
    estado,
    sin_respaldo: sinRespaldo,
    invade_estructura: invadeEstructura,
  });
}

export function addModification(profileId, { fecha, semana, planOriginal, cambio, motivo, origen }) {
  return insertRow("plan_modifications", {
    athlete_profile_id: profileId,
    fecha,
    semana,
    plan_original: planOriginal,
    cambio,
    motivo,
    origen,
  });
}
