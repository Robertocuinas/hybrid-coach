export class PlanningApiError extends Error {
  constructor(message, { status = 0, code = "PLANNING_API_ERROR", details = null } = {}) {
    super(message);
    this.name = "PlanningApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function requestPlanning(path, options = {}, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
  } catch (error) {
    throw new PlanningApiError("No se pudo conectar con el planificador basado en evidencia.", {
      code: "PLANNING_UNAVAILABLE", details: error?.message || String(error),
    });
  }

  const raw = await response.text();
  let data = {};
  if (raw) {
    try { data = JSON.parse(raw); }
    catch { throw new PlanningApiError("El planificador devolvió una respuesta no válida.", { status: response.status, code: "INVALID_RESPONSE" }); }
  }
  if (!response.ok) {
    throw new PlanningApiError(data.message || data.error || `El planificador respondió HTTP ${response.status}.`, {
      status: response.status, code: data.code || "PLANNING_REQUEST_FAILED", details: data,
    });
  }
  return data;
}

export function normalizeProposal(value) {
  const envelope = value && typeof value === "object" ? value : {};
  const proposal = envelope.proposal && typeof envelope.proposal === "object" ? envelope.proposal : envelope;
  const revision = proposal.revision && typeof proposal.revision === "object"
    ? proposal.revision
    : envelope.revision && typeof envelope.revision === "object" ? envelope.revision : proposal;
  const sessions = proposal.sessions || envelope.sessions || revision.sessions;
  const evidence = proposal.evidence || envelope.evidence || revision.evidence || [];
  const guardrails = proposal.guardrails || envelope.guardrails || revision.guardrails || [];
  const id = revision.id || proposal.id || envelope.id;
  if (!revision || typeof revision !== "object" || !id || !Array.isArray(sessions)) {
    throw new PlanningApiError("La propuesta no contiene id y sesiones válidas.", { code: "INVALID_PROPOSAL" });
  }
  const rawSummary = revision.summary ?? proposal.summary;
  const summaryObject = rawSummary && typeof rawSummary === "object" ? rawSummary : null;
  const proposalWarnings = proposal.warnings || revision.warnings || envelope.warnings || [];
  const guardrailWarnings = (Array.isArray(guardrails) ? guardrails
    : [...(guardrails.hard || []), ...(guardrails.soft || []), ...(guardrails.warnings || [])])
    .filter((item) => item?.result !== "pass" && item?.result !== true);
  const warnings = [...(Array.isArray(proposalWarnings) ? proposalWarnings : []), ...guardrailWarnings]
    .filter((item) => item && (typeof item === "string" || item.message));
  const explicitCitations = proposal.citations || revision.citations || envelope.citations;
  const evidenceRows = Array.isArray(evidence) ? evidence : [];
  const citations = Array.isArray(explicitCitations) && explicitCitations.length ? explicitCitations : evidenceRows
    .filter((item) => item.usedByModel ?? item.used_by_model ?? item.sentToModel ?? item.sent_to_model ?? true)
    .map((item) => ({
      ...item,
      id: item.documentChunkId || item.document_chunk_id || item.chunkId || item.chunk_id || item.id,
      chunkId: item.documentChunkId || item.document_chunk_id || item.chunkId || item.chunk_id || null,
      title: item.title || item.titulo || item.document_title || null,
      authors: item.authors || item.autores || item.document_authors || null,
      year: item.year || item.anio || item.document_year || null,
      section: item.section || item.seccion || null,
      page: item.page || item.pagina || item.page_start || null,
      text: item.text || item.texto || item.excerpt || item.chunk_text || null,
    }));
  return {
    ...revision,
    id: String(id),
    status: revision.status || proposal.status || "draft",
    revisionNumber: revision.revisionNumber ?? revision.revision_number
      ?? (typeof revision.revision === "number" ? revision.revision : null),
    weekNumber: revision.weekNumber ?? revision.week_number ?? proposal.weekNumber ?? proposal.week_number ?? null,
    weekStart: revision.weekStart || revision.week_start || proposal.weekStart || proposal.week_start || null,
    weekEnd: revision.weekEnd || revision.week_end || proposal.weekEnd || proposal.week_end || null,
    summary: (typeof rawSummary === "string" ? rawSummary : null)
      || summaryObject?.public_reason || summaryObject?.publicReason
      || proposal.weekSummary || proposal.week_summary || "Propuesta semanal basada en el contexto disponible.",
    evidenceState: revision.evidenceState || revision.evidence_state || proposal.evidenceState || proposal.evidence_state
      || summaryObject?.evidence_state || summaryObject?.evidenceState || "unknown",
    confidence: revision.confidence ?? proposal.confidence ?? summaryObject?.confidence ?? null,
    sessions,
    warnings,
    citations,
    evidence: evidenceRows,
    guardrails,
  };
}

