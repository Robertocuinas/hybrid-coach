/* Contrato semanal versionado. Es deliberadamente estricto: una propiedad que
   el backend no entiende no puede convertirse accidentalmente en una orden. */

export const WEEKLY_PLAN_SCHEMA_VERSION = "weekly-plan.v1";
export const MODALIDADES = Object.freeze(["running", "strength", "recovery", "cross_training"]);
export const TIPOS_SESION = Object.freeze(["long_run", "intervals", "tempo", "easy_run", "recovery_run", "heavy_strength", "strength", "mobility", "cross_training", "race"]);
export const PRIORIDADES = Object.freeze(["key", "support", "recovery"]);
export const TIPOS_CAMBIO = Object.freeze(["unchanged", "moved", "reduced", "substituted", "removed", "added"]);
export const ESTADOS_EVIDENCIA = Object.freeze(["sufficient", "limited", "mixed", "none"]);
export const CODIGOS_AGENDA = Object.freeze([
  "RUN A", "RUN B", "RUN C", "RUN D",
  "GYM A", "GYM B", "GYM C", "GYM D", "RECOVERY",
]);

const TIPOS_POR_MODALIDAD = Object.freeze({
  running: new Set(["long_run", "intervals", "tempo", "easy_run", "recovery_run", "race"]),
  strength: new Set(["heavy_strength", "strength"]),
  recovery: new Set(["mobility"]),
  cross_training: new Set(["cross_training"]),
});

const esObjeto = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const esCadena = (v, min = 0, max = Infinity) => typeof v === "string" && v.length >= min && v.length <= max;
const esNumero = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const esEnteroONull = (v, min, max) => v === null || (Number.isInteger(v) && v >= min && v <= max);
const fechaISO = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

const DIAS = [6, 0, 1, 2, 3, 4, 5]; // getUTCDay -> lunes=0
const diaDeFecha = (fecha) => DIAS[new Date(`${fecha}T12:00:00Z`).getUTCDay()];

function error(lista, path, code, message) {
  lista.push({ path, code, message });
}

function clavesExactas(valor, permitidas, path, errores) {
  if (!esObjeto(valor)) { error(errores, path, "TYPE", "debe ser un objeto"); return false; }
  for (const key of Object.keys(valor)) if (!permitidas.includes(key)) error(errores, `${path}.${key}`, "UNKNOWN_PROPERTY", "propiedad no permitida");
  for (const key of permitidas) if (!Object.hasOwn(valor, key)) error(errores, `${path}.${key}`, "REQUIRED", "propiedad obligatoria");
  return true;
}

export function parsearPlanSemanal(texto) {
  if (esObjeto(texto)) return { ok: true, value: texto, errors: [] };
  const bruto = String(texto ?? "").trim();
  if (!bruto) return { ok: false, value: null, errors: [{ path: "$", code: "EMPTY", message: "respuesta vacía" }] };
  const sinBloque = bruto.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const inicio = sinBloque.indexOf("{");
  const fin = sinBloque.lastIndexOf("}");
  const candidato = inicio >= 0 && fin >= inicio ? sinBloque.slice(inicio, fin + 1) : sinBloque;
  try {
    const value = JSON.parse(candidato);
    return esObjeto(value)
      ? { ok: true, value, errors: [] }
      : { ok: false, value: null, errors: [{ path: "$", code: "TYPE", message: "la raíz debe ser un objeto" }] };
  } catch (e) {
    return { ok: false, value: null, errors: [{ path: "$", code: "INVALID_JSON", message: String(e.message).slice(0, 180) }] };
  }
}

function validarIntensidad(valor, path, errores) {
  if (!clavesExactas(valor, ["rpe_min", "rpe_max", "rir_min", "rir_max", "pace_zone"], path, errores)) return;
  for (const key of ["rpe_min", "rpe_max", "rir_min", "rir_max"]) if (!esEnteroONull(valor[key], 0, 10)) error(errores, `${path}.${key}`, "RANGE", "debe ser null o entero entre 0 y 10");
  if (valor.pace_zone !== null && !esCadena(valor.pace_zone, 1, 60)) error(errores, `${path}.pace_zone`, "TYPE", "debe ser null o texto de hasta 60 caracteres");
  if (valor.rpe_min !== null && valor.rpe_max !== null && valor.rpe_min > valor.rpe_max) error(errores, path, "ORDER", "rpe_min no puede superar rpe_max");
  if (valor.rir_min !== null && valor.rir_max !== null && valor.rir_min > valor.rir_max) error(errores, path, "ORDER", "rir_min no puede superar rir_max");
}

