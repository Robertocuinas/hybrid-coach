import { pool, insertRow } from "._helpers.js";

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
    // Se activa después, dentro de activarPlan(), tras desactivar la versión anterior.
    activo: false,
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

/* Decisión + sus citas en una transacción (Fase 8). Una decisión guardada sin
   sus citas sería exactamente lo que este proyecto no quiere: una afirmación
   con respaldo aparente que no se puede comprobar.

   Las citas van con `similarity_score` y `rank` para poder distinguir después,
   al depurar, una cita fuerte de una de relleno (docs/05-rag.md §10). */
export async function guardarDecisionConCitas(client, planId, decision) {
  await client.query("BEGIN");
  try {
    const { rows } = await client.query(
      `INSERT INTO plan_decisions (training_plan_id, titulo, justificacion, fuente, confianza, estado, sin_respaldo, invade_estructura)
       VALUES ($1,$2,$3,'ia',$4,$5,$6,$7) RETURNING *;`,
      [planId, decision.t, decision.p, decision.confianza, decision.estado || "pendiente", decision.sinRespaldo, decision.invade]
    );
    const guardada = rows[0];

    for (const cita of decision.citas || []) {
      /* ON CONFLICT: el modelo puede repetir el mismo fragmento en una misma
         decisión; la clave primaria compuesta lo impide y aquí se ignora. */
      await client.query(
        `INSERT INTO plan_decision_citations
           (plan_decision_id, document_chunk_id, similarity_score, rank, score_type, es_relleno)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (plan_decision_id, document_chunk_id) DO NOTHING;`,
        [guardada.id, cita.chunkId, cita.similarityScore, cita.rank, cita.scoreType, !!cita.relleno]
      );
    }

    await client.query("COMMIT");
    return { decision: guardada, citas: (decision.citas || []).length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function listarDecisionesConCitas(planId, db = pool) {
  const { rows } = await db.query(
    `SELECT pd.*,
            COALESCE(json_agg(json_build_object(
              'chunkId', c.document_chunk_id, 'documentId', dc.document_id,
              'rank', c.rank, 'similarityScore', c.similarity_score,
              'scoreType', c.score_type, 'relleno', c.es_relleno,
              'texto', dc.texto, 'seccion', dc.seccion, 'paginaInicio', dc.pagina_inicio, 'paginaFin', dc.pagina_fin,
              'titulo', d.titulo, 'autores', d.autores, 'anio', d.anio, 'doi', d.doi,
              'fuente', d.fuente_revista, 'studyType', d.study_type, 'evidenceGrade', d.evidence_grade,
              'poblacion', d.poblacion, 'populationType', d.population_type, 'sampleSize', d.sample_size,
              'origen', d.origen, 'hasPdf', (d.storage_key IS NOT NULL)
            ) ORDER BY c.rank) FILTER (WHERE c.document_chunk_id IS NOT NULL), '[]') AS citas
       FROM plan_decisions pd
       LEFT JOIN plan_decision_citations c ON c.plan_decision_id = pd.id
       LEFT JOIN document_chunks dc ON dc.id = c.document_chunk_id
       LEFT JOIN documents d ON d.id = dc.document_id
      WHERE pd.training_plan_id = $1
      GROUP BY pd.id
      ORDER BY pd.created_at;`,
    [planId]
  );
  return rows;
}

/* Persiste un plan maestro completo (plan + semanas + sesiones maestras +
   decisiones) en una transacción y lo activa. `plan` es la salida validada del
   orquestador de IA+RAG (masterPlanSchema). Devuelve el plan activo. */
export async function saveMasterPlan(profileId, plan, { estructuraHash = null } = {}, db = pool) {
  const client = typeof db.connect === "function" ? await db.connect() : db;
  const release = typeof client.release === "function" ? () => client.release() : () => {};
  try {
    await client.query("BEGIN");
    /* Regenerar el plan maestro reemplaza al anterior: se borran los planes
       previos del perfil (y sus semanas/sesiones/decisiones en cascada) antes
       de insertar el nuevo, para no chocar con la restricción de un único
       plan activo ni dejar planes huérfanos. */
    const { rows: previos } = await client.query(
      `SELECT id FROM training_plans WHERE athlete_profile_id = $1`,
      [profileId]
    );
    for (const p of previos) {
      await client.query(`DELETE FROM planned_sessions WHERE training_week_id IN (SELECT id FROM training_weeks WHERE training_plan_id = $1)`, [p.id]);
      await client.query(`DELETE FROM plan_decisions WHERE training_plan_id = $1`, [p.id]);
      await client.query(`DELETE FROM training_weeks WHERE training_plan_id = $1`, [p.id]);
    }
    if (previos.length) {
      await client.query(`DELETE FROM training_plans WHERE athlete_profile_id = $1`, [profileId]);
    }
    const { rows: planRows } = await client.query(
      `INSERT INTO training_plans
        (athlete_profile_id, version, distancia_objetivo, fecha_carrera, total_semanas,
         taper_semanas, run_dias, gym_dias, techo_tirada_larga_min, riesgo_score, riesgo_causas,
         structure_hash, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false)
       RETURNING *;`,
      [profileId, 1, plan.distancia_objetivo ?? null, plan.fecha_carrera ?? null, plan.total_semanas ?? null,
        plan.taper_semanas ?? null, plan.mezcla?.run ?? null, plan.mezcla?.gym ?? null,
        plan.techo_tirada_larga_min ?? null, plan.riesgo?.score ?? null,
        JSON.stringify(plan.riesgo?.causas ?? []), estructuraHash]
    );
    const planDb = planRows[0];
    for (const semana of plan.semanas || []) {
      const { rows: weekRows } = await client.query(
        `INSERT INTO training_weeks
          (training_plan_id, numero_semana, fase, techo_tirada_larga_min, es_deload, es_taper, checkpoint)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *;`,
        [planDb.id, semana.numero, semana.fase, plan.techo_tirada_larga_min ?? null,
          !!semana.deload, !!semana.taper, semana.checkpoint ?? null]
      );
      const weekDb = weekRows[0];
      for (const sesion of semana.sesiones || []) {
        await client.query(
          `INSERT INTO planned_sessions
            (training_week_id, dia_semana, codigo_sesion, tipo, descripcion, duracion_min, intensidad)
           VALUES ($1,$2,$3,$4,$5,$6,$7);`,
          [weekDb.id, null, sesion.codigo, sesion.tipo, sesion.titulo ?? sesion.objetivo ?? null,
            sesion.duracion_min ?? sesion.duracionMin ?? null, null]
        );
      }
    }
    for (const decision of plan.decisiones || []) {
      await client.query(
        `INSERT INTO plan_decisions (training_plan_id, titulo, justificacion, fuente, confianza, estado, invade_estructura)
         VALUES ($1,$2,$3,'ia',$4,$5,$6);`,
        [planDb.id, decision.t, decision.p, decision.confianza ?? null, decision.estado || "pendiente", !!decision.invade]
      );
    }
    const { rows: activado } = await client.query(
      `UPDATE training_plans SET activo = true WHERE id = $1 RETURNING *;`,
      [planDb.id]
    );
    await client.query("COMMIT");
    return activado[0] || planDb;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    release();
  }
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
