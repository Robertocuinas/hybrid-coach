/* Guardarraíles posteriores a la generación. Los fallos hard invalidan la
   propuesta; los soft se muestran, pero nunca se "arreglan" cambiando carga. */

const MS_DIA = 86_400_000;
const numero = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
const valor = (o, ...ks) => { for (const k of ks) if (o?.[k] !== undefined && o?.[k] !== null) return o[k]; return null; };
const fecha = (o) => valor(o, "date", "fecha");
const codigo = (o) => String(valor(o, "master_session_code", "codigo_sesion", "codigoSesion", "running_code", "strength_code", "session_code", "code") || "");
const modalidad = (o) => String(valor(o, "modality", "tipo", "type") || "").toLowerCase();
const tipo = (o) => String(valor(o, "session_type", "sessionType", "subtipo") || "").toLowerCase();
const duracion = (o) => numero(valor(o, "duration_min", "duracion_min", "durationMin")) || 0;
const distancia = (o) => numero(o?.prescription?.distance_km ?? valor(o, "distance_km", "distancia_km", "distanciaKm")) || 0;
const diferenciaDias = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / MS_DIA);
const TIPOS_CARRERA = new Set(["long_run", "intervals", "tempo", "easy_run", "recovery_run", "race"]);
const TIPOS_FUERZA = new Set(["heavy_strength", "strength"]);
const esFuerza = (s) => modalidad(s) === "strength" || TIPOS_FUERZA.has(tipo(s)) || /gym|fuerza|strength/i.test(codigo(s));
const esFuerzaPesada = (s) => tipo(s) === "heavy_strength" || (esFuerza(s) && /heavy|pesad|pierna|lower/i.test(`${codigo(s)} ${s.title || ""}`));
const esCarrera = (s) => modalidad(s) === "running" || TIPOS_CARRERA.has(tipo(s)) || /run|carrera/i.test(codigo(s));
const esCalidad = (s) => ["intervals", "tempo", "race"].includes(tipo(s)) || /interval|tempo|calidad|run b/i.test(`${codigo(s)} ${s.title || ""}`);
const esTirada = (s) => tipo(s) === "long_run" || /long|tirada|run a/i.test(`${codigo(s)} ${s.title || ""}`);

function registrar(lista, code, message, path = "$", details = null) {
  lista.push({ code, message, path, details });
}

function maxDolor(contexto, analitica) {
  const registros = [
    ...(contexto.recovery || contexto.recuperacion || []),
    ...(contexto.checkins || []),
    ...(contexto.completedSessions || []),
  ];
  return Math.max(analitica?.seguridad?.dolorMaximo ?? 0, ...registros.map((x) => numero(x.dolor ?? x.pain) || 0));
}

function redFlags(contexto, analitica) {
  return [...(contexto.redFlags || contexto.banderas || []), ...(analitica?.seguridad?.redFlags || [])]
    .map(String).filter((flag) => flag && !/^ninguna$/i.test(flag.trim()));
}

function sesionesBaseActivas(contexto) {
  if (contexto.acceptedRevision) {
    return contexto.acceptedRevision.sessions
      || contexto.acceptedRevision.sesiones
      || contexto.acceptedSessions
      || [];
  }
  return contexto.week?.sessions
    || contexto.week?.sesiones
    || contexto.plannedSessions
    || [];
}

const idMaestro = (s) => valor(
  s,
  "master_planned_session_id",
  "masterPlannedSessionId",
) ?? s?.change_from_master?.master_session_id ?? null;

function sesionBase(contexto, completada) {
  const base = sesionesBaseActivas(contexto);
  return base.find((s) => {
    const cid = valor(completada, "weekly_plan_session_id", "planned_session_id", "plannedSessionId");
    const sid = valor(s, "id", "weekly_plan_session_id", "planned_session_id");
    const mid = idMaestro(s);
    if (cid && (String(cid) === String(mid || "") || (!mid && sid && String(cid) === String(sid)))) return true;
    const keyC = valor(completada, "session_key", "sessionKey"), keyS = valor(s, "session_key", "sessionKey");
    if (keyC && keyS && keyC === keyS) return true;
    return fecha(completada) === fecha(s) && codigo(completada) && codigo(completada) === codigo(s);
  });
}