export async function createWeekProposal(week, input, fetchImpl) {
  const data = await requestPlanning(`/api/planning/weeks/${encodeURIComponent(week)}/proposals`, {
    method: "POST", body: JSON.stringify(input),
  }, fetchImpl);
  return normalizeProposal(data);
}

export async function getAcceptedWeekPlan(week, fetchImpl) {
  const data = await requestPlanning(`/api/planning/weeks/${encodeURIComponent(week)}/accepted`, {
    method: "GET",
  }, fetchImpl);
  if (data === null || data?.proposal === null) return null;
  const proposal = normalizeProposal(data);
  if (proposal.status !== "accepted") {
    throw new PlanningApiError("El servidor no devolvió una revisión semanal aceptada.", { code: "INVALID_ACCEPTED_PROPOSAL" });
  }
  return proposal;
}

export async function resolvePlanningProposal(id, action, expectedRevisionOrFetch, maybeFetchImpl) {
  if (!id || !["accept", "reject"].includes(action)) {
    throw new PlanningApiError("Acción de propuesta no válida.", { code: "INVALID_PROPOSAL_ACTION" });
  }
  const fetchImpl = typeof expectedRevisionOrFetch === "function" ? expectedRevisionOrFetch : maybeFetchImpl;
  const expectedRevision = typeof expectedRevisionOrFetch === "function" ? null : expectedRevisionOrFetch;
  return requestPlanning(`/api/planning/proposals/${encodeURIComponent(id)}/${action}`, {
    method: "POST", body: JSON.stringify(expectedRevision === null || expectedRevision === undefined ? {} : { expectedRevision }),
  }, fetchImpl);
}

export const acceptPlanningProposal = (id, expectedRevisionOrFetch, fetchImpl) => resolvePlanningProposal(id, "accept", expectedRevisionOrFetch, fetchImpl);
export const rejectPlanningProposal = (id, expectedRevisionOrFetch, fetchImpl) => resolvePlanningProposal(id, "reject", expectedRevisionOrFetch, fetchImpl);

const DAY_NAMES = {
  lunes: 0, monday: 0, martes: 1, tuesday: 1, miercoles: 2, "miércoles": 2, wednesday: 2,
  jueves: 3, thursday: 3, viernes: 4, friday: 4, sabado: 5, "sábado": 5, saturday: 5,
  domingo: 6, sunday: 6,
};

function dateDiff(start, end) {
  const toUtc = (value) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? Date.UTC(+match[1], +match[2] - 1, +match[3]) : NaN;
  };
  return Math.round((toUtc(end) - toUtc(start)) / 86400000);
}

function sessionDay(session, weekStart) {
  const direct = session.day ?? session.dayIndex ?? session.day_index ?? session.dayOfWeek ?? session.day_of_week;
  if (Number.isInteger(Number(direct)) && Number(direct) >= 0 && Number(direct) <= 6) return Number(direct);
  if (typeof direct === "string" && DAY_NAMES[direct.trim().toLowerCase()] !== undefined) return DAY_NAMES[direct.trim().toLowerCase()];
  const date = session.date || session.fecha || session.sessionDate || session.session_date;
  if (date && weekStart) {
    const diff = dateDiff(weekStart, date);
    if (Number.isInteger(diff) && diff >= 0 && diff <= 6) return diff;
  }
  return null;
}

