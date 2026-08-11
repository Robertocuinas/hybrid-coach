/* Paso 03 — el corazón de la migración: convierte los volcados parseados de
   localStorage en la forma relacional de docs/03-modelo-datos.md.

   Alcance deliberado (ver migration/README.md "Qué NO migra este paso" para
   el razonamiento completo): se migra todo lo que es HECHO histórico
   (sesiones registradas, recuperación, check-ins, cambios, chat, catálogo de
   comidas, bibliografía). NO se migra la estructura detallada semana a
   semana del plan (training_weeks / planned_sessions / rutinas) ni las
   propuestas de la IA (plan_decisions): esos viven en el motor determinista
   (buildPlan/generateWeek en src/HybridCoach.jsx) y se regeneran gratis
   desde el perfil ya migrado — no hay motivo para reimplementar el motor en
   un script de migración ni riesgo de que diverja de él. Sí se migra un
   resumen plano de training_plans (para que "cada perfil tiene un plan
   activo" siga siendo cierto) porque esos campos son historia real, no
   estructura derivada.
*/
import path from "node:path";
import {
  PARSED_LOCAL_DIR, TRANSFORMED_FILE, listFiles, readJson, writeJson, logStep,
  normalizeValue, toNumber, normalizeExerciseName, titleCase, normalizeEvidenceGrade,
  normalizeProfileName, isoDate, inRange, idDeterminista,
} from "./lib/util.js";

/* "5:23" (min:seg / km) → 5.383 (decimal). El motor guarda el ritmo ya
   formateado como texto; la columna running_sessions.ritmo es numeric. */
function paceToDecimal(pace) {
  const v = normalizeValue(pace);
  if (v === null) return null;
  const m = String(v).match(/^(\d+):(\d{1,2})$/);
  if (!m) return toNumber(v);
  return Math.round((Number(m[1]) + Number(m[2]) / 60) * 1000) / 1000;
}

const CAMPOS_PERFIL = {
  nombre: "nombre", edad: "edad", sexo: "sexo", altura: "altura_cm", peso: "peso_kg",
  grasa: "grasa_pct", distancia: "distancia_objetivo", fechaCarrera: "fecha_carrera",
  metaTipo: "meta_tipo", metaTiempo: "meta_tiempo", prioridad: "prioridades",
  expCarrera: "exp_carrera", kmSemana: "km_semana", sesionesCarrera: "sesiones_carrera",
  tiradaLarga: "tirada_larga_min", ritmoComodo: "ritmo_comodo", paron: "paron",
  superficie: "superficie", expFuerza: "exp_fuerza", equipamiento: "equipamiento",
  cargas: "cargas", tecnica: "tecnica", estructural: "estructural", cirugias: "cirugias",
  banderas: "banderas", momento: "momento_entreno", crossTraining: "cross_training",
  sueno: "horas_sueno", calidadSueno: "calidad_sueno", estres: "estres", trabajo: "trabajo",
  nutricion: "nutricion_objetivo", suplementos: "suplementos", reloj: "reloj",
};

class Contador {
  constructor() { this.valores = {}; }
  add(clave, n = 1) { this.valores[clave] = (this.valores[clave] || 0) + n; }
  get() { return this.valores; }
}

