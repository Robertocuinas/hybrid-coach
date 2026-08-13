/* Needle solo selecciona una intención dentro de esta lista cerrada. La lista
   es deliberadamente de lectura: ningún resultado local modifica el plan ni
   los datos del atleta. */
export const COACH_LOCAL_TOOLS = Object.freeze([
  {
    name: "consultar_perfil",
    description: "Consultar datos y objetivos del perfil activo del atleta.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "consultar_plan",
    description: "Consultar el plan activo, la semana o las sesiones planificadas.",
    parameters: {
      type: "object",
      properties: { semana: { type: "integer", minimum: 1, description: "Número de semana si se menciona" } },
      additionalProperties: false,
    },
  },
  {
    name: "consultar_sesiones",
    description: "Consultar entrenamientos realizados, kilómetros, duración o historial de sesiones.",
    parameters: {
      type: "object",
      properties: {
        periodo: { type: "string", enum: ["hoy", "semana", "mes", "todo"], description: "Periodo solicitado" },
      },
      required: ["periodo"],
      additionalProperties: false,
    },
  },
  {
    name: "buscar_evidencia",
    description: "Buscar estudios, referencias o evidencia científica para una pregunta de entrenamiento o nutrición.",
    parameters: {
      type: "object",
      properties: { consulta: { type: "string", description: "Tema de evidencia solicitado" } },
      required: ["consulta"],
      additionalProperties: false,
    },
  },
  {
    name: "conversar_coach",
    description: "Responder una pregunta general, razonar o dar consejo cuando no basta con consultar datos estructurados.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
]);

export const NEEDLE_SYSTEM_PROMPT = `Clasifica la petición del atleta usando exactamente una herramienta.
No inventes datos ni ejecutes acciones. Si pide modificar, borrar o aceptar un cambio, usa conversar_coach.
La autorización y la ejecución pertenecen al servidor.`;
