/* Consultas RAG dinámicas y deterministas. No se gasta una llamada de modelo
   para decidir qué buscar: las señales salen de hechos calculados. */

const texto = (valor) => String(valor ?? "").trim();
const numero = (valor) => Number.isFinite(Number(valor)) ? Number(valor) : null;

const sesionesObjetivo = (contexto = {}) => contexto.week?.sessions
  || contexto.week?.sesiones
  || contexto.masterWeek?.sessions
  || contexto.masterWeek?.sesiones
  || contexto.plannedSessions
  || contexto.sesionesPlanificadas
  || [];

const campo = (objeto, ...claves) => {
  for (const clave of claves) if (objeto?.[clave] !== undefined && objeto?.[clave] !== null) return objeto[clave];
  return null;
};

const esFuerza = (s) => /strength|fuerza|gym/i.test(`${campo(s, "modality", "tipo", "type") || ""} ${campo(s, "session_type", "codigo_sesion", "code") || ""}`);
const esCalidad = (s) => /interval|quality|calidad|tempo|run b/i.test(`${campo(s, "session_type", "codigo_sesion", "code", "titulo") || ""}`);
const esTirada = (s) => /long|tirada|run a/i.test(`${campo(s, "session_type", "codigo_sesion", "code", "titulo") || ""}`);

