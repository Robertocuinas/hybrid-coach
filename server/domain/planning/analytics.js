/* Analítica previa del planificador. Todo se calcula antes de llamar al modelo:
   el LLM recibe hechos ya agregados y nunca tiene que sumar filas clínicas. */

const MS_DIA = 86_400_000;

const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

const iso = (valor) => {
  if (!valor) return null;
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString().slice(0, 10);
};

const sumarDias = (fecha, dias) => {
  const base = new Date(`${fecha}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
};

const diasEntre = (desde, hasta) => {
  const a = iso(desde), b = iso(hasta);
  if (!a || !b) return Infinity;
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / MS_DIA);
};

const primero = (objeto, ...claves) => {
  for (const clave of claves) if (objeto?.[clave] !== undefined && objeto?.[clave] !== null) return objeto[clave];
  return null;
};

export function normalizarSesion(sesion = {}) {
  const tipoOriginal = String(primero(sesion, "tipo", "type", "modality") || "").toLowerCase();
  const codigo = String(primero(sesion, "codigo_sesion", "codigoSesion", "running_code", "strength_code", "code", "session_type", "sessionType") || "").trim();
  const modalidad = /strength|fuerza|gym/.test(tipoOriginal) || /^GYM/i.test(codigo)
    ? "strength"
    : /recovery|recuper/.test(tipoOriginal) || /^RECOVERY/i.test(codigo)
      ? "recovery"
      : /run|running|carrera/.test(tipoOriginal) || /^RUN/i.test(codigo)
        ? "running"
        : tipoOriginal || "unknown";
  const subtipo = String(primero(sesion, "session_type", "sessionType", "subtipo") || codigo || modalidad).toLowerCase();
  const fecha = iso(primero(sesion, "fecha", "date"));
  return {
    ...sesion,
    id: primero(sesion, "id", "completed_session_id", "completedSessionId"),
    plannedSessionId: primero(sesion, "planned_session_id", "plannedSessionId", "weekly_plan_session_id", "weeklyPlanSessionId"),
    sessionKey: primero(sesion, "session_key", "sessionKey"),
    fecha,
    modalidad,
    codigo,
    subtipo,
    distanciaKm: numero(primero(sesion, "distancia_km", "distanciaKm", "distance_km", "distanceKm")) || 0,
    duracionMin: numero(primero(sesion, "duracion_min", "duracionMin", "duration_min", "durationMin")) || 0,
    rpe: numero(sesion.rpe),
    dolor: numero(primero(sesion, "dolor", "pain")),
    completada: primero(sesion, "completada", "completed") !== false,
  };
}

const enVentana = (fecha, hoy, dias) => {
  const antiguedad = diasEntre(fecha, hoy);
  return antiguedad >= 0 && antiguedad < dias;
};

function resumirVentana(sesiones, recuperacion, checkins, hoy, dias) {
  const dentro = sesiones.filter((s) => s.fecha && enVentana(s.fecha, hoy, dias));
  const rec = recuperacion.filter((r) => iso(r.fecha || r.date) && enVentana(r.fecha || r.date, hoy, dias));
  const feedback = checkins.filter((r) => iso(r.fecha || r.date) && enVentana(r.fecha || r.date, hoy, dias));
  const carreras = dentro.filter((s) => s.modalidad === "running");
  const fuerza = dentro.filter((s) => s.modalidad === "strength");
  const conRpe = dentro.filter((s) => s.rpe !== null);
  const cargas = dentro.filter((s) => s.rpe !== null && s.duracionMin > 0).map((s) => s.rpe * s.duracionMin);
  const dolores = [
    ...dentro.map((s) => s.dolor),
    ...rec.map((r) => numero(r.dolor ?? r.pain)),
    ...feedback.map((r) => numero(r.dolor ?? r.pain)),
  ].filter((n) => n !== null);
  const fatigas = rec.map((r) => numero(r.fatiga ?? r.fatigue)).filter((n) => n !== null);
  const suenos = rec.map((r) => numero(r.horas_sueno ?? r.horasSueno ?? r.sleepHours)).filter((n) => n !== null);
  const media = (lista) => lista.length ? lista.reduce((a, b) => a + b, 0) / lista.length : null;
  return {
    dias,
    sesiones: dentro.length,
    carreras: carreras.length,
    fuerza: fuerza.length,
    km: redondear(carreras.reduce((t, s) => t + s.distanciaKm, 0), 2),
    minutos: dentro.reduce((t, s) => t + s.duracionMin, 0),
    minutosCarrera: carreras.reduce((t, s) => t + s.duracionMin, 0),
    cargaSesionRpe: redondear(cargas.reduce((a, b) => a + b, 0), 1),
    rpeMedio: redondear(media(conRpe.map((s) => s.rpe)), 2),
    dolorMaximo: dolores.length ? Math.max(...dolores) : null,
    fatigaMedia: redondear(media(fatigas), 2),
    suenoMedioHoras: redondear(media(suenos), 2),
    fechasEntrenadas: [...new Set(dentro.map((s) => s.fecha))].sort(),
  };
}

const redondear = (valor, decimales) => valor === null || valor === undefined
  ? null
  : Number(Number(valor).toFixed(decimales));

function calcularRachas(sesiones, hoy) {
  const fechas = [...new Set(sesiones.filter((s) => s.fecha && enVentana(s.fecha, hoy, 28)).map((s) => s.fecha))].sort();
  let maxima = 0, actual = 0, previa = null;
  for (const fecha of fechas) {
    actual = previa && diasEntre(previa, fecha) === 1 ? actual + 1 : 1;
    maxima = Math.max(maxima, actual);
    previa = fecha;
  }
  const conjunto = new Set(fechas);
  let vigente = 0;
  for (let cursor = hoy; conjunto.has(cursor); cursor = sumarDias(cursor, -1)) vigente++;
  if (!conjunto.has(hoy) && conjunto.has(sumarDias(hoy, -1))) {
    for (let cursor = sumarDias(hoy, -1); conjunto.has(cursor); cursor = sumarDias(cursor, -1)) vigente++;
  }
  return { maxima28d: maxima, vigente };
}

function tipoEquivalente(sesion) {
  const texto = `${sesion.subtipo} ${sesion.codigo}`.toLowerCase();
  if (sesion.modalidad === "strength") return `strength:${sesion.codigo || "general"}`;
  if (/long|tirada|run a/.test(texto)) return "running:long_run";
  if (/interval|quality|calidad|tempo|run b/.test(texto)) return "running:quality";
  if (/easy|facil|fácil|regener|run c|run d/.test(texto)) return "running:easy";
  return `${sesion.modalidad}:${sesion.subtipo || "general"}`;
}

function ultimasEquivalentes(sesiones, limite = 3) {
  const grupos = {};
  for (const sesion of [...sesiones].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))) {
    const clave = tipoEquivalente(sesion);
    if (!grupos[clave]) grupos[clave] = [];
    if (grupos[clave].length < limite) grupos[clave].push(sesion);
  }
  return grupos;
}

function sesionPlanificadaNormalizada(sesion = {}, weekStart = null) {
  const dia = primero(sesion, "day_of_week", "dia_semana", "diaSemana", "day");
  const fechaDerivada = !primero(sesion, "fecha", "date") && weekStart && Number.isInteger(Number(dia))
    ? sumarDias(weekStart, Number(dia))
    : null;
  return {
    ...normalizarSesion({ ...sesion, fecha: primero(sesion, "fecha", "date") || fechaDerivada, completada: false }),
    id: primero(sesion, "id", "planned_session_id", "plannedSessionId"),
  };
}

function coincide(planificada, completada) {
  if (completada.plannedSessionId && planificada.id) return String(completada.plannedSessionId) === String(planificada.id);
  if (planificada.sessionKey && completada.sessionKey) return planificada.sessionKey === completada.sessionKey;
  return planificada.fecha === completada.fecha && !!planificada.codigo && planificada.codigo === completada.codigo;
}

function calcularAdherencia(planificadas, completadas, hoy) {
  const vencidas = planificadas.filter((s) => s.fecha && s.fecha <= hoy);
  const realizadas = vencidas.filter((p) => completadas.some((c) => coincide(p, c)));
  const perdidas = vencidas.filter((p) => !completadas.some((c) => coincide(p, c)));
  return {
    planificadasVencidas: vencidas.length,
    completadas: realizadas.length,
    ratio: vencidas.length ? redondear(realizadas.length / vencidas.length, 3) : null,
    perdidas,
  };
}

function contextoTemporal(planificadas, completadas, hoy) {
  const dias = { ayer: sumarDias(hoy, -1), hoy, manana: sumarDias(hoy, 1) };
  return Object.fromEntries(Object.entries(dias).map(([clave, fecha]) => [clave, {
    fecha,
    planificadas: planificadas.filter((s) => s.fecha === fecha),
    completadas: completadas.filter((s) => s.fecha === fecha),
  }]));
}

function progresoFuerza(series = [], hoy) {
  const normalizadas = series.map((s) => ({
    fecha: iso(s.fecha || s.date),
    ejercicio: String(s.exercise || s.ejercicio || s.nombre || s.exercise_name || "").trim(),
    pesoKg: numero(s.peso_kg ?? s.pesoKg ?? s.weightKg) || 0,
    reps: numero(s.reps) || 0,
    rir: numero(s.rir),
  })).filter((s) => s.fecha && s.ejercicio);
  const ordenadas = [...normalizadas].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const latestByExercise = {};
  for (const serie of ordenadas) if (!latestByExercise[serie.ejercicio]) latestByExercise[serie.ejercicio] = serie;
  const volumen = (dias) => normalizadas.filter((s) => enVentana(s.fecha, hoy, dias))
    .reduce((total, s) => total + s.pesoKg * s.reps, 0);
  return {
    volumenKg7d: redondear(volumen(7), 1),
    volumenKg28d: redondear(volumen(28), 1),
    ultimasPorEjercicio: latestByExercise,
  };
}

/**
 * Contrato de entrada tolerante a snake_case/camelCase:
 * { sessions|completedSessions, plannedSessions, recovery|recoveryLogs, checkins|feedbackLogs }.
 */
export function calcularAnaliticaEntrenamiento(contexto = {}, { hoy = new Date() } = {}) {
  const hoyISO = iso(hoy);
  if (!hoyISO) throw new TypeError("hoy debe ser una fecha válida");
  const completadas = (contexto.completedSessions || contexto.sessions || contexto.sesiones || []).map(normalizarSesion)
    .filter((s) => s.fecha && s.completada);
  const semana = contexto.week || contexto.masterWeek || {};
  const inicioSemana = iso(semana.start_date || semana.startDate || semana.inicio);
  const planificadas = (contexto.plannedSessions || contexto.sesionesPlanificadas || semana.sessions || semana.sesiones || [])
    .map((s) => sesionPlanificadaNormalizada(s, inicioSemana)).filter((s) => s.fecha);
  const recuperacion = contexto.recoveryLogs || contexto.recovery || contexto.recuperacion || [];
  const checkins = contexto.feedbackLogs || contexto.checkins || [];
  const strengthSets = contexto.strengthSets || contexto.seriesFuerza || [];
  const ventana7d = resumirVentana(completadas, recuperacion, checkins, hoyISO, 7);
  const ventana28d = resumirVentana(completadas, recuperacion, checkins, hoyISO, 28);

  const hace14 = completadas.filter((s) => s.fecha && enVentana(s.fecha, sumarDias(hoyISO, -7), 7));
  const comparativa7d = resumirVentana(hace14, [], [], sumarDias(hoyISO, -7), 7);
  const adherencia = calcularAdherencia(planificadas, completadas, hoyISO);
  const dolorEnReposo = [...recuperacion, ...checkins].some((r) => {
    const flag = r.dolor_reposo ?? r.dolorEnReposo ?? r.painAtRest;
    const descripcion = [r.cuando_aparece, r.cuando, r.tipo_dolor, r.tipo].filter(Boolean).join(" ");
    return flag === true || /reposo/i.test(descripcion);
  });
  const redFlags = [...(contexto.redFlags || contexto.banderas || []), ...checkins.flatMap((r) => r.red_flags || r.redFlags || [])]
    .map(String).filter(Boolean);

  return {
    calculadaEn: hoyISO,
    ventana7d,
    ventana28d,
    comparativaAnterior7d: comparativa7d,
    cambioKm7dPct: comparativa7d.km > 0 ? redondear(((ventana7d.km - comparativa7d.km) / comparativa7d.km) * 100, 1) : null,
    cambioMinutos7dPct: comparativa7d.minutos > 0 ? redondear(((ventana7d.minutos - comparativa7d.minutos) / comparativa7d.minutos) * 100, 1) : null,
    adherencia,
    rachas: calcularRachas(completadas, hoyISO),
    ultimasEquivalentes: ultimasEquivalentes(completadas),
    progresoFuerza: progresoFuerza(strengthSets, hoyISO),
    temporal: contextoTemporal(planificadas, completadas, hoyISO),
    seguridad: {
      dolorMaximo: Math.max(ventana7d.dolorMaximo ?? 0, ventana28d.dolorMaximo ?? 0),
      dolorEnReposo,
      redFlags,
    },
  };
}

export const computeTrainingAnalytics = calcularAnaliticaEntrenamiento;
