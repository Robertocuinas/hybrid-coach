import { createHash } from "node:crypto";
import { pool } from "./_helpers.js";

export class PlanningConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PlanningConflictError";
    this.code = "PLANNING_CONFLICT";
    this.status = 409;
    this.statusCode = 409;
    this.details = details;
  }
}

export class PlanningNotFoundError extends Error {
  constructor(message = "Propuesta de planificación no encontrada") {
    super(message);
    this.name = "PlanningNotFoundError";
    this.code = "PLANNING_NOT_FOUND";
    this.status = 404;
    this.statusCode = 404;
  }
}

const json = (value, fallback) => JSON.stringify(value ?? fallback);

/* JSON canónico para que dos snapshots con las mismas claves en distinto
   orden produzcan el mismo hash. Los arrays conservan orden porque en sesiones
   y consultas ese orden sí es semántico. */
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value instanceof Date ? value.toISOString() : value;
}

export function hashPlanningInput(snapshot) {
  return createHash("sha256").update(JSON.stringify(stableValue(snapshot ?? {}))).digest("hex");
}

async function transaction(db, work) {
  const client = typeof db.connect === "function" ? await db.connect() : db;
  const release = typeof client.release === "function" ? () => client.release() : () => {};
  await client.query("BEGIN");
  try {
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    release();
  }
}

const dateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : text;
};