export async function run() {
  logStep("03 · transform");
  const files = await listFiles(PARSED_LOCAL_DIR, ".json");
  if (!files.length) {
    console.log("No hay volcados parseados. Ejecuta antes el paso 01.");
    const vacio = tablaVacia();
    await writeJson(TRANSFORMED_FILE, vacio);
    return { profiles: 0 };
  }

  const duplicados = new Contador();
  const rechazados = [];
  const legacyMap = []; // { source, table, legacy_id, new_id }

  /* El id sale de la clave natural, no de un aleatorio: ver idDeterminista().
     `legacyId` solo se usa para la traza en legacy_id_map, nunca para el id. */
  const nuevoId = (source, table, legacyId, ...clave) => {
    const id = idDeterminista(table, ...clave);
    if (legacyId !== undefined && legacyId !== null) legacyMap.push({ source, table, legacy_id: String(legacyId), new_id: id });
    return id;
  };

  // --- 1. Cargar todos los volcados y agrupar perfiles por nombre normalizado ---
  const dumps = [];
  for (const file of files) dumps.push({ file, data: await readJson(path.join(PARSED_LOCAL_DIR, file)) });

  const grupos = new Map(); // nombreNormalizado -> [{file, legacyId, profileData}]
  for (const { file, data } of dumps) {
    for (const [legacyId, profileData] of Object.entries(data.perfiles || {})) {
      const clave = normalizeProfileName(profileData?.perfil?.nombre || profileData?.nombre) || `sin-nombre:${file}:${legacyId}`;
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push({ file, legacyId, profileData });
    }
  }

  const out = tablaVacia();

  // --- 2. Bibliografía: global, deduplicada por (título normalizado, año) ---
  const vistosDoc = new Set();
  for (const { file, data } of dumps) {
    for (const ref of data.biblio || []) {
      const clave = `${(ref.titulo || "").trim().toLowerCase()}|${ref.anio || ""}`;
      if (vistosDoc.has(clave)) { duplicados.add("documents"); continue; }
      vistosDoc.add(clave);
      const id = nuevoId(file, "documents", ref.id, clave);
      out.documents.push({
        id, titulo: normalizeValue(ref.titulo), autores: normalizeValue(ref.autores),
        anio: toNumber(ref.anio), fuente_revista: normalizeValue(ref.fuente),
        doi: normalizeValue(ref.doi), study_type: null,
        evidence_grade: normalizeEvidenceGrade(ref.grado), poblacion: null, population_type: null,
        sample_size: null, tema_principal: normalizeValue(ref.tema), tags: null,
        resumen: null, limites: normalizeValue(ref.limites), aplicacion_practica: normalizeValue(ref.aplicacion),
        storage_key: null, origen: "semilla", revisado: true,
      });
    }
  }

  // --- 3. Un perfil lógico por grupo (mismo nombre normalizado en distintos dispositivos) ---
  for (const [clave, entradas] of grupos) {
    const profileId = idDeterminista("athlete_profiles", clave);
    for (const e of entradas) legacyMap.push({ source: e.file, table: "athlete_profiles", legacy_id: String(e.legacyId), new_id: profileId });

    // La entrada "principal" (para el perfil escalar) es la de fecha de creación más antigua.
    const principal = [...entradas].sort((a, b) => (a.profileData.creado || "") < (b.profileData.creado || "") ? -1 : 1)[0];
    const perfilOrigen = principal.profileData.perfil || {};

    const fila = { id: profileId };
    for (const [origenKey, destCol] of Object.entries(CAMPOS_PERFIL)) {
      if (perfilOrigen[origenKey] !== undefined) fila[destCol] = normalizeValue(perfilOrigen[origenKey]);
    }
    fila.nombre = fila.nombre || principal.profileData.nombre || null;
    out.athlete_profiles.push(fila);

    // Disponibilidad: estado actual, no histórico — se toma de la entrada principal.
    if (perfilOrigen.dias || perfilOrigen.minGym || perfilOrigen.minRun || perfilOrigen.finde) {
      out.availability.push({
        id: idDeterminista("availability", profileId), athlete_profile_id: profileId,
        vigente_desde: isoDate(principal.profileData.creado) || isoDate(new Date().toISOString()),
        dias: perfilOrigen.dias || null,
        min_gym: toNumber(perfilOrigen.minGym), min_run: toNumber(perfilOrigen.minRun), min_finde: toNumber(perfilOrigen.finde),
      });
    }

    // Lesiones (docs/03 §2: extraídas a tabla propia).
    const vistasLesion = new Set();
    for (const e of entradas) for (const l of e.profileData?.perfil?.lesiones || []) {
      const k = `${(l.zona || "").toLowerCase()}|${(l.cuando || "").toLowerCase()}`;
      if (vistasLesion.has(k)) { duplicados.add("injuries"); continue; }
      vistasLesion.add(k);
      out.injuries.push({
        id: nuevoId(e.file, "injuries", l.id, profileId, k), athlete_profile_id: profileId,
        zona: normalizeValue(l.zona), recurrente: !!l.recurrente, contexto: normalizeValue(l.cuando), activa: true,
      });
    }

    // Ejercicios propios del perfil (catálogo, no historial de uso).
    const registroEjercicios = new Map(); // nombreNormalizado -> id
    for (const e of entradas) for (const [legacyEjId, ej] of Object.entries(e.profileData?.ejercicios || {})) {
      const nombre = titleCase(ej.full || ej.basico || ej.casa);
      const norm = normalizeExerciseName(nombre);
      if (!norm || registroEjercicios.has(norm)) { if (norm) duplicados.add("strength_exercises"); continue; }
      const id = nuevoId(e.file, "strength_exercises", legacyEjId, profileId, norm);
      registroEjercicios.set(norm, id);
      out.strength_exercises.push({
        id, nombre, grupo_muscular: normalizeValue(ej.g), patron: null,
        incremento_kg_default: toNumber(ej.inc), athlete_profile_id: profileId,
      });
    }
    const resolverEjercicio = (nombreCrudo, file) => {
      const norm = normalizeExerciseName(nombreCrudo);
      if (!norm) return null;
      if (registroEjercicios.has(norm)) return registroEjercicios.get(norm);
      const id = nuevoId(file, "strength_exercises", null, profileId, norm);
      registroEjercicios.set(norm, id);
      out.strength_exercises.push({
        id, nombre: titleCase(nombreCrudo), grupo_muscular: null, patron: null,
        incremento_kg_default: null, athlete_profile_id: profileId,
      });
      return id;
    };

    // Carreras: cada fila del array `running` es una completed_session + running_sessions 1:1.
    const vistasRun = new Set();
    for (const e of entradas) for (const r of e.profileData?.running || []) {
      const fecha = isoDate(r.date || r.fecha);
      const clave2 = `${fecha}|${r.session_code}|${toNumber(r.duracion_min)}`;
      if (!fecha) { rechazados.push({ tipo: "running", motivo: "sin fecha", fila: r }); continue; }
      if (vistasRun.has(clave2)) { duplicados.add("running_sessions"); continue; }
      if (!inRange(r.rpe, 1, 10) || !inRange(r.dolor, 0, 10)) { rechazados.push({ tipo: "running", motivo: "rpe/dolor fuera de rango", fila: r }); continue; }
      vistasRun.add(clave2);
      const completedId = nuevoId(e.file, "completed_sessions", null, profileId, "run", clave2);
      out.completed_sessions.push({ id: completedId, athlete_profile_id: profileId, planned_session_id: null, fecha, tipo: "run", semana: toNumber(r.semana) });
      out.running_sessions.push({
        id: nuevoId(e.file, "running_sessions", r.id, completedId), completed_session_id: completedId,
        codigo_sesion: normalizeValue(r.session_code), distancia_km: toNumber(r.distancia_km),
        duracion_min: toNumber(r.duracion_min), ritmo: paceToDecimal(r.ritmo),
        fc_media: toNumber(r.fc_media), fc_max: toNumber(r.fc_max), desnivel: toNumber(r.desnivel),
        cadencia: toNumber(r.cadencia), rpe: toNumber(r.rpe), dolor: toNumber(r.dolor),
        notas: normalizeValue(r.notas), origen: r.source === "strava" ? "strava" : "manual",
        external_id: normalizeValue(r.external_id),
      });
    }

    // Fuerza: el array `strength` guarda SERIES sueltas; se agrupan en sesiones por (fecha, codigo_sesion).
    const gruposFuerza = new Map();
    for (const e of entradas) for (const s of e.profileData?.strength || []) {
      const fecha = isoDate(s.date || s.fecha);
      if (!fecha) { rechazados.push({ tipo: "strength", motivo: "sin fecha", fila: s }); continue; }
      const k = `${fecha}|${s.session}`;
      if (!gruposFuerza.has(k)) gruposFuerza.set(k, { fecha, codigo_sesion: s.session, semana: s.semana, file: e.file, sets: [], vistos: new Set() });
      const grupo = gruposFuerza.get(k);
      const setKey = `${normalizeExerciseName(s.exercise)}|${s.set}`;
      if (grupo.vistos.has(setKey)) { duplicados.add("strength_sets"); continue; }
      grupo.vistos.add(setKey);
      grupo.sets.push(s);
    }
    for (const grupo of gruposFuerza.values()) {
      const completedId = nuevoId(grupo.file, "completed_sessions", null, profileId, "gym", grupo.fecha, grupo.codigo_sesion);
      out.completed_sessions.push({ id: completedId, athlete_profile_id: profileId, planned_session_id: null, fecha: grupo.fecha, tipo: "gym", semana: toNumber(grupo.semana) });
      const strengthSessionId = nuevoId(grupo.file, "strength_sessions", null, completedId);
      out.strength_sessions.push({ id: strengthSessionId, completed_session_id: completedId, codigo_sesion: normalizeValue(grupo.codigo_sesion) });
      for (const s of grupo.sets) {
        const exId = resolverEjercicio(s.exercise, grupo.file);
        if (!exId) { rechazados.push({ tipo: "strength_set", motivo: "sin nombre de ejercicio", fila: s }); continue; }
        out.strength_sets.push({
          id: nuevoId(grupo.file, "strength_sets", s.id, strengthSessionId, exId, s.set), strength_session_id: strengthSessionId,
          strength_exercise_id: exId, orden: toNumber(s.set), peso_kg: toNumber(s.weight),
          reps: toNumber(s.reps), rir: toNumber(s.rir), notas: normalizeValue(s.notes),
        });
      }
    }

    // Recuperación: un registro por día (índice único en destino) — última grafía vista gana.
    const recPorFecha = new Map();
    for (const e of entradas) for (const r of e.profileData?.recovery || []) {
      const fecha = isoDate(r.date || r.fecha);
      if (!fecha) { rechazados.push({ tipo: "recovery", motivo: "sin fecha", fila: r }); continue; }
      if (recPorFecha.has(fecha)) duplicados.add("recovery_logs");
      recPorFecha.set(fecha, { e, r });
    }
    for (const [fecha, { e, r }] of recPorFecha) {
      out.recovery_logs.push({
        id: nuevoId(e.file, "recovery_logs", null, profileId, fecha), athlete_profile_id: profileId, fecha,
        horas_sueno: toNumber(r.sueno), calidad_sueno: toNumber(r.calidad), fatiga: toNumber(r.fatiga),
        agujetas: toNumber(r.agujetas), estres: toNumber(r.estres), motivacion: toNumber(r.motivacion),
        dolor: toNumber(r.dolor),
      });
    }

    // Check-ins post-sesión.
    const vistoCheckin = new Set();
    for (const e of entradas) for (const c of e.profileData?.checkins || []) {
      const fecha = isoDate(c.date || c.fecha);
      if (!fecha) { rechazados.push({ tipo: "checkin", motivo: "sin fecha", fila: c }); continue; }
      const k = `${fecha}|${c.rpe}|${c.dolor}|${(c.comentario || "").slice(0, 40)}`;
      if (vistoCheckin.has(k)) { duplicados.add("feedback_logs"); continue; }
      if (!inRange(c.rpe, 1, 10) || !inRange(c.dolor, 0, 10)) { rechazados.push({ tipo: "checkin", motivo: "rpe/dolor fuera de rango", fila: c }); continue; }
      vistoCheckin.add(k);
      out.feedback_logs.push({
        id: nuevoId(e.file, "feedback_logs", null, profileId, k), athlete_profile_id: profileId, fecha,
        semana: toNumber(c.semana), rpe: toNumber(c.rpe), sensacion: normalizeValue(c.feelTxt),
        dolor: toNumber(c.dolor), zona_dolor: normalizeValue(c.loc), tipo_dolor: normalizeValue(c.tipo),
        cuando_aparece: normalizeValue(c.cuando), energia: toNumber(c.energia), comentario: normalizeValue(c.comentario),
      });
    }

    // Cambios de plan.
    for (const e of entradas) for (const ch of e.profileData?.changes || []) {
      const motivo = [normalizeValue(ch.motivo), normalizeValue(ch.datos)].filter(Boolean).join(" — ") || null;
      out.plan_modifications.push({
        id: nuevoId(e.file, "plan_modifications", null, profileId, ch.fecha, ch.semana, ch.cambio), athlete_profile_id: profileId,
        fecha: isoDate(ch.fecha), semana: toNumber(ch.semana),
        plan_original: normalizeValue(ch.plan_original), cambio: normalizeValue(ch.cambio),
        motivo, origen: "usuario",
      });
    }

    // Catálogo de comidas.
    const vistaComida = new Set();
    for (const e of entradas) for (const [categoria, opciones] of Object.entries(e.profileData?.comidas || {})) {
      for (const opcion of opciones || []) {
        const k = `${categoria}|${opcion}`;
        if (vistaComida.has(k)) { duplicados.add("meal_catalog"); continue; }
        vistaComida.add(k);
        out.meal_catalog.push({ id: nuevoId(e.file, "meal_catalog", null, profileId, k), athlete_profile_id: profileId, categoria, opcion });
      }
    }

    // Chat: se conserva como una única conversación por perfil (el origen no
    // trocea el historial en varias). Sin timestamp por mensaje en origen: se
    // fabrican marcas ordenadas a partir de la fecha de creación del perfil,
    // solo para respetar el orden — no representan la hora real del mensaje.
    const chatOrigen = principal.profileData?.chat || [];
    if (chatOrigen.length) {
      const conversationId = nuevoId(principal.file, "conversations", null, profileId);
      const base = new Date((isoDate(principal.profileData.creado) || new Date().toISOString().slice(0, 10)) + "T12:00:00Z").getTime();
      out.conversations.push({
        id: conversationId, athlete_profile_id: profileId, titulo: "Historial migrado",
        iniciada_en: new Date(base).toISOString(), ultimo_mensaje_en: new Date(base + (chatOrigen.length - 1) * 1000).toISOString(),
      });
      chatOrigen.forEach((m, i) => {
        out.messages.push({
          id: nuevoId(principal.file, "messages", null, conversationId, i), conversation_id: conversationId,
          role: m.role === "assistant" ? "assistant" : "user", contenido: normalizeValue(m.content),
          cambio_propuesto: m.cambio || null, citas: null,
          created_at: new Date(base + i * 1000).toISOString(),
        });
      });
    }

    // Resumen plano del plan activo (sin detalle semana a semana, ver cabecera de este fichero).
    const conPlan = [...entradas].filter((e) => e.profileData?.plan).sort((a, b) => (b.profileData.plan.generado || "") < (a.profileData.plan.generado || "") ? -1 : 1);
    if (conPlan.length) {
      const p = conPlan[0].profileData.plan;
      out.training_plans.push({
        id: nuevoId(conPlan[0].file, "training_plans", null, profileId, 1), athlete_profile_id: profileId, version: 1,
        distancia_objetivo: normalizeValue(perfilOrigen.distancia), fecha_carrera: isoDate(perfilOrigen.fechaCarrera),
        total_semanas: toNumber(p.totalSemanas), taper_semanas: toNumber(p.taper),
        run_dias: toNumber(p.runDias), gym_dias: toNumber(p.gymDias), techo_tirada_larga_min: toNumber(p.techo),
        riesgo_score: toNumber(p.riesgo?.score), riesgo_causas: p.riesgo?.causas || null,
        activo: true, generado_en: isoDate(p.generado) ? isoDate(p.generado) + "T12:00:00Z" : null,
      });
    }
  }

  out.legacy_id_map = legacyMap;
  out.stats = {
    generated_at: new Date().toISOString(),
    source_files: files,
    profiles_found: grupos.size,
    duplicates_dropped: duplicados.get(),
    rejected: rechazados.length,
    totals: {
      running_sessions_count: out.running_sessions.length,
      running_sessions_km_total: round2(out.running_sessions.reduce((s, r) => s + (r.distancia_km || 0), 0)),
      strength_sets_count: out.strength_sets.length,
      strength_sets_kg_total: round2(out.strength_sets.reduce((s, r) => s + (r.peso_kg || 0) * (r.reps || 0), 0)),
      feedback_logs_count: out.feedback_logs.length,
      recovery_logs_count: out.recovery_logs.length,
      documents_count: out.documents.length,
      fecha_min: minMax(out.running_sessions.map((r) => out.completed_sessions.find((c) => c.id === r.completed_session_id)?.fecha)).min,
      fecha_max: minMax(out.completed_sessions.map((c) => c.fecha)).max,
    },
  };

  if (rechazados.length) {
    await writeJson(path.join(path.dirname(TRANSFORMED_FILE), "rechazados.json"), rechazados);
    console.warn(`⚠ ${rechazados.length} fila(s) rechazadas (rango inválido o sin fecha) → migration/transformed/rechazados.json`);
  }

  await writeJson(TRANSFORMED_FILE, out);
  console.log(`\nPerfiles: ${out.athlete_profiles.length}  ·  Carreras: ${out.running_sessions.length}  ·  Series: ${out.strength_sets.length}  ·  Documentos: ${out.documents.length}`);
  console.log(`Duplicados descartados:`, duplicados.get());
  console.log(`→ ${TRANSFORMED_FILE}`);
  return { profiles: out.athlete_profiles.length };
}

function round2(n) { return Math.round(n * 100) / 100; }
function minMax(fechas) {
  const validas = fechas.filter(Boolean).sort();
  return { min: validas[0] || null, max: validas[validas.length - 1] || null };
}

function tablaVacia() {
  return {
    athlete_profiles: [], injuries: [], availability: [], strength_exercises: [],
    completed_sessions: [], running_sessions: [], strength_sessions: [], strength_sets: [],
    recovery_logs: [], feedback_logs: [], plan_modifications: [], documents: [],
    meal_catalog: [], conversations: [], messages: [], training_plans: [],
    legacy_id_map: [], stats: {},
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