function validarPrescripcion(valor, path, errores) {
  if (!clavesExactas(valor, ["distance_km", "sets", "reps", "notes"], path, errores)) return;
  if (valor.distance_km !== null && !esNumero(valor.distance_km, 0, 500)) error(errores, `${path}.distance_km`, "RANGE", "debe ser null o número entre 0 y 500");
  if (!esEnteroONull(valor.sets, 0, 100)) error(errores, `${path}.sets`, "RANGE", "debe ser null o entero entre 0 y 100");
  if (valor.reps !== null && !(esCadena(valor.reps, 1, 40) || esNumero(valor.reps, 0, 1000))) error(errores, `${path}.reps`, "TYPE", "debe ser null, número o texto breve");
  if (valor.notes !== null && !esCadena(valor.notes, 0, 500)) error(errores, `${path}.notes`, "TYPE", "debe ser null o texto de hasta 500 caracteres");
}

function validarCambioSesion(valor, path, errores) {
  if (!clavesExactas(valor, ["type", "master_session_id"], path, errores)) return;
  if (!TIPOS_CAMBIO.includes(valor.type)) error(errores, `${path}.type`, "ENUM", "tipo de cambio no permitido");
  if (valor.master_session_id !== null && !esCadena(valor.master_session_id, 1, 100)) error(errores, `${path}.master_session_id`, "TYPE", "debe ser null o identificador");
}

function validarRefs(refs, path, errores, entregados) {
  if (!Array.isArray(refs)) { error(errores, path, "TYPE", "debe ser un array"); return; }
  const vistos = new Set();
  refs.forEach((id, i) => {
    if (!esCadena(id, 1, 100)) error(errores, `${path}[${i}]`, "TYPE", "debe ser un identificador");
    else if (!entregados.has(id)) error(errores, `${path}[${i}]`, "UNKNOWN_EVIDENCE", "el fragmento no fue entregado al modelo");
    else if (vistos.has(id)) error(errores, `${path}[${i}]`, "DUPLICATE", "cita duplicada");
    vistos.add(id);
  });
}

function normalizarDisponibilidad(disponibilidad = []) {
  const dias = new Set(), fechas = new Set();
  for (const valor of disponibilidad || []) {
    if (Number.isInteger(valor) && valor >= 0 && valor <= 6) dias.add(valor);
    else if (fechaISO(valor)) fechas.add(valor);
    else if (esObjeto(valor)) {
      const fecha = valor.date || valor.fecha;
      const dia = valor.day ?? valor.diaSemana ?? valor.dia_semana;
      if (fechaISO(fecha)) fechas.add(fecha);
      if (Number.isInteger(dia) && dia >= 0 && dia <= 6) dias.add(dia);
    }
  }
  return { dias, fechas };
}

