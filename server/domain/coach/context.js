/* buildContext() reescrito para leer de PostgreSQL (Fase 8).

   Antes vivía en el cliente y armaba el prompt desde el blob de localStorage,
   con la "BASE DE EVIDENCIA" sacada de fichas resumen de una línea. Ahora lee
   de la base de datos y la evidencia son fragmentos reales recuperados por el
   RAG, con página y sección.

   Estructura del prompt, con encabezados explícitos (docs/04-capa-ia.md §9):
     DATOS      → lo que sabemos del atleta. Hechos, no opiniones.
     REGLAS     → lo que decidió el motor determinista y no se negocia.
     EVIDENCIA  → fragmentos recuperados, cada uno con su id citable.
   Mantenerlos separados es lo que impide que el modelo confunda un dato del
   atleta con una afirmación de un paper. */
import { cargarContexto } from "../../db/repositories/coachContext.js";
import { recuperar } from "../../rag/retrieval.js";
import { catalogoParaPrompt } from "./acciones.js";

/* El planificador IA + RAG está en desarrollo. Mientras sus rutas no existan,
   sus acciones NO se le ofrecen al modelo: prometer "te preparo la semana" y
   fallar después es peor que decir desde el principio que aún no se puede.
   Cuando se monte server/routes/planning.js, esto se activa solo. */
let hayPlanificador = null;
export async function planificadorDisponible() {
  if (hayPlanificador === null) {
    try { await import("../../routes/planning.js"); hayPlanificador = true; }
    catch { hayPlanificador = false; }
  }
  return hayPlanificador;
}
import { formatearEvidencia, reglasAcciones, REGLAS_COACH, REGLAS_DISTRIBUCION } from "./prompt.js";

const guion = (valor, sufijo = "") => (valor === null || valor === undefined || valor === "" ? null : `${valor}${sufijo}`);
const listaOTexto = (lista, vacio) => (lista?.length ? lista.join("; ") : vacio);

export function describirLesiones(lesiones = []) {
  return listaOTexto(
    lesiones.map((l) => l.zona + (l.recurrente ? " (recurrente)" : "") + (l.contexto ? ` — ${l.contexto}` : "")),
    "ninguna declarada"
  );
}

/* El contexto del atleta se le pasa al retrieval para ampliar la consulta:
   "me duele el gemelo" recupera poco; con la distancia objetivo y el historial
   de lesiones recupera lo que hace falta (docs/05-rag.md §6). */
export function contextoParaRetrieval(datos) {
  const { perfil, lesiones, plan, planificadas } = datos;
  const siguiente = (planificadas || []).find((session) => new Date(session.fecha) >= new Date());
  const molestiasActuales = Array.isArray(perfil?.current_complaints)
    ? perfil.current_complaints.filter((item) => item?.activa !== false).slice(0, 5)
    : [];
  return {
    distanciaObjetivo: perfil?.distancia_objetivo || plan?.distancia_objetivo || null,
    fase: siguiente?.session_type || (plan ? `plan de ${plan.total_semanas} semanas` : null),
    lesiones: (lesiones || []).map((l) => ({ zona: l.zona, recurrente: l.recurrente })),
    molestias: [...molestiasActuales, ...(datos.checkins || [])
      .filter((c) => c.dolor >= 3 && c.zona_dolor)
      .slice(0, 3)
      .map((c) => ({ zona: c.zona_dolor, intensidad: c.dolor }))],
    prioridad: (perfil?.prioridades || [])[0] || null,
  };
}

