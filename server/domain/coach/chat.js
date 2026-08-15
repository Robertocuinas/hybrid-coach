/* Turno de conversación del coach (Fase 8).

   El flujo es el mismo que tenía el cliente: contexto → modelo → extraer el
   posible <<CAMBIO>> → el usuario acepta o rechaza. Lo que cambia es que el
   contexto sale de PostgreSQL, la evidencia son fragmentos citables, y todo
   queda persistido en conversations/messages. */
import { buildContext } from "./context.js";
import { extraerCambio } from "./validacion.js";
import { ejecutorDe, extraerAccion } from "./acciones.js";
import { SIN_EVIDENCIA_TEXTO } from "./prompt.js";
import {
  compactarSiHaceFalta, guardarMensaje, historialParaPrompt, obtenerOCrearConversacion,
} from "./conversacion.js";
import { createRecommendation } from "../../db/repositories/aiConversations.js";

/* Preguntas que no piden evidencia científica, sino un dato del propio atleta.
   Aplicarles el umbral de "sin evidencia" sería absurdo: "¿cuánto corrí esta
   semana?" se responde con el bloque DATOS, no con un paper. */
const PIDE_EVIDENCIA = /(por qu|evidencia|estudio|papers?|ciencia|cient|demostrado|respald|seg[uú]n la literatura|qu[eé] dice)/i;
const DECISION_ENTRENAMIENTO = /(entren|correr|fuerza|gimnas|sesi[oó]n|interval|tirada|rodaje|mover|cambiar|sustitu|reduc|elimin|descans|fatiga|dolor|plan|qu[eé] hago|salgo|convien|puedo|deber[ií]a|ma[nñ]ana|pasado ma[nñ]ana)/i;

/* Los cortes clínicos no dependen del modelo ni del RAG. Solo se activan en
   preguntas de entrenamiento: una consulta factual como “cuántos km hice”
   sigue pudiendo responderse aunque exista un registro de dolor reciente. */
function bloqueoClinico(datos, consulta) {
  if (!DECISION_ENTRENAMIENTO.test(consulta)) return null;
  const banderas = (datos.perfil?.banderas || []).filter((flag) => flag && !/^ninguna$/i.test(flag));
  if (banderas.length) {
    return "Hay una bandera de salud declarada. No voy a proponerte cambios de entrenamiento hasta que un profesional sanitario confirme que puedes entrenar con seguridad.";
  }
  const molestias = (datos.perfil?.current_complaints || [])
    .filter((item) => item?.activa !== false)
    .map((item) => ({
      fecha: item.fecha || new Date().toISOString().slice(0, 10),
      dolor: item.intensidad ?? item.dolor ?? item.pain,
      tipo_dolor: item.tipo,
      cuando_aparece: item.cuando,
    }));
  const registros = [...molestias, ...(datos.checkins || []), ...(datos.recuperacion || [])]
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const dolorAlto = registros.find((row) => Number(row.dolor) >= 5);
  const dolorReposo = registros.find((row) => /reposo/i.test(`${row.tipo_dolor || ""} ${row.cuando_aparece || ""}`));
  if (dolorReposo) {
    return "Has registrado dolor en reposo. Para el impacto y consulta con un profesional sanitario; no voy a reorganizar el plan como si fuera solo fatiga de entrenamiento.";
  }
  if (dolorAlto) {
    return `El último dolor registrado es ${dolorAlto.dolor}/10. No voy a proponerte una sesión de impacto ni un aumento de carga; prioriza parar y valorar la evolución con un profesional sanitario.`;
  }
  return null;
}

