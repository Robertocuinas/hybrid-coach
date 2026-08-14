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
const esFuerza = (s) => modalidad(s) === "strength" || /gym|fuerza|strength/i.test(codigo(s));
const esFuerzaPesada = (s) => tipo(s) === "heavy_strength" || (esFuerza(s) && /heavy|pesad|pierna|lower/i.test(`${codigo(s)} ${s.title || ""}`));
const esCarrera = (s) => modalidad(s) === "running" || /run|carrera/i.test(codigo(s));
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
  return [...(contexto.redFlags || contexto.banderas || []), ...(analitica?.seguridad?.redFlags || [])].map(String).filter(Boolean);
}

function sesionBase(contexto, completada) {
  const base = contexto.acceptedRevision?.sessions || contexto.acceptedRevision?.sesiones || contexto.acceptedSessions || contexto.plannedSessions || [];
  return base.find((s) => {
    const cid = valor(completada, "weekly_plan_session_id", "planned_session_id", "plannedSessionId");
    const sid = valor(s, "id", "weekly_plan_session_id", "planned_session_id");
    if (cid && sid) return String(cid) === String(sid);
    const keyC = valor(completada, "session_key", "sessionKey"), keyS = valor(s, "session_key", "sessionKey");
    if (keyC && keyS) return keyC === keyS;
    return fecha(completada) === fecha(s) && codigo(completada) && codigo(completada) === codigo(s);
  });
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

export const DEFAULT_GUARDRAIL_CONFIG = Object.freeze({
  painThreshold: 5,
  maxWeeklyIncreasePct: 10,
  minRestDays: 1,
  maxConsecutiveTrainingDays: 3,
  minHeavyBeforeLongRunDays: 2,
  taperMaxVolumeRatio: 1,
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
  sesiones.forEach((s, i) => {
    if ((dias.size || fechas.size) && !dias.has(s.day_of_week) && !fechas.has(s.date)) registrar(hard, "UNAVAILABLE_DAY", "Sesión colocada en un día no disponible.", `$.sessions[${i}].date`);
    if (cfg.requireEvidencePerSession && !(s.evidence_ids || []).length) registrar(hard, "SESSION_WITHOUT_EVIDENCE", "Cada sesión propuesta debe indicar la evidencia usada.", `$.sessions[${i}].evidence_ids`);
  });
  for (const [i, cambio] of (propuesta?.changes_from_master_plan || []).entries()) {
    if (!(cambio.evidence_ids || []).length) registrar(hard, "CHANGE_WITHOUT_EVIDENCE", "Todo cambio respecto al plan maestro debe indicar la evidencia usada.", `$.changes_from_master_plan[${i}].evidence_ids`);
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

  const baseSesiones = contexto.week?.sessions || contexto.week?.sesiones || contexto.plannedSessions || [];
  const baseVol = volumen(baseSesiones, esCarrera);
  const propuestoVol = volumen(sesiones, esCarrera);
  const referencia = numero(cfg.baselineRunningMinutes)
    ?? (baseVol.minutos || analitica?.comparativaAnterior7d?.minutosCarrera || 0);
  if (referencia > 0 && propuestoVol.minutos > referencia * (1 + cfg.maxWeeklyIncreasePct / 100)) {
    registrar(hard, "WEEKLY_PROGRESSION_LIMIT", `El volumen de carrera supera el incremento máximo del ${cfg.maxWeeklyIncreasePct}%.`, "$.sessions");
  }

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