function sessionCode(session) {
  const direct = session.code || session.sessionCode || session.session_code || session.masterSessionCode || session.master_session_code;
  if (direct) return String(direct);
  const key = String(session.sessionKey || session.session_key || "").trim();
  if (/^(RUN [A-D]|GYM [A-D]|RECOVERY)$/i.test(key)) return key.toUpperCase();
  const type = String(session.sessionType || session.session_type || session.type || "").toLowerCase();
  if (["race", "long_run"].includes(type)) return "RUN A";
  if (["intervals", "tempo"].includes(type)) return "RUN B";
  if (type === "easy_run") return "RUN C";
  if (type === "recovery_run") return "RUN D";
  if (type === "heavy_strength") return "GYM A";
  if (type === "strength") return "GYM B";
  if (["recovery", "mobility", "cross_training"].includes(type)) return "RECOVERY";
  return null;
}

export function formatPlanningIntensity(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const rpe = value.rpe_min !== null && value.rpe_min !== undefined
    ? `RPE ${value.rpe_min}${value.rpe_max !== null && value.rpe_max !== undefined && value.rpe_max !== value.rpe_min ? `-${value.rpe_max}` : ""}` : "";
  const rir = value.rir_min !== null && value.rir_min !== undefined
    ? `RIR ${value.rir_min}${value.rir_max !== null && value.rir_max !== undefined && value.rir_max !== value.rir_min ? `-${value.rir_max}` : ""}` : "";
  return [rpe, rir, value.pace_zone].filter(Boolean).join(" · ");
}

export function proposalSessionsToAssignments(sessions, weekStart) {
  const assignments = (sessions || []).map((session, index) => {
    const day = sessionDay(session, weekStart);
    const code = sessionCode(session);
    if (day === null || !code) {
      throw new PlanningApiError(`La sesión ${index + 1} no puede trasladarse a la agenda: falta día o código.`, { code: "INCOMPATIBLE_SESSION" });
    }
    return { day, code: String(code) };
  });
  const occupied = new Set();
  const codes = new Set();
  for (const assignment of assignments) {
    if (occupied.has(assignment.day)) {
      throw new PlanningApiError("La agenda actual no admite dos sesiones en el mismo día.", { code: "MULTIPLE_SESSIONS_PER_DAY" });
    }
    occupied.add(assignment.day);
    if (codes.has(assignment.code)) {
      throw new PlanningApiError(`La agenda local no puede distinguir dos sesiones con el código ${assignment.code}.`, { code: "DUPLICATE_SESSION_CODE" });
    }
    codes.add(assignment.code);
  }
  return assignments.sort((a, b) => a.day - b.day);
}

/** Proyección local de una revisión aceptada. Conserva exclusivamente el
 * progreso que pertenece al dispositivo; la prescripción procede del servidor. */
export function acceptedProposalToLocalWeek(proposalValue, weekStart, previous = {}) {
  const proposal = normalizeProposal(proposalValue);
  if (proposal.status !== "accepted") {
    throw new PlanningApiError("Solo se puede hidratar una revisión aceptada.", { code: "PROPOSAL_NOT_ACCEPTED" });
  }
  if (proposal.weekStart && String(proposal.weekStart).slice(0, 10) !== String(weekStart).slice(0, 10)) {
    throw new PlanningApiError("La revisión aceptada pertenece a otra versión del plan maestro.", { code: "MASTER_PLAN_MISMATCH" });
  }
  const acceptedAt = proposal.acceptedAt || proposal.accepted_at || null;
  return {
    assign: proposalSessionsToAssignments(proposal.sessions, weekStart),
    done: Array.isArray(previous?.done) ? previous.done : [],
    notes: Array.isArray(previous?.notes) ? previous.notes : [],
    generated: acceptedAt ? String(acceptedAt).slice(0, 10) : (previous?.generated || null),
    source: "ai-rag",
    proposalId: proposal.id,
    summary: proposal.summary,
    evidenceState: proposal.evidenceState,
    warnings: proposal.warnings || [],
    citations: proposal.citations || [],
    sessions: proposal.sessions,
  };
}