export async function responder(profileId, consulta, deps) {
  const {
    db, repo, llmProvider, embeddingProvider, rerankProvider, indice, config,
    conversationId = null, hoy = new Date(), persistir = true, pantalla = null,
    ejecutarEnServidor = null,
    onValidatedChange = null,
  } = deps;
  if (!llmProvider) throw new Error("No hay proveedor de IA configurado");

  const contexto = await buildContext(profileId, consulta, { db, repo, embeddingProvider, rerankProvider, indice, config, hoy, pantalla });

  const seguridad = bloqueoClinico(contexto.datos, consulta);
  if (seguridad) {
    const conversacion = persistir ? await obtenerOCrearConversacion(profileId, { db, conversationId, titulo: consulta }) : null;
    if (conversacion) {
      await guardarMensaje(conversacion.id, { role: "user", contenido: consulta }, db);
      await guardarMensaje(conversacion.id, { role: "assistant", contenido: seguridad }, db);
    }
    return {
      texto: seguridad, hayEvidencia: contexto.hayEvidencia, cambio: null, accion: null, citas: [],
      avisos: ["Guardrail clínico aplicado por código; no se ha llamado al modelo."],
      conversationId: conversacion?.id || null, retrieval: contexto.retrieval.diagnostico,
    };
  }

  /* Cualquier decisión sobre el calendario exige grounding aunque el atleta
     no escriba literalmente “qué dice la ciencia”. */
  if (!contexto.hayEvidencia && (PIDE_EVIDENCIA.test(consulta) || DECISION_ENTRENAMIENTO.test(consulta))) {
    const conversacion = persistir ? await obtenerOCrearConversacion(profileId, { db, conversationId, titulo: consulta }) : null;
    if (conversacion) {
      await guardarMensaje(conversacion.id, { role: "user", contenido: consulta }, db);
      await guardarMensaje(conversacion.id, { role: "assistant", contenido: SIN_EVIDENCIA_TEXTO }, db);
    }
    return {
      texto: SIN_EVIDENCIA_TEXTO,
      hayEvidencia: false,
      motivo: contexto.retrieval.motivo,
      cambio: null, accion: null, citas: [], avisos: ["No se ha llamado al modelo: una decisión de entrenamiento exige evidencia y el corpus no ofrece cobertura suficiente."],
      conversationId: conversacion?.id || null,
      retrieval: contexto.retrieval.diagnostico,
    };
  }

  const conversacion = persistir ? await obtenerOCrearConversacion(profileId, { db, conversationId, titulo: consulta }) : null;
  const historial = conversacion ? await historialParaPrompt(conversacion.id, { db }) : [];

  const respuesta = await llmProvider.call({
    system: contexto.system,
    maxTokens: 1000,
    messages: [...historial, { role: "user", content: consulta }],
  });

  const extraida = extraerCambio(respuesta.text);
  let cambio = extraida.cambio;
  const avisos = [...extraida.avisos];
  const sinCambio = extraida.texto;
  /* El bloque de acción se extrae DESPUÉS del de cambio: son independientes y
     un mensaje puede llevar los dos (proponer mover algo y además pedir la
     acción que lo ejecuta). */
  const { texto, accion, avisos: avisosAccion } = extraerAccion(sinCambio);

  /* Las acciones de ejecutor "servidor" —consultar el catálogo de ejercicios—
     se resuelven aquí y su resultado viaja con la respuesta: son de lectura y
     el atleta ya las ha pedido. Un fallo se devuelve como resultado, nunca
     tumba el turno de conversación. */
  let resultadoAccion = null;
  if (accion && ejecutorDe(accion.accion) === "servidor" && ejecutarEnServidor) {
    try { resultadoAccion = await ejecutarEnServidor(accion); }
    catch (error) { resultadoAccion = { ok: false, mensaje: error.message }; }
  }

  /* Se registran como citas del turno solo los fragmentos que el modelo
     realmente mencionó por id; el resto se entregó pero no se usó. */
  const citadas = contexto.chunks.filter((c) => respuesta.text.includes(c.id)).map((c) => c.id);

  if (cambio && !citadas.length) {
    avisos.push("Cambio descartado: no citó ningún fragmento entregado. El calendario permanece intacto.");
    cambio = null;
  }

  /* Un <<CAMBIO>> válido sigue sin ser un calendario. Si la capa de
     aplicación está disponible, se transforma en una revisión semanal completa
     pasando otra vez por RAG, schema y guardrails. Así el botón Aceptar activa
     exactamente el mismo artefacto que la pantalla Mi semana. */
  if (cambio && typeof onValidatedChange === "function") {
    try {
      const linked = await onValidatedChange({
        profileId, consulta, cambio, datos: contexto.datos,
        citedChunkIds: citadas, conversationId: conversacion?.id || null,
      });
      if (!linked?.proposalId || !linked?.proposalRevision) throw new Error("el planificador no devolvió una revisión persistida");
      cambio = { ...cambio, ...linked };
    } catch (error) {
      avisos.push(`El cambio no se convirtió en una propuesta segura: ${String(error?.message || error).slice(0, 240)} El calendario permanece intacto.`);
      cambio = null;
    }
  }

  if (conversacion) {
    await guardarMensaje(conversacion.id, { role: "user", contenido: consulta }, db);
    await guardarMensaje(conversacion.id, { role: "assistant", contenido: texto, cambioPropuesto: cambio, citas: citadas }, db);
    if (cambio) {
      const recommendation = await createRecommendation(profileId, {
        origen: "coach_chat", tipo: cambio.tipo, contenido: cambio, confianza: "media",
        provider: respuesta.provider || null, model: respuesta.model || null,
      }, db);
      cambio.recommendationId = recommendation?.id || null;
    }
    await compactarSiHaceFalta(conversacion.id, { db, llmProvider });
  }

  return {
    texto, cambio, accion, resultadoAccion, avisos: [...avisos, ...avisosAccion],
    hayEvidencia: contexto.hayEvidencia,
    citas: contexto.chunks
      .filter((c) => citadas.includes(c.id))
      .map((c) => ({ id: c.id, titulo: c.titulo, autores: c.autores, anio: c.anio, seccion: c.seccion, paginaInicio: c.paginaInicio, paginaFin: c.paginaFin, doi: c.doi })),
    fragmentosEntregados: contexto.chunks.length,
    conversationId: conversacion?.id || null,
    provider: respuesta.provider || null,
    model: respuesta.model || null,
    retrieval: contexto.retrieval.diagnostico,
  };
}