function completadaParaSesion(contexto, sesion) {
  return (contexto.completedSessions || []).some((item) => sesionBase(contexto, item) === sesion
    || (fecha(item) === fecha(sesion) && codigo(item) && codigo(item) === codigo(sesion)));
}

function coincideInmutable(a, b) {
  return fecha(a) === fecha(b)
    && codigo(a) === codigo(b)
    && modalidad(a) === modalidad(b)
    && duracion(a) === duracion(b);
}

function volumen(sesiones, selector = () => true) {
  const elegidas = sesiones.filter(selector);
  return {
    minutos: elegidas.reduce((n, s) => n + duracion(s), 0),
    km: elegidas.reduce((n, s) => n + distancia(s), 0),
    sesiones: elegidas.length,
  };
}

const resumenSesion = (s) => ({
  session_key: valor(s, "session_key", "sessionKey") || codigo(s),
  date: fecha(s),
  day_of_week: valor(s, "day_of_week", "dia_semana", "day"),
  modality: modalidad(s),
  session_type: tipo(s),
  master_session_code: codigo(s) || null,
  duration_min: duracion(s),
  intensity: s?.intensity ?? s?.intensidad ?? null,
});

const diaSemana = (o) => {
  const v = numero(valor(o, "day_of_week", "dia_semana", "day"));
  return Number.isInteger(v) ? v : null;
};

/* Comparar por fecha a secas daba SIEMPRE "moved".
   `planned_sessions` guarda `dia_semana` y no tiene columna de fecha: una sesión
   del plan maestro no lleva ninguna. Así que `fecha(original)` era null y
   `fecha(actual)` una fecha real, y null !== "2026-08-18" marcaba como movida
   hasta la sesión que se dejaba exactamente donde estaba. El modelo no podía
   acertar: veía date:null en la base, declaraba "unchanged" con toda la lógica
   del mundo, y el diff lo contradecía en todas y cada una de las sesiones.

   Se compara con lo que de verdad hay: fecha contra fecha cuando las dos la
   tienen —la revisión aceptada sí— y día de la semana cuando la base solo trae
   eso. Sin base comparable no se inventa un movimiento. */
export function seHaMovido(original, actual) {
  const fechaOriginal = fecha(original), fechaActual = fecha(actual);
  if (fechaOriginal && fechaActual) return fechaOriginal !== fechaActual;
  const diaOriginal = diaSemana(original), diaActual = diaSemana(actual);
  if (diaOriginal !== null && diaActual !== null) return diaOriginal !== diaActual;
  return false;
}

const intensidadCanonica = (s) => JSON.stringify(s?.intensity ?? s?.intensidad ?? null);
const claveSesion = (s) => String(valor(s, "session_key", "sessionKey") || codigo(s) || "");

function encontrarCorrespondencia(base, propuestas, usadas) {
  const master = valor(base, "id", "planned_session_id", "plannedSessionId") || idMaestro(base);
  const key = claveSesion(base);
  const code = codigo(base);
  const candidatos = propuestas.map((session, index) => ({ session, index })).filter(({ index }) => !usadas.has(index));
  return candidatos.find(({ session }) => master && String(idMaestro(session) || "") === String(master))
    || candidatos.find(({ session }) => key && claveSesion(session) === key)
    || candidatos.find(({ session }) => code && codigo(session) === code)
    || null;
}

/** Diff calculado por código; nunca se confía en la etiqueta que devolvió el
 * modelo para decidir si una sesión cambió. */
export function derivarCambiosPlan(contexto, sesiones = []) {
  const base = sesionesBaseActivas(contexto);
  const usadas = new Set();
  const cambios = [];
  for (const original of base) {
    const match = encontrarCorrespondencia(original, sesiones, usadas);
    const key = claveSesion(original);
    if (!match) {
      cambios.push({ type: "removed", session_key: key, before: resumenSesion(original), after: null });
      continue;
    }
    usadas.add(match.index);
    const actual = match.session;
    let type = "unchanged";
    const tipoOriginal = tipo(original);
    if (modalidad(original) !== modalidad(actual)
      || (tipoOriginal && tipoOriginal !== tipo(actual))
      || codigo(original) !== codigo(actual)) {
      type = "substituted";
    } else if (seHaMovido(original, actual)) {
      type = "moved";
    } else if (duracion(original) !== duracion(actual)
      || ((original?.intensity && typeof original.intensity === "object")
        && intensidadCanonica(original) !== intensidadCanonica(actual))) {
      const originalRpe = numero(original?.intensity?.rpe_max ?? original?.intensidad?.rpe_max);
      const actualRpe = numero(actual?.intensity?.rpe_max ?? actual?.intensidad?.rpe_max);
      const soloReduce = duracion(actual) <= duracion(original)
        && (originalRpe === null || actualRpe === null || actualRpe <= originalRpe);
      type = soloReduce ? "reduced" : "unsupported_increase";
    }
    cambios.push({ type, session_key: claveSesion(actual) || key, before: resumenSesion(original), after: resumenSesion(actual), session: actual });
  }
  sesiones.forEach((session, index) => {
    if (!usadas.has(index)) cambios.push({
      type: "added",
      session_key: claveSesion(session),
      before: null,
      after: resumenSesion(session),
      session,
    });
  });
  return cambios;
}