const addDays = (value, days) => {
  const date = new Date(`${dateOnly(value)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new TypeError("weekStartDate debe ser una fecha válida");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

async function ownedPlan(client, profileId, planId, { lock = false } = {}) {
  const suffix = lock ? " FOR UPDATE" : "";
  const { rows } = await client.query(
    `SELECT * FROM training_plans WHERE id = $1 AND athlete_profile_id = $2${suffix};`,
    [planId, profileId],
  );
  if (!rows[0]) throw new PlanningNotFoundError("Plan maestro no encontrado para este perfil");
  return rows[0];
}

/**
 * Lee el estado canónico que consumirá el planificador. No hace cálculos de
 * dominio: devuelve filas reales, acotadas temporalmente, y conserva por
 * separado plan maestro, agenda, ejecución y recuperación.
 */
export async function readCanonicalPlanningContext(profileId, {
  db = pool,
  planId = null,
  weekNumber = null,
  today = new Date(),
  historyDays = 28,
} = {}) {
  if (!profileId) throw new TypeError("profileId es obligatorio");
  const days = Math.min(90, Math.max(7, Number.parseInt(historyDays, 10) || 28));
  const from = addDays(today, -days);

  const { rows: profiles } = await db.query(`SELECT * FROM athlete_profiles WHERE id = $1;`, [profileId]);
  if (!profiles[0]) throw new PlanningNotFoundError("Perfil de atleta no encontrado");

  const planQuery = planId
    ? [`SELECT * FROM training_plans WHERE id = $1 AND athlete_profile_id = $2;`, [planId, profileId]]
    : [`SELECT * FROM training_plans WHERE athlete_profile_id = $1 AND activo = true ORDER BY generado_en DESC LIMIT 1;`, [profileId]];

  const [planResult, injuries, availability, completed, strengthSets, feedback, recovery, nutrition] = await Promise.all([
    db.query(...planQuery),
    db.query(`SELECT * FROM injuries WHERE athlete_profile_id = $1 AND activa = true ORDER BY recurrente DESC, created_at DESC;`, [profileId]),
    db.query(`SELECT * FROM availability WHERE athlete_profile_id = $1 AND vigente_desde <= $2
      ORDER BY vigente_desde DESC, id DESC LIMIT 1;`, [profileId, dateOnly(today)]),
    db.query(`SELECT cs.*, rs.codigo_sesion AS running_code, rs.distancia_km, rs.duracion_min,
                    rs.ritmo, rs.fc_media, rs.fc_max, rs.desnivel, rs.cadencia, rs.rpe, rs.dolor,
                    rs.notas AS running_notes, rs.origen AS running_source,
                    ss.codigo_sesion AS strength_code
               FROM completed_sessions cs
               LEFT JOIN running_sessions rs ON rs.completed_session_id = cs.id
               LEFT JOIN strength_sessions ss ON ss.completed_session_id = cs.id
              WHERE cs.athlete_profile_id = $1 AND cs.fecha >= $2
              ORDER BY cs.fecha DESC, cs.created_at DESC;`, [profileId, from]),
    db.query(`SELECT cs.fecha, s.codigo_sesion, e.nombre AS exercise, st.orden,
                    st.peso_kg, st.reps, st.rir, st.notas
               FROM strength_sets st
               JOIN strength_sessions s ON s.id = st.strength_session_id
               JOIN completed_sessions cs ON cs.id = s.completed_session_id
               JOIN strength_exercises e ON e.id = st.strength_exercise_id
              WHERE cs.athlete_profile_id = $1 AND cs.fecha >= $2
              ORDER BY cs.fecha DESC, s.id, st.orden;`, [profileId, from]),
    db.query(`SELECT * FROM feedback_logs WHERE athlete_profile_id = $1 AND fecha >= $2 ORDER BY fecha DESC, created_at DESC;`, [profileId, from]),
    db.query(`SELECT * FROM recovery_logs WHERE athlete_profile_id = $1 AND fecha >= $2 ORDER BY fecha DESC;`, [profileId, from]),
    db.query(`SELECT * FROM nutrition_targets WHERE athlete_profile_id = $1 ORDER BY fecha DESC LIMIT 1;`, [profileId]),
  ]);

  const plan = planResult.rows[0] || null;
  let weeks = [], acceptedRevision = null;
  if (plan) {
    const params = [plan.id];
    const weekFilter = Number.isInteger(weekNumber) ? ` AND tw.numero_semana = $2` : "";
    if (Number.isInteger(weekNumber)) params.push(weekNumber);
    const { rows } = await db.query(
      `SELECT tw.*, ps.id AS planned_session_id, ps.dia_semana, ps.codigo_sesion,
              ps.tipo AS session_type, ps.descripcion, ps.duracion_min, ps.intensidad
         FROM training_weeks tw
         LEFT JOIN planned_sessions ps ON ps.training_week_id = tw.id
        WHERE tw.training_plan_id = $1${weekFilter}
        ORDER BY tw.numero_semana, ps.dia_semana, ps.id;`, params,
    );
    const byId = new Map();
    for (const row of rows) {
      if (!byId.has(row.id)) {
        const week = { ...row, sessions: [] };
        for (const key of ["planned_session_id", "dia_semana", "codigo_sesion", "session_type", "descripcion", "duracion_min", "intensidad"]) delete week[key];
        byId.set(row.id, week);
      }
      if (row.planned_session_id) byId.get(row.id).sessions.push({
        id: row.planned_session_id,
        dia_semana: row.dia_semana,
        codigo_sesion: row.codigo_sesion,
        tipo: row.session_type,
        descripcion: row.descripcion,
        duracion_min: row.duracion_min,
        intensidad: row.intensidad,
      });
    }
    weeks = [...byId.values()];

    if (Number.isInteger(weekNumber)) {
      const { rows: accepted } = await db.query(
        `SELECT r.* FROM weekly_plan_revisions r
          JOIN training_weeks tw ON tw.id = r.training_week_id
         WHERE tw.training_plan_id = $1 AND tw.numero_semana = $2 AND r.status = 'accepted' LIMIT 1;`,
        [plan.id, weekNumber],
      );
      acceptedRevision = accepted[0] || null;
      if (acceptedRevision) {
        const { rows: acceptedSessions } = await db.query(
          `SELECT * FROM weekly_plan_sessions WHERE weekly_plan_revision_id=$1 ORDER BY fecha,orden;`,
          [acceptedRevision.id],
        );
        acceptedRevision.sessions = acceptedSessions;
      }
    }
  }

  return {
    capturedAt: new Date().toISOString(),
    historyDays: days,
    profile: profiles[0],
    injuries: injuries.rows,
    availability: availability.rows[0] || null,
    masterPlan: plan,
    masterWeeks: weeks,
    acceptedRevision,
    completedSessions: completed.rows,
    strengthSets: strengthSets.rows,
    feedback: feedback.rows,
    recovery: recovery.rows,
    nutrition: nutrition.rows[0] || null,
  };
}

const assertSessionInsideWeek = (session, start, end) => {
  const date = dateOnly(session.sessionDate ?? session.session_date ?? session.date ?? session.fecha);
  if (!date || date < start || date > end) {
    throw new TypeError(`La sesión ${session.sessionKey ?? session.session_key ?? "sin clave"} cae fuera de la semana propuesta`);
  }
};

/** Crea ejecución, borrador, sesiones, evidencia y guardrails en una transacción. */
export async function createPlanningDraft({
  profileId,
  planId,
  weekNumber,
  kind = "weekly_plan",
  run = {},
  revision = {},
  sessions = [],
  evidence = [],
  guardrails = [],
}, db = pool) {
  if (!profileId || !planId) throw new TypeError("profileId y planId son obligatorios");
  if (!Number.isInteger(weekNumber) || weekNumber < 1) throw new TypeError("weekNumber debe ser un entero positivo");
  if (!Array.isArray(sessions) || !Array.isArray(evidence) || !Array.isArray(guardrails)) {
    throw new TypeError("sessions, evidence y guardrails deben ser arrays");
  }

  return transaction(db, async (client) => {
    await ownedPlan(client, profileId, planId, { lock: true });
    const { rows: weekRows } = await client.query(
      `SELECT * FROM training_weeks
        WHERE training_plan_id=$1 AND numero_semana=$2 FOR UPDATE;`, [planId, weekNumber],
    );
    if (!weekRows[0]) {
      throw new PlanningConflictError("La semana aún no existe en el plan maestro", { planId, weekNumber });
    }
    const trainingWeek = weekRows[0];
    const weekStart = dateOnly(revision.weekStartDate ?? revision.week_start_date ?? revision.week_start ?? trainingWeek.inicio);
    if (!weekStart) throw new TypeError("revision.weekStartDate es obligatorio");
    const weekEnd = dateOnly(revision.weekEndDate ?? revision.week_end_date ?? revision.week_end) || addDays(weekStart, 6);
    if (weekEnd < weekStart) throw new TypeError("weekEndDate no puede ser anterior a weekStartDate");
    sessions.forEach((session) => assertSessionInsideWeek(session, weekStart, weekEnd));

    const { rows: nextRows } = await client.query(
      `SELECT COALESCE(max(revision), 0)::int + 1 AS next
         FROM weekly_plan_revisions WHERE training_week_id = $1;`,
      [trainingWeek.id],
    );
    const revisionNumber = revision.revisionNumber ?? revision.revision_number ?? revision.revision ?? nextRows[0].next;
    if (!Number.isInteger(revisionNumber) || revisionNumber < 1) throw new TypeError("revisionNumber debe ser positivo");

    const baseRevisionId = revision.baseRevisionId ?? revision.base_revision_id ?? null;
    if (baseRevisionId) {
      const { rows: bases } = await client.query(
        `SELECT id FROM weekly_plan_revisions
          WHERE id = $1 AND training_week_id = $2;`,
        [baseRevisionId, trainingWeek.id],
      );
      if (!bases[0]) throw new PlanningConflictError("La revisión base no pertenece a esta semana", { baseRevisionId });
    }

    const inputSnapshot = run.inputSnapshot ?? run.input_snapshot ?? {};
    const status = run.status || "completed";
    const completedAt = run.completedAt ?? run.completed_at ?? (status === "running" ? null : new Date());
    const validatedOutput = run.validatedOutput ?? run.validated_output ?? null;
    const failure = run.failure ?? null;
    const { rows: runRows } = await client.query(
      `INSERT INTO planning_runs
        (athlete_profile_id, training_plan_id, week_number, kind, status,
         prompt_version, schema_version, rules_version, provider, model,
         input_snapshot, input_hash, analytics, query_plan, retrieval_diagnostics,
         validated_output, validation_results, failure, latency_ms, started_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,COALESCE($20,now()),$21)
       RETURNING *;`,
      [profileId, planId, weekNumber, kind, status,
        run.promptVersion ?? run.prompt_version ?? null,
        run.schemaVersion ?? run.schema_version ?? null,
        run.rulesVersion ?? run.rules_version ?? null,
        run.provider ?? null, run.model ?? null,
        json(inputSnapshot, {}), run.inputHash ?? run.input_hash ?? hashPlanningInput(inputSnapshot),
        json(run.analytics, {}), json(run.queryPlan ?? run.query_plan, []),
        json(run.retrievalDiagnostics ?? run.retrieval_diagnostics, {}),
        validatedOutput === null ? null : json(validatedOutput, null),
        json(run.validationResults ?? run.validation_results, []),
        failure === null ? null : json(failure, null),
        run.latencyMs ?? run.latency_ms ?? null,
        run.startedAt ?? run.started_at ?? null, completedAt],
    );
    const planningRun = runRows[0];

    const { rows: revisionRows } = await client.query(
      `INSERT INTO weekly_plan_revisions
        (athlete_profile_id, training_week_id, planning_run_id,
         revision, base_revision_id, status, week_start, week_end,
         summary, confidence, evidence_state)
       VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10) RETURNING *;`,
      [profileId, trainingWeek.id, planningRun.id, revisionNumber, baseRevisionId,
        weekStart, weekEnd,
        typeof revision.summary === "object"
          ? revision.summary?.public_reason ?? null
          : revision.summary ?? revision.public_reason ?? null,
        revision.confidence ?? revision.summary?.confidence ?? null,
        revision.evidenceState ?? revision.evidence_state ?? revision.summary?.evidence_state ?? null],
    );
    const draft = revisionRows[0];

    const sessionRows = [];
    for (const [index, session] of sessions.entries()) {
      const { rows } = await client.query(
        `INSERT INTO weekly_plan_sessions
          (weekly_plan_revision_id, master_planned_session_id, session_key,
           fecha, day_of_week, orden, modality, session_type,
           session_code, title, priority, duration_min, intensity, prescription,
           objective, public_reason, change_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *;`,
        [draft.id,
          session.masterPlannedSessionId ?? session.master_planned_session_id ?? null,
          session.sessionKey ?? session.session_key,
          dateOnly(session.sessionDate ?? session.session_date ?? session.date ?? session.fecha),
          session.dayOfWeek ?? session.day_of_week,
          session.orderIndex ?? session.order_index ?? index,
          session.modality, session.sessionType ?? session.session_type,
          session.sessionCode ?? session.session_code ?? session.master_session_code ?? null,
          session.title, session.priority ?? null,
          session.durationMin ?? session.duration_min ?? null,
          session.intensity === null || session.intensity === undefined ? null : json(session.intensity, null),
          json(session.prescription, {}),
          session.objective ?? null, session.publicReason ?? session.public_reason ?? null,
          session.changeType ?? session.change_type ?? session.change_from_master?.type ?? null],
      );
      sessionRows.push(rows[0]);
    }

    const evidenceRows = [];
    for (const item of evidence) {
      const { rows } = await client.query(
        `INSERT INTO planning_run_evidence
          (planning_run_id, document_chunk_id, query_key, query_text, rank,
           scores, score_type, sent_to_model, used_by_model, is_fill)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *;`,
        [planningRun.id, item.chunkId ?? item.documentChunkId ?? item.document_chunk_id ?? item.id,
          item.queryKey ?? item.query_key ?? "default", item.queryText ?? item.query_text,
          item.rank, json(item.scores, {}), item.scoreType ?? item.score_type ?? null,
          !!(item.sentToModel ?? item.sent_to_model), !!(item.usedByModel ?? item.used_by_model),
          !!(item.isFill ?? item.is_fill)],
      );
      evidenceRows.push(rows[0]);
    }

    const guardrailRows = [];
    for (const [index, item] of guardrails.entries()) {
      const { rows } = await client.query(
        `INSERT INTO guardrail_results
          (planning_run_id, weekly_plan_revision_id, rule_key, rule_version,
           severity, result, message, details, order_index)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *;`,
        [planningRun.id, draft.id, item.ruleKey ?? item.rule_key,
          item.ruleVersion ?? item.rule_version ?? null, item.severity ?? "error",
          item.result, item.message ?? null, json(item.details, {}),
          item.orderIndex ?? item.order_index ?? index],
      );
      guardrailRows.push(rows[0]);
    }

    return { run: planningRun, revision: draft, sessions: sessionRows, evidence: evidenceRows, guardrails: guardrailRows };
  });
}

async function lockedRevision(client, revisionId, profileId) {
  const { rows } = await client.query(
    `SELECT r.* FROM weekly_plan_revisions r
      JOIN training_weeks tw ON tw.id = r.training_week_id
      JOIN training_plans p ON p.id = tw.training_plan_id
     WHERE r.id = $1 AND r.athlete_profile_id = $2 AND p.athlete_profile_id = $2
     FOR UPDATE OF r;`,
    [revisionId, profileId],
  );
  if (!rows[0]) throw new PlanningNotFoundError();
  return rows[0];
}

const assertExpectedRevision = (row, expectedRevision) => {
  if (expectedRevision === undefined || expectedRevision === null) {
    throw new TypeError("expectedRevision es obligatorio");
  }
  const actual = row.revision ?? row.revision_number;
  if (Number(expectedRevision) !== Number(actual)) {
    throw new PlanningConflictError("La propuesta cambió desde que fue leída", {
      expectedRevision: Number(expectedRevision), actualRevision: Number(actual),
    });
  }
};

export async function acceptWeeklyPlanRevision({ revisionId, profileId, expectedRevision, decidedAt = new Date() }, db = pool) {
  return transaction(db, async (client) => {
    const candidate = await lockedRevision(client, revisionId, profileId);
    assertExpectedRevision(candidate, expectedRevision);
    if (candidate.status === "accepted") return getWeeklyPlanRevision(revisionId, profileId, client);
    if (candidate.status !== "draft") {
      throw new PlanningConflictError(`No se puede aceptar una revisión en estado ${candidate.status}`, { status: candidate.status });
    }

    const { rows: activeRows } = await client.query(
      `SELECT * FROM weekly_plan_revisions
        WHERE training_week_id = $1 AND status = 'accepted'
        FOR UPDATE;`, [candidate.training_week_id],
    );
    const active = activeRows[0] || null;
    if ((candidate.base_revision_id || null) !== (active?.id || null)) {
      throw new PlanningConflictError("La semana activa ya no coincide con la revisión base", {
        baseRevisionId: candidate.base_revision_id || null,
        activeRevisionId: active?.id || null,
      });
    }

    if (active) {
      await client.query(
        `UPDATE weekly_plan_revisions
            SET status='superseded', superseded_at=$2, updated_at=now()
          WHERE id=$1;`, [active.id, decidedAt],
      );
    }
    await client.query(
      `UPDATE weekly_plan_revisions
          SET status='accepted', accepted_at=$2, updated_at=now()
        WHERE id=$1;`, [candidate.id, decidedAt],
    );
    return getWeeklyPlanRevision(candidate.id, profileId, client);
  });
}

export async function rejectWeeklyPlanRevision({ revisionId, profileId, expectedRevision, decidedAt = new Date() }, db = pool) {
  return transaction(db, async (client) => {
    const candidate = await lockedRevision(client, revisionId, profileId);
    assertExpectedRevision(candidate, expectedRevision);
    if (candidate.status === "rejected") return getWeeklyPlanRevision(revisionId, profileId, client);
    if (candidate.status !== "draft") {
      throw new PlanningConflictError(`No se puede rechazar una revisión en estado ${candidate.status}`, { status: candidate.status });
    }
    await client.query(
      `UPDATE weekly_plan_revisions
          SET status='rejected', rejected_at=$2, updated_at=now()
        WHERE id=$1;`, [candidate.id, decidedAt],
    );
    return getWeeklyPlanRevision(candidate.id, profileId, client);
  });
}

export async function getWeeklyPlanRevision(revisionId, profileId, db = pool) {
  const { rows } = await db.query(
    `SELECT r.*, pr.kind AS run_kind, pr.status AS run_status, pr.provider, pr.model,
            pr.prompt_version, pr.schema_version, pr.rules_version, pr.input_hash,
            pr.retrieval_diagnostics, pr.validation_results, pr.latency_ms
       FROM weekly_plan_revisions r
       JOIN planning_runs pr ON pr.id = r.planning_run_id
      WHERE r.id = $1 AND r.athlete_profile_id = $2;`, [revisionId, profileId],
  );
  if (!rows[0]) throw new PlanningNotFoundError();
  const revision = rows[0];
  const [sessions, evidence, guardrails] = await Promise.all([
    db.query(`SELECT * FROM weekly_plan_sessions WHERE weekly_plan_revision_id = $1 ORDER BY orden;`, [revisionId]),
    db.query(`SELECT pe.*, dc.document_id, dc.texto, dc.seccion, dc.pagina_inicio, dc.pagina_fin,
                     d.titulo, d.autores, d.anio, d.doi, d.fuente_revista,
                     d.study_type, d.evidence_grade, d.poblacion, d.population_type, d.sample_size
                FROM planning_run_evidence pe
                JOIN document_chunks dc ON dc.id = pe.document_chunk_id
                JOIN documents d ON d.id = dc.document_id
               WHERE pe.planning_run_id = $1
               ORDER BY pe.query_key, pe.rank;`, [revision.planning_run_id]),
    db.query(`SELECT * FROM guardrail_results WHERE planning_run_id = $1 ORDER BY order_index, id;`, [revision.planning_run_id]),
  ]);
  return { revision, sessions: sessions.rows, evidence: evidence.rows, guardrails: guardrails.rows };
}

export async function listWeeklyPlanRevisions(profileId, { planId = null, weekNumber = null, status = null } = {}, db = pool) {
  const params = [profileId];
  const filters = ["r.athlete_profile_id = $1"];
  if (planId) { params.push(planId); filters.push(`tw.training_plan_id = $${params.length}`); }
  if (Number.isInteger(weekNumber)) { params.push(weekNumber); filters.push(`tw.numero_semana = $${params.length}`); }
  if (status) { params.push(status); filters.push(`r.status = $${params.length}`); }
  const { rows } = await db.query(
    `SELECT r.*, tw.numero_semana AS week_number, tw.training_plan_id
       FROM weekly_plan_revisions r JOIN training_weeks tw ON tw.id=r.training_week_id
      WHERE ${filters.join(" AND ")}
      ORDER BY r.week_start DESC, r.revision DESC;`, params,
  );
  return rows;
}

export async function createPlanChangeProposal(profileId, data, db = pool) {
  if (!profileId || !data?.planningRunId || !data?.changeType) {
    throw new TypeError("profileId, planningRunId y changeType son obligatorios");
  }
  return transaction(db, async (client) => {
    const { rows: runs } = await client.query(
      `SELECT * FROM planning_runs WHERE id = $1 AND athlete_profile_id = $2 FOR UPDATE;`,
      [data.planningRunId, profileId],
    );
    if (!runs[0]) throw new PlanningNotFoundError("Ejecución de planificación no encontrada");
    const run = runs[0];
    const planId = data.planId ?? run.training_plan_id ?? null;
    if (planId) await ownedPlan(client, profileId, planId);

    const { rows } = await client.query(
      `INSERT INTO plan_change_proposals
        (athlete_profile_id, training_plan_id, planning_run_id, weekly_plan_revision_id,
         conversation_id, message_id, revision_number, change_type, effective_date,
         source_session_key, target_session_key, payload, reason, public_reason,
         evidence_state, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *;`,
      [profileId, planId, data.planningRunId, data.weeklyPlanRevisionId ?? null,
        data.conversationId ?? null, data.messageId ?? null, data.revisionNumber ?? 1,
        data.changeType, dateOnly(data.effectiveDate), data.sourceSessionKey ?? null,
        data.targetSessionKey ?? null, json(data.payload, {}), data.reason ?? null,
        data.publicReason ?? null, data.evidenceState ?? null, data.confidence ?? null],
    );
    return rows[0];
  });
}

async function decidePlanChangeProposal({ proposalId, profileId, expectedRevision, decision, decidedAt }, db) {
  return transaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM plan_change_proposals
        WHERE id = $1 AND athlete_profile_id = $2 FOR UPDATE;`, [proposalId, profileId],
    );
    const proposal = rows[0];
    if (!proposal) throw new PlanningNotFoundError("Cambio propuesto no encontrado");
    assertExpectedRevision(proposal, expectedRevision);
    if (proposal.status === decision) return proposal;
    if (proposal.status !== "draft") {
      throw new PlanningConflictError(`No se puede decidir un cambio en estado ${proposal.status}`, { status: proposal.status });
    }
    const timestampColumn = decision === "accepted" ? "accepted_at" : "rejected_at";
    const { rows: updated } = await client.query(
      `UPDATE plan_change_proposals
          SET status=$2, ${timestampColumn}=$3, updated_at=now()
        WHERE id=$1 RETURNING *;`, [proposalId, decision, decidedAt ?? new Date()],
    );
    return updated[0];
  });
}