/** Valida y devuelve el mismo objeto; nunca elimina silenciosamente campos o citas. */
export function validarPlanSemanal(valor, opciones = {}) {
  const errores = [], warnings = [];
  const entregados = new Set((opciones.evidenceIds || opciones.idsEvidencia || []).map(String));
  const disponibilidad = normalizarDisponibilidad(opciones.availabilityDays || opciones.disponibilidad || []);
  const root = ["schema_version", "week", "summary", "sessions", "changes_from_master_plan", "warnings", "mixed_evidence", "missing_evidence"];
  if (!clavesExactas(valor, root, "$", errores)) return { ok: false, value: null, errors: errores, warnings };
  if (valor.schema_version !== WEEKLY_PLAN_SCHEMA_VERSION) error(errores, "$.schema_version", "VERSION", `debe ser ${WEEKLY_PLAN_SCHEMA_VERSION}`);

  if (clavesExactas(valor.week, ["start_date", "end_date", "master_plan_id", "master_week_id"], "$.week", errores)) {
    if (!fechaISO(valor.week.start_date)) error(errores, "$.week.start_date", "DATE", "fecha ISO inválida");
    if (!fechaISO(valor.week.end_date)) error(errores, "$.week.end_date", "DATE", "fecha ISO inválida");
    if (fechaISO(valor.week.start_date) && fechaISO(valor.week.end_date) && valor.week.start_date > valor.week.end_date) error(errores, "$.week", "DATE_ORDER", "start_date debe preceder a end_date");
    for (const key of ["master_plan_id", "master_week_id"]) if (valor.week[key] !== null && !esCadena(valor.week[key], 1, 100)) error(errores, `$.week.${key}`, "TYPE", "debe ser null o identificador");
    if (opciones.weekStart && valor.week.start_date !== opciones.weekStart) error(errores, "$.week.start_date", "CONTEXT_MISMATCH", "no coincide con la semana solicitada");
    if (opciones.weekEnd && valor.week.end_date !== opciones.weekEnd) error(errores, "$.week.end_date", "CONTEXT_MISMATCH", "no coincide con la semana solicitada");
    if (opciones.masterPlanId && String(valor.week.master_plan_id) !== String(opciones.masterPlanId)) error(errores, "$.week.master_plan_id", "CONTEXT_MISMATCH", "no coincide con el plan maestro solicitado");
    if (opciones.masterWeekId && String(valor.week.master_week_id) !== String(opciones.masterWeekId)) error(errores, "$.week.master_week_id", "CONTEXT_MISMATCH", "no coincide con la semana maestra solicitada");
  }

  if (clavesExactas(valor.summary, ["public_reason", "confidence", "evidence_state"], "$.summary", errores)) {
    if (!esCadena(valor.summary.public_reason, 1, 500)) error(errores, "$.summary.public_reason", "LENGTH", "debe tener entre 1 y 500 caracteres");
    if (!esNumero(valor.summary.confidence, 0, 1)) error(errores, "$.summary.confidence", "RANGE", "debe estar entre 0 y 1");
    if (!ESTADOS_EVIDENCIA.includes(valor.summary.evidence_state)) error(errores, "$.summary.evidence_state", "ENUM", "estado de evidencia no permitido");
  }

  if (!Array.isArray(valor.sessions) || valor.sessions.length < 1 || valor.sessions.length > 14) error(errores, "$.sessions", "RANGE", "debe ser un array de 1 a 14 sesiones");
  const clavesSesion = ["session_key", "date", "day_of_week", "modality", "session_type", "master_session_code", "title", "priority", "duration_min", "intensity", "prescription", "objective", "public_reason", "evidence_ids", "change_from_master"];
  const keys = new Set();
  const agendaCodes = new Set();
  const masterCodes = new Set((opciones.masterSessionCodes || []).map((code) => String(code).toUpperCase()));
  (Array.isArray(valor.sessions) ? valor.sessions : []).forEach((s, i) => {
    const path = `$.sessions[${i}]`;
    if (!clavesExactas(s, clavesSesion, path, errores)) return;
    if (!esCadena(s.session_key, 1, 80)) error(errores, `${path}.session_key`, "LENGTH", "identificador de sesión inválido");
    else if (keys.has(s.session_key)) error(errores, `${path}.session_key`, "DUPLICATE", "session_key duplicado");
    keys.add(s.session_key);
    if (!fechaISO(s.date)) error(errores, `${path}.date`, "DATE", "fecha ISO inválida");
    if (!Number.isInteger(s.day_of_week) || s.day_of_week < 0 || s.day_of_week > 6) error(errores, `${path}.day_of_week`, "RANGE", "debe estar entre 0 y 6");
    if (fechaISO(s.date) && s.day_of_week !== diaDeFecha(s.date)) error(errores, `${path}.day_of_week`, "DATE_MISMATCH", "no corresponde a la fecha");
    if (fechaISO(s.date) && fechaISO(valor.week?.start_date) && (s.date < valor.week.start_date || s.date > valor.week.end_date)) error(errores, `${path}.date`, "OUTSIDE_WEEK", "la sesión cae fuera de la semana");
    if ((!opciones.today || s.date > opciones.today)
      && (disponibilidad.dias.size || disponibilidad.fechas.size)
      && !disponibilidad.dias.has(s.day_of_week) && !disponibilidad.fechas.has(s.date)) {
      error(errores, `${path}.date`, "UNAVAILABLE", "día no disponible");
    }
    if (!MODALIDADES.includes(s.modality)) error(errores, `${path}.modality`, "ENUM", "modalidad no permitida");
    if (!TIPOS_SESION.includes(s.session_type)) error(errores, `${path}.session_type`, "ENUM", "tipo de sesión no permitido");
    if (TIPOS_POR_MODALIDAD[s.modality] && !TIPOS_POR_MODALIDAD[s.modality].has(s.session_type)) {
      error(errores, `${path}.session_type`, "MODALITY_MISMATCH", "el tipo de sesión no corresponde a la modalidad");
    }
    if (s.master_session_code !== null && !esCadena(s.master_session_code, 1, 80)) error(errores, `${path}.master_session_code`, "TYPE", "debe ser null o texto");
    const agendaCode = String(s.master_session_code
      || (["recovery", "cross_training"].includes(s.modality) ? "RECOVERY" : "")).toUpperCase();
    if (!agendaCode || !CODIGOS_AGENDA.includes(agendaCode)) {
      error(errores, `${path}.master_session_code`, "UNSUPPORTED_AGENDA_CODE", "la sesión no se puede representar en la agenda");
    } else if (agendaCodes.has(agendaCode)) {
      error(errores, `${path}.master_session_code`, "DUPLICATE_AGENDA_CODE", "el código de agenda ya está usado en esta semana");
    }
    agendaCodes.add(agendaCode);
    if (!esCadena(s.title, 1, 120) || !esCadena(s.objective, 1, 300) || !esCadena(s.public_reason, 1, 500)) error(errores, path, "TEXT", "título, objetivo y motivo son obligatorios y acotados");
    if (!PRIORIDADES.includes(s.priority)) error(errores, `${path}.priority`, "ENUM", "prioridad no permitida");
    if (!Number.isInteger(s.duration_min) || s.duration_min < 1 || s.duration_min > 360) error(errores, `${path}.duration_min`, "RANGE", "debe ser entero entre 1 y 360");
    validarIntensidad(s.intensity, `${path}.intensity`, errores);
    validarPrescripcion(s.prescription, `${path}.prescription`, errores);
    validarRefs(s.evidence_ids, `${path}.evidence_ids`, errores, entregados);
    validarCambioSesion(s.change_from_master, `${path}.change_from_master`, errores);
    if (s.change_from_master?.master_session_id !== null && opciones.masterSessionIds?.length
      && !new Set(opciones.masterSessionIds.map(String)).has(String(s.change_from_master.master_session_id))) {
      error(errores, `${path}.change_from_master.master_session_id`, "CONTEXT_MISMATCH", "la sesión maestra no pertenece a esta semana");
    }
    if (s.change_from_master?.type !== "substituted"
      && s.change_from_master?.type !== "added"
      && s.master_session_code
      && masterCodes.size
      && !masterCodes.has(String(s.master_session_code).toUpperCase())) {
      error(errores, `${path}.master_session_code`, "CONTEXT_MISMATCH", "el código no pertenece a la semana maestra");
    }
  });

  if (!Array.isArray(valor.changes_from_master_plan)) error(errores, "$.changes_from_master_plan", "TYPE", "debe ser un array");
  (Array.isArray(valor.changes_from_master_plan) ? valor.changes_from_master_plan : []).forEach((c, i) => {
    const path = `$.changes_from_master_plan[${i}]`;
    if (!clavesExactas(c, ["type", "session_key", "before", "after", "reason", "evidence_ids"], path, errores)) return;
    if (!TIPOS_CAMBIO.includes(c.type) || c.type === "unchanged") error(errores, `${path}.type`, "ENUM", "tipo de cambio no permitido");
    if (!esCadena(c.session_key, 1, 80) || !esCadena(c.reason, 1, 500)) error(errores, path, "TEXT", "session_key y reason son obligatorios");
    if (c.before !== null && !esObjeto(c.before)) error(errores, `${path}.before`, "TYPE", "debe ser null u objeto");
    if (c.after !== null && !esObjeto(c.after)) error(errores, `${path}.after`, "TYPE", "debe ser null u objeto");
    validarRefs(c.evidence_ids, `${path}.evidence_ids`, errores, entregados);
  });

  if (!Array.isArray(valor.warnings)) error(errores, "$.warnings", "TYPE", "debe ser un array");
  (Array.isArray(valor.warnings) ? valor.warnings : []).forEach((w, i) => {
    const path = `$.warnings[${i}]`;
    if (!clavesExactas(w, ["code", "severity", "message", "action"], path, errores)) return;
    if (!esCadena(w.code, 1, 60) || !["info", "warning", "critical"].includes(w.severity) || !esCadena(w.message, 1, 500) || (w.action !== null && !esCadena(w.action, 1, 300))) error(errores, path, "WARNING", "warning inválido");
  });

  if (!Array.isArray(valor.mixed_evidence)) error(errores, "$.mixed_evidence", "TYPE", "debe ser un array");
  (Array.isArray(valor.mixed_evidence) ? valor.mixed_evidence : []).forEach((m, i) => {
    const path = `$.mixed_evidence[${i}]`;
    if (!clavesExactas(m, ["topic", "positions", "conservative_choice"], path, errores)) return;
    if (!esCadena(m.topic, 1, 200) || !esCadena(m.conservative_choice, 1, 500) || !Array.isArray(m.positions) || m.positions.length < 2) error(errores, path, "MIXED_EVIDENCE", "debe describir al menos dos posiciones y una elección conservadora");
    (Array.isArray(m.positions) ? m.positions : []).forEach((p, j) => {
      const pth = `${path}.positions[${j}]`;
      if (!clavesExactas(p, ["summary", "evidence_ids"], pth, errores)) return;
      if (!esCadena(p.summary, 1, 500)) error(errores, `${pth}.summary`, "TEXT", "resumen obligatorio");
      validarRefs(p.evidence_ids, `${pth}.evidence_ids`, errores, entregados);
    });
  });
  if (!Array.isArray(valor.missing_evidence) || !valor.missing_evidence.every((x) => esCadena(x, 1, 300))) error(errores, "$.missing_evidence", "TYPE", "debe ser un array de textos breves");

  return { ok: errores.length === 0, value: errores.length ? null : valor, errors: errores, warnings };
}

export const parseWeeklyPlan = parsearPlanSemanal;
export const validateWeeklyPlan = validarPlanSemanal;
