export const FALLBACK_MESSAGE = "No se ha podido generar una planificación basada en evidencia. Se mantiene provisionalmente el último plan aceptado.";

const MENSAJES = Object.freeze({
  no_evidence: "La biblioteca disponible no contiene evidencia suficiente para justificar una nueva planificación. Se mantiene provisionalmente el último plan aceptado.",
  clinical_safety: "Los datos registrados requieren una respuesta conservadora y valoración profesional. No se genera una nueva planificación y se mantiene el plan previo sin ejecutar sesiones de impacto.",
  retrieval_failed: FALLBACK_MESSAGE,
  llm_failed: FALLBACK_MESSAGE,
  invalid_output: FALLBACK_MESSAGE,
  guardrail_failed: FALLBACK_MESSAGE,
  invalid_context: "Faltan datos necesarios para generar la semana. Se mantiene provisionalmente el último plan aceptado.",
});

/** El fallback referencia un plan existente; nunca fabrica sesiones nuevas. */
export function crearFallbackSeguro({ code = "invalid_output", contexto = {}, details = null } = {}) {
  const previo = contexto.acceptedRevision || contexto.week || null;
  return {
    code,
    message: MENSAJES[code] || FALLBACK_MESSAGE,
    retainedSource: contexto.acceptedRevision ? "accepted_revision" : previo ? "master_week" : "none",
    retainedPlan: previo,
    requiresUserAction: code === "clinical_safety",
    details,
  };
}

export const createSafeFallback = crearFallbackSeguro;