const DIA_NOMBRE = Object.freeze({
  lunes: 0, martes: 1, miercoles: 2, miércoles: 2, jueves: 3,
  viernes: 4, sabado: 5, sábado: 5, domingo: 6,
});

function coachRequestMatches(cambio, cambios) {
  if (!cambio) return true;
  const esperado = {
    mover: "moved",
    sustituir: "substituted",
    reducir_volumen: "reduced",
    reducir_intensidad: "reduced",
    eliminar: "removed",
    descansar: "removed",
  }[cambio.tipo];
  const source = String(cambio.de || "").trim().toLowerCase();
  const target = String(cambio.a || "").trim().toLowerCase();
  const day = DIA_NOMBRE[String(cambio.dia || "").trim().toLowerCase()];
  return cambios.some((item) => {
    if (item.type !== esperado) return false;
    const beforeCode = String(item.before?.master_session_code || item.session_key || "").toLowerCase();
    const afterCode = String(item.after?.master_session_code || "").toLowerCase();
    if (source && !beforeCode.includes(source) && !source.includes(beforeCode)) return false;
    if (target && !afterCode.includes(target) && !target.includes(afterCode)) return false;
    if (Number.isInteger(day) && item.after?.day_of_week !== day) return false;
    return true;
  });
}

export const DEFAULT_GUARDRAIL_CONFIG = Object.freeze({
  painThreshold: 5,
  maxWeeklyIncreasePct: 10,
  minRestDays: 1,
  maxConsecutiveTrainingDays: 3,
  minHeavyBeforeLongRunDays: 2,
  taperMaxVolumeRatio: 1,
  maxRunningSpeedKmH: 24,
  requireEvidencePerSession: true,
});
export const GUARDRAILS_VERSION = "weekly-guardrails.1";

