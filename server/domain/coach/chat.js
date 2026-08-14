/* Turno de conversación del coach (Fase 8).

   El flujo es el mismo que tenía el cliente: contexto → modelo → extraer el
   posible <<CAMBIO>> → el usuario acepta o rechaza. Lo que cambia es que el
   contexto sale de PostgreSQL, la evidencia son fragmentos citables, y todo
   queda persistido en conversations/messages. */
import { buildContext } from "./context.js";
import { extraerCambio } from "./validacion.js";
import { SIN_EVIDENCIA_TEXTO } from "./prompt.js";
import {
  compactarSiHaceFalta, guardarMensaje, historialParaPrompt, obtenerOCrearConversacion,
} from "./conversacion.js";
import { createRecommendation } from "../../db/repositories/aiConversations.js";

/* Preguntas que no piden evidencia científica, sino un dato del propio atleta.
   Aplicarles el umbral de "sin evidencia" sería absurdo: "¿cuánto corrí esta
   semana?" se responde con el bloque DATOS, no con un paper. */
const PIDE_EVIDENCIA = /(por qu|evidencia|estudio|papers?|ciencia|cient|demostrado|respald|seg[uú]n la literatura|qu[eé] dice)/i;

export async function responder(profileId, consulta, deps) {
  const {
    db, repo, llmProvider, embeddingProvider, rerankProvider, indice, config,
    conversationId = null, hoy = new Date(), persistir = true,
  } = deps;
  if (!llmProvider) throw new Error("No hay proveedor de IA configurado");

  const contexto = await buildContext(profileId, consulta, { db, repo, embeddingProvider, rerankProvider, indice, config, hoy });

  /* Umbral en el chat: solo cuando la pregunta reclama respaldo científico.
     Se comprueba antes de llamar al modelo (docs/05-rag.md §8.2). */
  if (!contexto.hayEvidencia && PIDE_EVIDENCIA.test(consulta)) {
    const conversacion = persistir ? await obtenerOCrearConversacion(profileId, { db, conversationId, titulo: consulta }) : null;
    if (conversacion) {
      await guardarMensaje(conversacion.id, { role: "user", contenido: consulta }, db);
      await guardarMensaje(conversacion.id, { role: "assistant", contenido: SIN_EVIDENCIA_TEXTO }, db);
    }
    return {
      texto: SIN_EVIDENCIA_TEXTO,
      hayEvidencia: false,
      motivo: contexto.retrieval.motivo,
      cambio: null, citas: [], avisos: ["No se ha llamado al modelo: la pregunta pide respaldo y no hay evidencia suficiente."],
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

  const { texto, cambio, avisos } = extraerCambio(respuesta.text);

  /* Se registran como citas del turno solo los fragmentos que el modelo
     realmente mencionó por id; el resto se entregó pero no se usó. */
  const citadas = contexto.chunks.filter((c) => respuesta.text.includes(c.id)).map((c) => c.id);

  if (conversacion) {
    await guardarMensaje(conversacion.id, { role: "user", contenido: consulta }, db);
    await guardarMensaje(conversacion.id, { role: "assistant", contenido: texto, cambioPropuesto: cambio, citas: citadas }, db);
    if (cambio) {
      await createRecommendation(profileId, {
        origen: "coach_chat", tipo: cambio.tipo, contenido: cambio, confianza: "media",
        provider: respuesta.provider || null, model: respuesta.model || null,
      }, db);
    }
    await compactarSiHaceFalta(conversacion.id, { db, llmProvider });
  }

  return {
    texto, cambio, avisos,
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