function bloqueDatos(datos, hoy) {
  const { perfil: p, plan, lesiones, disponibilidad, planificadas, sesiones, checkins, recuperacion, cargas, nutricion, decisiones } = datos;

  const carreras = sesiones.filter((s) => ["run", "running"].includes(s.tipo) || s.codigo_sesion);
  const lineaCarreras = carreras.length
    ? carreras.slice(0, 8).map((r) => `${fecha(r.fecha)} ${r.codigo_sesion || "carrera"} ${r.distancia_km ?? "?"}km/${r.duracion_min ?? "?"}min RPE${r.rpe ?? "?"} dolor${r.dolor ?? 0}${r.notas ? ` «${r.notas}»` : ""}`).join(" | ")
    : "sin registros";

  const lineaCargas = cargas.length
    ? cargas.slice(0, 12).map((c) => `${c.nombre} ${c.peso_kg}kg×${c.reps}${c.rir !== null ? ` (RIR ${c.rir})` : ""} ${fecha(c.fecha)}`).join(" | ")
    : "sin registros";

  const lineaCheckins = checkins.length
    ? checkins.map((c) => `${fecha(c.fecha)} RPE${c.rpe ?? "?"} dolor${c.dolor ?? 0}${c.zona_dolor ? `(${c.zona_dolor})` : ""} energía${c.energia ?? "?"}${c.comentario ? ` «${c.comentario}»` : ""}`).join(" | ")
    : "sin registros";

  const lineaRecuperacion = recuperacion.length
    ? recuperacion.map((r) => `${fecha(r.fecha)} sueño${r.horas_sueno ?? "?"}h fatiga${r.fatiga ?? "?"}`).join(" | ")
    : "sin registros";

  const lineaPlanificadas = planificadas?.length
    ? planificadas.map((s) => `${fecha(s.fecha)} ${s.codigo_sesion || s.titulo || s.tipo}${s.duracion_min ? ` ${s.duracion_min}min` : ""}${s.priority ? ` prioridad ${s.priority}` : ""}`).join(" | ")
    : "sin calendario diario persistido";

  const minUltimos7 = carreras
    .filter((r) => diasDesde(r.fecha, hoy) <= 7)
    .reduce((total, r) => total + (Number(r.duracion_min) || 0), 0);

  const lineaDisponibilidad = disponibilidad
    ? `Disponibilidad vigente: días ${(disponibilidad.dias || []).join(", ")}; gimnasio ${disponibilidad.min_gym ?? "?"}min; carrera ${disponibilidad.min_run ?? "?"}min; fin de semana ${disponibilidad.min_finde ?? "?"}min.`
    : "Disponibilidad: sin registro canónico.";

  const lineaMolestias = Array.isArray(p.current_complaints) && p.current_complaints.length
    ? p.current_complaints.filter((item) => item?.activa !== false)
      .map((item) => `${item.zona || "zona no indicada"}: dolor ${item.intensidad ?? item.dolor ?? "?"}/10${item.cuando ? ` (${item.cuando})` : ""}`)
      .join("; ")
    : "ninguna declarada";

  return [
    "DATOS DEL ATLETA",
    `Calendario de ayer a +7 días: ${lineaPlanificadas}`,
    lineaDisponibilidad,
    `Molestias actuales: ${lineaMolestias}.`,
    `${p.nombre || "Atleta"}, ${guion(p.edad, " años") || "edad no declarada"}, ${p.sexo || "sexo no declarado"}, ${guion(p.altura_cm, " cm") || "altura no declarada"}, ${guion(p.peso_kg, " kg") || "peso no declarado"}${p.grasa_pct ? `, ${p.grasa_pct}% de grasa` : ""}.`,
    `Objetivo: ${p.distancia_objetivo || "sin definir"} el ${fecha(p.fecha_carrera) || "sin fecha"} — ${p.meta_tipo || "sin meta declarada"}${p.meta_tiempo ? ` (${p.meta_tiempo})` : ""}.`,
    `Prioridades: ${(p.prioridades || []).join(" > ") || "sin declarar"}.`,
    `Corriendo: experiencia ${p.exp_carrera || "?"}, ${p.km_semana ?? "?"} km/semana, ${p.sesiones_carrera ?? "?"} sesiones, tirada más larga ${p.tirada_larga_min ?? "?"} min, parón: ${p.paron || "no"}.`,
    `Gimnasio: experiencia ${p.exp_fuerza || "?"}, técnica ${p.tecnica || "?"}, equipamiento ${p.equipamiento || "?"}.`,
    `Lesiones: ${describirLesiones(lesiones)}. Particularidades: ${(p.estructural || []).join(", ") || "—"}. ${p.cirugias || ""}`.trim(),
    `Recuperación declarada: ${p.horas_sueno ?? "?"} h de sueño (${p.calidad_sueno || "?"}), estrés ${p.estres ?? "?"}/10, nutrición ${p.nutricion_objetivo || "?"}, medición ${p.reloj || "?"}.`,
    "",
    `ESTADO ACTUAL (${fecha(hoy)}) — ventana de ${datos.ventanaDias} días`,
    `Últimas carreras: ${lineaCarreras}`,
    `Últimas cargas por ejercicio: ${lineaCargas}`,
    `Check-ins: ${lineaCheckins}`,
    `Recuperación registrada: ${lineaRecuperacion}`,
    `Últimos 7 días: ${minUltimos7} min de carrera.`,
    nutricion ? `Nutrición calculada por el motor para ${fecha(nutricion.fecha)}: ${nutricion.kcal ?? "?"} kcal · ${nutricion.proteina_g ?? "?"} g proteína · ${nutricion.carbohidrato_g ?? "?"} g carbohidrato · ${nutricion.grasa_g ?? "?"} g grasa.${nutricion.recortado_por_suelo ? " ATENCIÓN: elevada hasta el suelo de seguridad energética." : ""}` : "Sin objetivos de nutrición calculados.",
    "",
    plan ? planificacion(plan, decisiones) : "PLAN\nNo hay plan activo todavía.",
  ].join("\n");
}