function diasHasta(fecha, hoy) {
  if (!fecha || !hoy) return null;
  const ms = Date.parse(`${fecha}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

export function detectarSenalesPlanificacion(contexto = {}, analitica = {}, config = {}) {
  const sesiones = sesionesObjetivo(contexto);
  const recuperacion = contexto.recoveryLogs || contexto.recovery || contexto.recuperacion || [];
  const ultimaRecuperacion = [...recuperacion].sort((a, b) => String(b.fecha || b.date || "").localeCompare(String(a.fecha || a.date || "")))[0] || {};
  const fatiga = Math.max(analitica.ventana7d?.fatigaMedia ?? 0, numero(ultimaRecuperacion.fatiga ?? ultimaRecuperacion.fatigue) ?? 0);
  const sueno = analitica.ventana7d?.suenoMedioHoras ?? numero(ultimaRecuperacion.horas_sueno ?? ultimaRecuperacion.sleepHours);
  const dolor = analitica.seguridad?.dolorMaximo ?? 0;
  const carrera = campo(contexto.profile || contexto.perfil || contexto.plan, "fecha_carrera", "fechaCarrera", "raceDate");
  const hoy = analitica.calculadaEn || texto(config.hoy);
  const faltan = diasHasta(carrera, hoy);
  const fase = texto(campo(contexto.masterWeek, "fase", "phase"));
  const tiradaObjetivo = sesiones.filter(esTirada).map((s) => numero(campo(s, "duration_min", "duracion_min", "durationMin")) || 0)[0] || 0;
  const ultimaTirada = analitica.ultimasEquivalentes?.["running:long_run"]?.[0]?.duracionMin || 0;
  const incrementoTiradaPct = ultimaTirada > 0 ? ((tiradaObjetivo - ultimaTirada) / ultimaTirada) * 100 : null;

  return {
    fatigaAlta: fatiga >= (config.umbralFatigaAlta ?? 7),
    suenoBajo: sueno !== null && sueno < (config.umbralSuenoBajo ?? 6.5),
    dolorActivo: dolor >= (config.umbralDolorActivo ?? 3),
    dolorAlto: dolor >= (config.umbralDolorAlto ?? 5),
    dolorEnReposo: !!analitica.seguridad?.dolorEnReposo,
    redFlags: analitica.seguridad?.redFlags || [],
    concurrente: sesiones.some(esFuerza) && sesiones.some((s) => esCalidad(s) || esTirada(s)),
    progresionTirada: incrementoTiradaPct !== null && incrementoTiradaPct > (config.umbralProgresionPct ?? 5),
    incrementoTiradaPct,
    adherenciaBaja: analitica.adherencia?.ratio !== null && analitica.adherencia?.ratio < (config.umbralAdherencia ?? 0.75),
    sesionesPerdidas: analitica.adherencia?.perdidas?.length || 0,
    taper: /taper|carrera|competition/i.test(fase) || (faltan !== null && faltan >= 0 && faltan <= (config.ventanaTaperDias ?? 21)),
    diasHastaCarrera: faltan,
    fase,
  };
}

const objetivoTexto = (contexto) => texto(campo(contexto.profile || contexto.perfil || contexto.plan, "distancia_objetivo", "distanciaObjetivo", "goalDistance")) || "objetivo de resistencia";
const prioridadTexto = (contexto) => {
  const prioridades = campo(contexto.profile || contexto.perfil, "prioridades", "priorities");
  return Array.isArray(prioridades) ? texto(prioridades[0]) : texto(prioridades);
};

const codigoSeguro = (valor) => texto(valor)
  .normalize("NFKD")
  .replace(/[^a-zA-Z0-9 _-]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 40);

function consultaCambioCoach(contexto) {
  const cambio = contexto.coachRequest?.cambio;
  if (!cambio) return null;
  const accion = {
    mover: "redistribuir una sesión manteniendo recuperación y compatibilidad",
    sustituir: "sustituir una modalidad o sesión por una alternativa de carga equivalente",
    reducir_volumen: "reducir volumen de forma conservadora",
    reducir_intensidad: "reducir intensidad de forma conservadora",
    eliminar: "eliminar una sesión sin compensar carga",
    descansar: "introducir descanso sin recuperar después la carga perdida",
  }[cambio.tipo];
  if (!accion) return null;
  const origen = codigoSeguro(cambio.de);
  const destino = codigoSeguro(cambio.a);
  return [
    accion,
    origen ? `sesión origen ${origen}` : "",
    destino ? `alternativa ${destino}` : "",
    "adaptación semanal basada en evidencia, training modification load management",
  ].filter(Boolean).join("; ");
}

/** Devuelve entre 1 y 5 consultas, ordenadas por criticidad. */
export function construirConsultasRAG(contexto = {}, analitica = {}, config = {}) {
  const s = detectarSenalesPlanificacion(contexto, analitica, config);
  const objetivo = objetivoTexto(contexto);
  const prioridad = prioridadTexto(contexto);
  const candidatas = [];
  const agregar = (key, query, { required = true, priority = 0, filters = {} } = {}) => candidatas.push({ key, query, required, priority, filters });

  const coachChange = consultaCambioCoach(contexto);
  if (coachChange) agregar("coach_requested_change", coachChange, { priority: 95 });

  if (s.dolorActivo || s.dolorEnReposo || s.redFlags.length) {
    const zonas = (contexto.injuries || contexto.lesiones || []).map((x) => x.zona).filter(Boolean).join(", ");
    agregar("pain_safety", `Modificación conservadora de carga e impacto ante dolor ${zonas || "musculoesquelético"}; criterios de descanso y derivación, injury load management runners`, { priority: 100 });
  }
  if (s.fatigaAlta || s.suenoBajo) {
    agregar("recovery_load", `Fatiga elevada, sueño insuficiente y adaptación semanal del volumen e intensidad en ${objetivo}; recovery fatigue training load`, { priority: 90 });
  }
  if (s.taper) {
    agregar("taper", `Taper previo a ${objetivo}: reducción de volumen, mantenimiento de intensidad y distribución de sesiones; endurance taper`, { priority: 80 });
  }
  if (s.concurrente) {
    agregar("concurrent_interference", `Distribución semanal de fuerza pesada, carrera de calidad y tirada larga; separación y orden para entrenamiento concurrente en ${objetivo}; concurrent training interference`, { priority: 70 });
  }
  if (s.progresionTirada) {
    agregar("volume_progression", `Progresión conservadora de tirada larga y volumen semanal para ${objetivo}; running volume progression injury`, { priority: 60 });
  }
  if (s.adherenciaBaja || s.sesionesPerdidas) {
    agregar("missed_sessions", `Adaptación tras sesiones perdidas sin acumular ni compensar carga; adherence missed training session recovery`, { priority: 55 });
  }

  agregar("weekly_distribution", `Frecuencia, volumen, intensidad, recuperación y distribución semanal para ${objetivo}${prioridad ? ` con prioridad ${prioridad}` : ""}; weekly training distribution`, { priority: 40 });

  const max = Math.max(1, Math.min(5, config.maxConsultas ?? 5));
  const elegidas = candidatas.sort((a, b) => b.priority - a.priority).slice(0, max);
  if (!elegidas.some((q) => q.key === "weekly_distribution")) {
    elegidas[elegidas.length - 1] = candidatas.find((q) => q.key === "weekly_distribution");
  }
  return elegidas.filter(Boolean);
}

export const detectPlanningSignals = detectarSenalesPlanificacion;
export const buildPlanningQueries = construirConsultasRAG;