export function evaluarGuardrailsPlan(propuesta, contexto = {}, analitica = {}, config = {}) {
  const cfg = { ...DEFAULT_GUARDRAIL_CONFIG, ...config };
  const hard = [], soft = [];
  const sesiones = Array.isArray(propuesta?.sessions) ? propuesta.sessions : [];
  const dolor = maxDolor(contexto, analitica);
  const reposo = !!(analitica?.seguridad?.dolorEnReposo || contexto.painAtRest || contexto.dolorEnReposo);
  const banderas = redFlags(contexto, analitica);

  if (dolor >= cfg.painThreshold && sesiones.some(esCarrera)) {
    registrar(hard, "PAIN_HIGH_IMPACT", `Con dolor ${dolor}/10 no se autoriza carrera ni impacto.`, "$.sessions");
  }
  if ((reposo || banderas.length) && sesiones.some((s) => esCarrera(s) || modalidad(s) === "cross_training")) {
    registrar(hard, "CLINICAL_RED_FLAG", "Dolor en reposo o señales de alarma: se detiene el impacto y se deriva a un profesional sanitario.", "$.sessions", { redFlags: banderas });
  }
  if ((reposo || banderas.length) && !propuesta?.warnings?.some((w) => w.severity === "critical")) {
    registrar(hard, "CLINICAL_WARNING_REQUIRED", "La propuesta debe incluir un aviso clínico crítico.", "$.warnings");
  }

  const disponibilidadBruta = contexto.availability || contexto.disponibilidad || [];
  const disponibilidad = Array.isArray(disponibilidadBruta)
    ? disponibilidadBruta
    : disponibilidadBruta.days || disponibilidadBruta.dias || [];
  const dias = new Set(), fechas = new Set();
  for (const d of disponibilidad) {
    if (Number.isInteger(d)) dias.add(d);
    else if (typeof d === "string") fechas.add(d);
    else { if (Number.isInteger(d?.day ?? d?.diaSemana)) dias.add(d.day ?? d.diaSemana); if (d?.date || d?.fecha) fechas.add(d.date || d.fecha); }
  }
  const hoy = String(contexto.now || analitica?.calculadaEn || "").slice(0, 10);
  sesiones.forEach((s, i) => {
    const yaCompletada = completadaParaSesion(contexto, s);
    if (hoy && fecha(s) < hoy && !yaCompletada) {
      registrar(hard, "PAST_SESSION_NOT_COMPLETED", "Una replanificación no puede volver a programar una sesión pasada no completada.", `$.sessions[${i}].date`);
    }
    if (!yaCompletada && (dias.size || fechas.size) && !dias.has(s.day_of_week) && !fechas.has(s.date)) {
      registrar(hard, "UNAVAILABLE_DAY", "Sesión colocada en un día no disponible.", `$.sessions[${i}].date`);
    }
    if (cfg.requireEvidencePerSession && !(s.evidence_ids || []).length) registrar(hard, "SESSION_WITHOUT_EVIDENCE", "Cada sesión propuesta debe indicar la evidencia usada.", `$.sessions[${i}].evidence_ids`);
  });
  const constraints = contexto.constraints || contexto.restricciones || {};
  if (constraints.allowRunning === false && sesiones.some(esCarrera)) {
    registrar(hard, "RUNNING_NOT_SELECTED", "El atleta desactivó la carrera para esta semana.", "$.sessions");
  }
  if (constraints.allowStrength === false && sesiones.some(esFuerza)) {
    registrar(hard, "STRENGTH_NOT_SELECTED", "El atleta desactivó la fuerza para esta semana.", "$.sessions");
  }
  const cambiosDerivados = derivarCambiosPlan(contexto, sesiones);
  const cambiosDeclarados = propuesta?.changes_from_master_plan || [];
  const declaradosPorClave = new Map();
  for (const [i, cambio] of cambiosDeclarados.entries()) {
    const key = String(cambio.session_key || "");
    if (declaradosPorClave.has(key)) registrar(hard, "DUPLICATE_DECLARED_CHANGE", "El mismo cambio está declarado más de una vez.", `$.changes_from_master_plan[${i}]`);
    declaradosPorClave.set(key, cambio);
    if (!(cambio.evidence_ids || []).length) registrar(hard, "CHANGE_WITHOUT_EVIDENCE", "Todo cambio respecto al plan activo debe indicar la evidencia usada.", `$.changes_from_master_plan[${i}].evidence_ids`);
  }
  for (const derivado of cambiosDerivados) {
    const declaradoEnSesion = derivado.session?.change_from_master?.type;
    if (derivado.type === "unsupported_increase") {
      registrar(hard, "UNSUPPORTED_LOAD_INCREASE", "Un aumento de carga no puede ocultarse como sesión sin cambios.", "$.sessions", { session: derivado.session_key });
      continue;
    }
    if (derivado.session && declaradoEnSesion !== derivado.type) {
      registrar(hard, "SESSION_CHANGE_MISMATCH", "La etiqueta change_from_master no coincide con el cambio real calculado.", "$.sessions", {
        session: derivado.session_key, declared: declaradoEnSesion, actual: derivado.type,
      });
    }
    const declarado = declaradosPorClave.get(String(derivado.session_key));
    if (derivado.type === "unchanged") {
      if (declarado) registrar(hard, "SPURIOUS_DECLARED_CHANGE", "Se declaró un cambio que no existe en la agenda calculada.", "$.changes_from_master_plan", { session: derivado.session_key });
    } else if (!declarado || declarado.type !== derivado.type) {
      registrar(hard, "MISSING_OR_INCORRECT_CHANGE", "Todo cambio real debe aparecer con su tipo correcto en changes_from_master_plan.", "$.changes_from_master_plan", {
        session: derivado.session_key, actual: derivado.type,
      });
    }
  }
  for (const [key] of declaradosPorClave) {
    if (!cambiosDerivados.some((item) => String(item.session_key) === key && item.type !== "unchanged")) {
      registrar(hard, "SPURIOUS_DECLARED_CHANGE", "Se declaró un cambio que no existe en la agenda calculada.", "$.changes_from_master_plan", { session: key });
    }
  }
  if (!coachRequestMatches(contexto.coachRequest?.cambio, cambiosDerivados)) {
    registrar(hard, "COACH_REQUEST_MISMATCH", "La semana generada no materializa exactamente el cambio que el atleta confirmó en el Coach.", "$.sessions");
  }
  if (sesiones.length && propuesta?.summary?.evidence_state === "none") registrar(hard, "NO_EVIDENCE_FOR_PLAN", "No se puede proponer una semana con estado de evidencia 'none'.", "$.summary.evidence_state");

  /* Lo ya realizado es historia, no una sugerencia editable. */
  for (const completada of contexto.completedSessions || []) {
    const base = sesionBase(contexto, completada);
    if (!base) continue;
    const key = valor(base, "session_key", "sessionKey");
    const propuestaMisma = sesiones.find((s) => (key && s.session_key === key) || (fecha(s) === fecha(base) && codigo(s) === codigo(base)));
    if (!propuestaMisma || !coincideInmutable(propuestaMisma, base)) registrar(hard, "COMPLETED_IMMUTABLE", "Una sesión completada no se puede mover, eliminar ni reescribir.", "$.sessions", { session: key || codigo(base) });
  }

  const plan = contexto.plan || {};
  const techo = numero(cfg.longRunCeilingMin ?? valor(contexto.week, "techo_tirada_larga_min", "longRunCeilingMin") ?? valor(plan, "techo_tirada_larga_min", "longRunCeilingMin"));
  if (techo !== null) sesiones.filter(esTirada).forEach((s, i) => {
    if (duracion(s) > techo) registrar(hard, "LONG_RUN_CEILING", `La tirada larga supera el techo de ${techo} min.`, `$.sessions[${i}].duration_min`);
  });

  const baseSesiones = sesionesBaseActivas(contexto);
  const baseVol = volumen(baseSesiones, esCarrera);
  const propuestoVol = volumen(sesiones, esCarrera);
  const historialMinutos = numero(analitica?.comparativaAnterior7d?.minutosCarrera)
    || numero(analitica?.ventana7d?.minutosCarrera)
    || 0;
  const referenciasPositivas = [baseVol.minutos, historialMinutos].filter((n) => n > 0);
  const referencia = numero(cfg.baselineRunningMinutes)
    ?? (referenciasPositivas.length ? Math.min(...referenciasPositivas) : 0);
  if (referencia > 0 && propuestoVol.minutos > referencia * (1 + cfg.maxWeeklyIncreasePct / 100)) {
    registrar(hard, "WEEKLY_PROGRESSION_LIMIT", `El volumen de carrera supera el incremento máximo del ${cfg.maxWeeklyIncreasePct}%.`, "$.sessions");
  }
  const historialKm = numero(analitica?.comparativaAnterior7d?.km)
    || numero(analitica?.ventana7d?.km)
    || 0;
  const referenciasKm = [baseVol.km, historialKm].filter((n) => n > 0);
  const referenciaKm = referenciasKm.length ? Math.min(...referenciasKm) : 0;
  if (referenciaKm > 0 && propuestoVol.km > referenciaKm * (1 + cfg.maxWeeklyIncreasePct / 100)) {
    registrar(hard, "WEEKLY_DISTANCE_PROGRESSION_LIMIT", `La distancia de carrera supera el incremento máximo del ${cfg.maxWeeklyIncreasePct}%.`, "$.sessions");
  }
  sesiones.filter(esCarrera).forEach((s, i) => {
    const km = distancia(s), minutos = duracion(s);
    if (km > 0 && (!minutos || km > (minutos / 60) * cfg.maxRunningSpeedKmH)) {
      registrar(hard, "IMPLAUSIBLE_RUNNING_DISTANCE", "La distancia no es compatible con la duración de la sesión.", `$.sessions[${i}].prescription.distance_km`);
    }
  });

  const taper = !!(valor(contexto.week, "es_taper", "isTaper") || /taper|carrera/i.test(String(valor(contexto.week, "fase", "phase") || "")));
  if (taper && baseVol.minutos > 0 && propuestoVol.minutos > baseVol.minutos * cfg.taperMaxVolumeRatio) registrar(hard, "TAPER_VOLUME_INCREASE", "En taper no se puede aumentar el volumen sobre el plan maestro.", "$.sessions");

  const fechasEntreno = [...new Set(sesiones.map(fecha).filter(Boolean))].sort();
  const fechasDuplicadas = fechasEntreno.filter((f) => sesiones.filter((s) => fecha(s) === f).length > 1);
  if (fechasDuplicadas.length) registrar(hard, "MULTIPLE_SESSIONS_SAME_DAY_UNSUPPORTED", "No se permiten dos sesiones el mismo día sin poder validar una separación horaria mínima.", "$.sessions", { fechas: fechasDuplicadas });
  const descanso = 7 - fechasEntreno.length;
  if (descanso < cfg.minRestDays) registrar(hard, "MIN_REST", `Se requieren al menos ${cfg.minRestDays} día(s) completos de descanso.`, "$.sessions");
  let racha = 1, maxima = fechasEntreno.length ? 1 : 0;
  for (let i = 1; i < fechasEntreno.length; i++) { racha = diferenciaDias(fechasEntreno[i - 1], fechasEntreno[i]) === 1 ? racha + 1 : 1; maxima = Math.max(maxima, racha); }
  if (maxima > cfg.maxConsecutiveTrainingDays) registrar(hard, "MAX_STREAK", `No se permiten más de ${cfg.maxConsecutiveTrainingDays} días consecutivos de entrenamiento.`, "$.sessions");

  const pesadas = sesiones.filter(esFuerzaPesada), tiradas = sesiones.filter(esTirada), calidades = sesiones.filter(esCalidad);
  for (const pesada of pesadas) for (const larga of tiradas) {
    const gap = diferenciaDias(fecha(pesada), fecha(larga));
    if (gap > 0 && gap < cfg.minHeavyBeforeLongRunDays) registrar(hard, "HEAVY_BEFORE_LONG_RUN", "La fuerza pesada queda demasiado cerca antes de la tirada larga.", "$.sessions");
  }
  for (const pesada of pesadas) for (const calidad of calidades) if (diferenciaDias(fecha(pesada), fecha(calidad)) === 1) registrar(hard, "QUALITY_AFTER_HEAVY", "La calidad no puede ir al día siguiente de fuerza pesada de piernas.", "$.sessions");
  const fuerzas = sesiones.filter(esFuerza).sort((a, b) => fecha(a).localeCompare(fecha(b)));
  if (fuerzas.length <= 2) for (let i = 1; i < fuerzas.length; i++) if (Math.abs(diferenciaDias(fecha(fuerzas[i - 1]), fecha(fuerzas[i]))) <= 1) registrar(hard, "CONSECUTIVE_STRENGTH", "Dos sesiones de fuerza no pueden ir en días consecutivos.", "$.sessions");

  const perdidas = analitica?.adherencia?.perdidas || [];
  const catchUp = sesiones.some((s) => s.change_from_master?.type === "added" && /recuper|compens|perdid|dobl/i.test(`${s.public_reason || ""} ${s.prescription?.notes || ""}`));
  const dobleDia = fechasEntreno.some((f) => sesiones.filter((s) => fecha(s) === f).length > 1);
  if (perdidas.length && (catchUp || dobleDia || sesiones.length > baseSesiones.length)) registrar(hard, "NO_CATCH_UP", "Las sesiones perdidas no se recuperan acumulando o doblando carga.", "$.sessions");

  if (propuesta?.summary?.evidence_state === "mixed" && !(propuesta.mixed_evidence || []).length) registrar(hard, "MIXED_EVIDENCE_DETAILS", "La evidencia mixta debe exponer posiciones y elección conservadora.", "$.mixed_evidence");
  if (propuesta?.summary?.evidence_state === "limited") registrar(soft, "LIMITED_EVIDENCE", "La propuesta reconoce evidencia limitada.", "$.summary.evidence_state");
  if (analitica?.adherencia?.ratio !== null && analitica?.adherencia?.ratio < 0.75) registrar(soft, "LOW_ADHERENCE", "La adherencia reciente es baja; conviene priorizar continuidad sobre progresión.", "$", { ratio: analitica.adherencia.ratio });

  return { valid: hard.length === 0, hard, soft, config: cfg };
}

export const evaluatePlanGuardrails = evaluarGuardrailsPlan;
