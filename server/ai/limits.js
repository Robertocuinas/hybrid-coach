/* Presupuesto de tokens y de contexto, en un solo sitio.

   Estaba repartido en números literales por media docena de ficheros —1400 aquí,
   1000 en el chat, 400 en el resumen, 3000 en el planificador, un tope duro de
   4000 en /api/ia, 1200 caracteres por fragmento de evidencia—. Cada uno se
   eligió pensando en un modelo pequeño, y en conjunto imponían una ventana
   estrecha a cualquier modelo que se configurase después: un GPT-4.1 o un
   Claude con 200k de contexto quedaba recortado por constantes escritas para
   otro modelo, y el síntoma era una propuesta semanal cortada a media
   generación (stopReason "max_tokens") que el validador rechazaba entera.

   Aquí viven todos, con topes generosos por defecto y una variable de entorno
   por cada uno para poder ajustarlos sin tocar código ni redesplegar.

   Dos ideas, y conviene no confundirlas:

   - SALIDA (`maxTokens`): cuántos tokens puede escribir el modelo. Es lo que
     corta una respuesta a la mitad. Los valores por defecto son holgados
     porque el coste real de un tope alto es cero mientras el modelo no lo use:
     solo se paga lo que de verdad genera.

   - ENTRADA (`entrada`): cuánto texto se le entrega. Aquí sí hay coste por
     token en cada llamada, así que crece de forma más medida, pero deja de ser
     el cuello de botella que era.

   Todo se puede subir o bajar por entorno. Los mínimos existen para que una
   variable mal puesta degrade a algo utilizable en vez de romper la app. */

const entero = (valor, porDefecto, minimo, maximo) => {
  /* Una variable de entorno sin definir llega como undefined y una definida
     pero vacía como "". Number("") es 0, que es finito: sin este corte, un
     `LLM_MAX_TOKENS=` en el panel de Railway no caía en el valor por defecto
     sino en el mínimo, y dejaba al modelo con 256 tokens de salida. */
  if (valor === undefined || valor === null || String(valor).trim() === "") return porDefecto;
  const n = Number(valor);
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, Math.round(n)));
};

/** Tope global de salida. Es el techo que ninguna otra tarea puede superar y
 *  el valor por defecto de un proveedor que no diga otra cosa. */
export function topeSalida(env = process.env) {
  return entero(env.LLM_MAX_TOKENS, 8000, 256, 200_000);
}

/** Presupuesto de SALIDA por tarea. Cada uno se puede fijar por entorno; si no,
 *  se deriva del tope global, de modo que subir `LLM_MAX_TOKENS` sube todo a la
 *  vez y no hay que acordarse de seis variables. */
export function presupuestoSalida(env = process.env) {
  const tope = topeSalida(env);
  const derivado = (variable, fraccion, minimo) => Math.min(
    tope,
    entero(env[variable], Math.max(minimo, Math.round(tope * fraccion)), 128, 200_000),
  );
  return {
    tope,
    /* El planificador es el que más escribe: un JSON con la semana entera,
       sesiones, prescripción, cambios y avisos. Es también el único donde
       quedarse corto tira a la basura una generación de un minuto. */
    planificador: derivado("LLM_MAX_TOKENS_PLANIFICADOR", 1, 3000),
    /* Respuesta conversacional del coach. */
    coach: derivado("LLM_MAX_TOKENS_COACH", 0.5, 1500),
    /* Justificación razonada del plan con citas. */
    decisiones: derivado("LLM_MAX_TOKENS_DECISIONES", 0.5, 2400),
    /* Ficha de un PDF importado. */
    pdf: derivado("LLM_MAX_TOKENS_PDF", 0.35, 1600),
    /* Resumen de compactación de la conversación: por diseño es corto, y
       alargarlo empeora el resumen en vez de mejorarlo. */
    resumen: derivado("LLM_MAX_TOKENS_RESUMEN", 0.1, 600),
    /* Prueba de credenciales desde Ajustes: solo tiene que contestar algo. */
    prueba: entero(env.LLM_MAX_TOKENS_PRUEBA, 512, 16, 4000),
  };
}

/** Presupuesto de ENTRADA: cuánto contexto se le entrega al modelo. */
export function presupuestoEntrada(env = process.env) {
  return {
    /* Caracteres de texto por fragmento de evidencia en el planificador. */
    evidenciaChars: entero(env.PLANNER_EVIDENCE_CHARS, 3000, 300, 40_000),
    /* Caracteres por fragmento en el contexto del coach. */
    coachEvidenciaChars: entero(env.COACH_EVIDENCE_CHARS, 3000, 300, 40_000),
    /* Cuánto del intento rechazado se le devuelve al pedirle la reparación.
       Con un recorte agresivo el modelo repara a ciegas la parte que no ve. */
    reparacionChars: entero(env.PLANNER_REPAIR_CHARS, 60_000, 2000, 400_000),
    /* Turnos literales de conversación que viajan sin resumir. */
    turnosLiterales: entero(env.CHAT_TURNOS_LITERALES, 24, 2, 200),
    /* A partir de cuántos mensajes se compacta la conversación. */
    umbralResumen: entero(env.CHAT_RESUMEN_UMBRAL, 60, 4, 1000),
  };
}

/** Tope de `max_tokens` aceptado en una petición a /api/ia. El cliente puede
 *  pedir menos; nunca más que el tope global del servidor. */
export function topeSalidaPeticion(solicitado, env = process.env) {
  const tope = topeSalida(env);
  const n = Number(solicitado);
  if (!Number.isFinite(n) || n <= 0) return Math.min(tope, 4000);
  return Math.min(tope, Math.max(128, Math.round(n)));
}