function planificacion(plan, decisiones) {
  return [
    "PLAN MAESTRO VIGENTE (no cambies objetivo, fecha, fases ni límites; los ajustes tácticos semanales solo se proponen y requieren confirmación)",
    `${plan.total_semanas ?? "?"} semanas · ${plan.run_dias ?? "?"} carreras y ${plan.gym_dias ?? "?"} sesiones de gimnasio por semana · tirada larga máxima ${plan.techo_tirada_larga_min ?? "?"} min · taper de ${plan.taper_semanas ?? "?"} semana(s).`,
    `Riesgo estructural: ${plan.riesgo_score ?? "?"}/10${Array.isArray(plan.riesgo_causas) && plan.riesgo_causas.length ? ` (${plan.riesgo_causas.join("; ")})` : ""}.`,
    decisiones.length
      ? `Decisiones vigentes:\n${decisiones.map((d) => `- ${d.titulo}: ${d.justificacion}${d.fuente === "ia" ? " [revisada por el atleta]" : ""}`).join("\n")}`
      : "Sin decisiones registradas todavía.",
  ].join("\n");
}

const fecha = (valor) => {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? String(valor) : d.toISOString().slice(0, 10);
};

const diasDesde = (valor, hoy) => {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return Infinity;
  return Math.round((new Date(hoy) - d) / 86400000);
};

/**
 * Construye el system prompt del coach y devuelve también los fragmentos
 * entregados: quien valida después necesita saber EXACTAMENTE qué se envió,
 * porque una cita a algo que no se entregó es una cita inventada.
 *
 * @returns { system, chunks, hayEvidencia, retrieval, datos }
 */
/* Traduce el contexto de pantalla que envía el cliente a una línea de texto.
   Lista blanca estricta: lo que no esté aquí no viaja al prompt, para que
   ampliar la interfaz no filtre datos nuevos sin querer (§12 del encargo). */
export function describirPantalla(pantalla = {}) {
  const partes = [];
  const vista = String(pantalla.vista || "").slice(0, 30);
  if (vista) partes.push(`Pantalla: ${vista}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(pantalla.fecha || ""))) partes.push(`Día que está mirando: ${pantalla.fecha}`);
  const sesion = String(pantalla.sesion || "").slice(0, 20);
  if (sesion) partes.push(`Sesión en pantalla: ${sesion}`);
  const semana = Number.parseInt(pantalla.semana, 10);
  if (Number.isInteger(semana) && semana > 0 && semana < 100) partes.push(`Semana: ${semana}`);
  return partes.length
    ? `${partes.join(" · ")}
Si dice "esto", "este entrenamiento" o "hoy" sin más contexto, se refiere a lo anterior.`
    : "(sin contexto de pantalla)";
}

export async function buildContext(profileId, consulta, deps) {
  const { db, repo, embeddingProvider, rerankProvider, indice, config, hoy = new Date(), pantalla = null } = deps;
  const datos = await cargarContexto(profileId, { db, hoy });
  if (!datos.perfil) throw new Error("El perfil no existe o no tiene datos");
  const planificador = await planificadorDisponible();

  const retrieval = await recuperar(consulta || "", {
    db, repo, embeddingProvider, rerankProvider, indice, config,
    contexto: contextoParaRetrieval(datos),
  });

  const evidencia = retrieval.hayEvidencia
    ? formatearEvidencia(retrieval.chunks)
    : "(no hay evidencia suficiente en la biblioteca para esta consulta)";

  const system = [
    `Eres el entrenador personal de ${datos.perfil.nombre || "este atleta"}. Hablas SIEMPRE en español, tuteas, y respondes breve (2-6 frases salvo que pidan detalle).`,
    "",
    bloqueDatos(datos, hoy),
    "",
    "REGLAS DE DISTRIBUCIÓN QUE APLICA EL PLANIFICADOR",
    REGLAS_DISTRIBUCION,
    "",
    `EVIDENCIA RECUPERADA (${retrieval.chunks.length} fragmentos de la biblioteca)`,
    evidencia,
    "",
    REGLAS_COACH,
    "",
    reglasAcciones(catalogoParaPrompt({ planificador }), new Date(hoy).toISOString().slice(0, 10)),
    /* Contexto de la pantalla desde la que se abre el coach: permite que
       "¿puedo hacer esto mañana?" se refiera a lo que el atleta está mirando
       sin que tenga que describirlo. Solo lo mínimo, nunca la página entera. */
    ...(pantalla ? ["", "DÓNDE ESTÁ EL ATLETA AHORA MISMO", describirPantalla(pantalla)] : []),
  ].join("\n");

  return { system, chunks: retrieval.chunks, hayEvidencia: retrieval.hayEvidencia, retrieval, datos };
}
