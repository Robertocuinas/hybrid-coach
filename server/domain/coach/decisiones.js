/* decisionesIA() adaptado al RAG real (Fase 8).

   El FLUJO DE DECISIÓN NO CAMBIA: se recupera evidencia, se pide al modelo un
   JSON, se valida, y nada se aplica solo — el usuario acepta o rechaza. Lo
   único distinto es que la evidencia son fragmentos con página en vez de
   fichas de una línea, y que el proveedor de LLM es intercambiable
   (docs/10-decisiones-tecnicas.md D5) en vez de estar acoplado a Anthropic. */
import { extraerJSON } from "../../integrations/pdf-extractor.js";
import { recuperar } from "../../rag/retrieval.js";
import { cargarContexto } from "../../db/repositories/coachContext.js";
import { contextoParaRetrieval } from "./context.js";
import { formatearEvidencia, SYS_DECISIONES, SIN_EVIDENCIA_TEXTO } from "./prompt.js";
import { validarPropuesta } from "./validacion.js";
import { guardarDecisionConCitas } from "../../db/repositories/trainingPlans.js";
import { createRecommendation } from "../../db/repositories/aiConversations.js";

/* Consulta de recuperación para el razonamiento del plan. Es deliberadamente
   temática y amplia: aquí no hay pregunta del usuario, se justifica el plan
   entero, así que se buscan los temas que el plan toca. */
export function consultaDeDecisiones(datos) {
  const { perfil, lesiones } = datos;
  return [
    perfil?.distancia_objetivo,
    "entrenamiento concurrente fuerza resistencia interferencia",
    "volumen tirada larga progresión lesión tendón",
    "taper descarga recuperación proteína",
    (lesiones || []).map((l) => l.zona).join(" "),
    (perfil?.prioridades || []).join(" "),
  ].filter(Boolean).join(" ");
}

/* Los hechos que el motor determinista ya calculó. Se entregan como dato
   cerrado, no como algo que el modelo pueda recalcular (CLAUDE.md §4.1). */
export function hechosPlan(datos) {
  const { perfil: p, plan, lesiones } = datos;
  return {
    atleta: { edad: p.edad, sexo: p.sexo, peso: p.peso_kg, altura: p.altura_cm, grasa: p.grasa_pct },
    objetivo: { distancia: p.distancia_objetivo, fecha: p.fecha_carrera, meta: p.meta_tipo, prioridades: p.prioridades || [] },
    punto_partida: { experiencia: p.exp_carrera, km_semana: p.km_semana, sesiones: p.sesiones_carrera, tirada_larga_min: p.tirada_larga_min, paron: p.paron },
    gimnasio: { experiencia: p.exp_fuerza, tecnica: p.tecnica, equipamiento: p.equipamiento, cargas: p.cargas || {} },
    lesiones: (lesiones || []).map((l) => ({ zona: l.zona, recurrente: !!l.recurrente, contexto: l.contexto })),
    estructural: p.estructural || [],
    recuperacion: { sueno_h: p.horas_sueno, calidad: p.calidad_sueno, estres: p.estres, nutricion: p.nutricion_objetivo },
    ESTRUCTURA_YA_DECIDIDA: plan ? {
      semanas_totales: plan.total_semanas,
      semanas_taper: plan.taper_semanas,
      techo_tirada_larga_min: plan.techo_tirada_larga_min,
      riesgo_estructural: `${plan.riesgo_score}/10`,
      causas_riesgo: plan.riesgo_causas || [],
      sesiones_carrera: plan.run_dias,
      sesiones_gimnasio: plan.gym_dias,
    } : null,
  };
}

/**
 * @param deps { db, repo, llmProvider, embeddingProvider, rerankProvider, indice, config, persistir }
 */
export async function decisionesIA(profileId, deps) {
  const { db, repo, llmProvider, embeddingProvider, rerankProvider, indice, config, persistir = true, hoy = new Date() } = deps;
  if (!llmProvider) throw new Error("No hay proveedor de IA configurado");

  const datos = await cargarContexto(profileId, { db, hoy });
  if (!datos.perfil) throw new Error("El perfil no existe");

  const retrieval = await recuperar(consultaDeDecisiones(datos), {
    db, repo, embeddingProvider, rerankProvider, indice, config,
    contexto: contextoParaRetrieval(datos),
  });

  /* Umbral comprobado ANTES de llamar al LLM: ahorra tokens y evita que el
     modelo rellene el hueco con conocimiento general (docs/05-rag.md §8.2). */
  if (!retrieval.hayEvidencia) {
    return {
      hayEvidencia: false,
      mensaje: SIN_EVIDENCIA_TEXTO,
      motivo: retrieval.motivo,
      decisiones: [], adaptaciones: [], ajustes: [], sinRespaldo: [], evidenciaMixta: [],
      avisos: ["No se ha llamado al modelo: no hay evidencia suficiente en la biblioteca."],
      retrieval: retrieval.diagnostico,
    };
  }

  const respuesta = await llmProvider.call({
    system: SYS_DECISIONES,
    maxTokens: 2400,
    messages: [{
      role: "user",
      content: [
        `EVIDENCIA (${retrieval.chunks.length} fragmentos recuperados de la biblioteca)`,
        formatearEvidencia(retrieval.chunks),
        "",
        "DATOS DEL ATLETA Y ESTRUCTURA YA DECIDIDA",
        JSON.stringify(hechosPlan(datos), null, 1),
      ].join("\n"),
    }],
  });

  const validada = validarPropuesta(extraerJSON(respuesta.text), { entregados: retrieval.chunks });
  const salida = {
    hayEvidencia: true,
    ...validada,
    provider: respuesta.provider || null,
    model: respuesta.model || null,
    generado: new Date().toISOString(),
    fragmentosUsados: retrieval.chunks.map((c) => c.id),
    retrieval: retrieval.diagnostico,
  };

  if (persistir) salida.persistido = await persistirDecisiones(db, profileId, datos.plan?.id, salida);
  return salida;
}

/* Se registra en ai_recommendations con provider y model (criterio de
   terminado de la fase) y las decisiones van a plan_decisions con sus citas. */
export async function persistirDecisiones(db, profileId, planId, salida) {
  await createRecommendation(profileId, {
    origen: "razonamiento_plan",
    tipo: "decisiones",
    contenido: {
      decisiones: salida.decisiones,
      adaptaciones: salida.adaptaciones,
      ajustes: salida.ajustes,
      evidenciaMixta: salida.evidenciaMixta,
      avisos: salida.avisos,
    },
    confianza: salida.decisiones[0]?.confianza || "media",
    provider: salida.provider,
    model: salida.model,
  });

  if (!planId) return { decisiones: 0, citas: 0, motivo: "sin plan activo al que asociarlas" };

  let citas = 0;
  const cliente = typeof db.connect === "function" && typeof db.idleCount === "number" ? await db.connect() : db;
  const soltar = cliente === db ? () => {} : () => cliente.release();
  try {
    for (const decision of salida.decisiones) {
      const guardada = await guardarDecisionConCitas(cliente, planId, decision);
      citas += guardada.citas;
    }
  } finally { soltar(); }

  return { decisiones: salida.decisiones.length, citas };
}