export const acceptPlanChangeProposal = (args, db = pool) =>
  decidePlanChangeProposal({ ...args, decision: "accepted" }, db);

export const rejectPlanChangeProposal = (args, db = pool) =>
  decidePlanChangeProposal({ ...args, decision: "rejected" }, db);

export async function getPlanChangeProposal(proposalId, profileId, db = pool) {
  const { rows } = await db.query(
    `SELECT p.*, r.provider, r.model, r.prompt_version, r.rules_version
       FROM plan_change_proposals p JOIN planning_runs r ON r.id = p.planning_run_id
      WHERE p.id = $1 AND p.athlete_profile_id = $2;`, [proposalId, profileId],
  );
  if (!rows[0]) throw new PlanningNotFoundError("Cambio propuesto no encontrado");
  const proposal = rows[0];
  const { rows: evidence } = await db.query(
    `SELECT pe.*, dc.document_id, dc.texto, dc.seccion, dc.pagina_inicio, dc.pagina_fin,
            d.titulo, d.autores, d.anio, d.doi, d.study_type, d.evidence_grade
       FROM planning_run_evidence pe
       JOIN document_chunks dc ON dc.id = pe.document_chunk_id
       JOIN documents d ON d.id = dc.document_id
      WHERE pe.planning_run_id = $1 ORDER BY pe.query_key, pe.rank;`,
    [proposal.planning_run_id],
  );
  return { proposal, evidence };
}
