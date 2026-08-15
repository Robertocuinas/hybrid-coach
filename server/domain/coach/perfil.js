/* ============================================================
   COMPLETITUD DEL PERFIL PARA CONVERSAR

   El coach puede rellenar el perfil hablando, pero para eso necesita saber dos
   cosas que hasta ahora no estaban en el contexto: qué le falta y qué NO debe
   volver a preguntar.

   La lista es corta a propósito. El cuestionario completo tiene más de treinta
   campos y encadenarlos en un chat es un interrogatorio; aquí solo están los
   que cambian de verdad la programación. El resto se rellena en Ajustes cuando
   al atleta le apetezca, o no se rellena.
   ============================================================ */

/* Cada entrada: qué campo del perfil lo satisface, cómo se llama en castellano
   y qué preguntar. `alternativas` cubre que el mismo dato puede venir por dos
   caminos (la disponibilidad vive en su propia tabla, no en el perfil). */
export const ESENCIALES = Object.freeze([
  {
    clave: "distancia",
    campo: "distancia_objetivo",
    etiqueta: "objetivo",
    pregunta: "¿Qué distancia estás preparando?",
  },
  {
    clave: "fechaCarrera",
    campo: "fecha_carrera",
    etiqueta: "fecha de la carrera",
    pregunta: "¿Para qué fecha?",
  },
  {
    clave: "dias",
    campo: "dias_disponibles",
    etiqueta: "días que puedes entrenar",
    pregunta: "¿Cuántos días por semana puedes entrenar, y cuáles?",
  },
  {
    clave: "expCarrera",
    campo: "exp_carrera",
    etiqueta: "experiencia corriendo",
    pregunta: "¿Cuánto llevas corriendo y cuántos kilómetros haces a la semana ahora?",
  },
  {
    clave: "equipamiento",
    campo: "equipamiento",
    etiqueta: "acceso a gimnasio",
    pregunta: "¿Tienes gimnasio, material en casa o solo peso corporal?",
  },
]);

const vacio = (v) =>
  v === null || v === undefined || v === "" ||
  (Array.isArray(v) && v.length === 0);

/* Lee del contexto ya cargado, no de la base de datos: cargarContexto() trae
   el perfil y la disponibilidad, y duplicar consultas aquí solo añadiría
   latencia a cada turno de conversación. */
export function estadoPerfil(datos = {}) {
  const perfil = datos.perfil || {};
  const disponibilidad = datos.disponibilidad || null;

  const valorDe = (entrada) => {
    if (entrada.clave === "dias") return disponibilidad?.dias?.length ? disponibilidad.dias : null;
    return perfil[entrada.campo];
  };

  const faltan = ESENCIALES.filter((e) => vacio(valorDe(e)));
  const tiene = ESENCIALES.filter((e) => !vacio(valorDe(e)));
  return {
    completo: faltan.length === 0,
    faltan,
    tiene,
    /* Con plan activo el perfil ya sirvió para generarlo: preguntar de nuevo
       por lo básico sería absurdo aunque algún campo suelto esté vacío. */
    hayPlan: !!datos.plan,
  };
}

/* Bloque que se inyecta en el prompt. Dice explícitamente qué NO preguntar,
   porque es el error que más molesta: volver a pedir algo ya contestado. */
export function bloquePerfil(datos = {}) {
  const { completo, faltan, tiene, hayPlan } = estadoPerfil(datos);

  if (completo) {
    return [
      "ESTADO DEL PERFIL",
      "Completo para planificar. NO preguntes por objetivo, fecha, disponibilidad, experiencia ni equipamiento: ya los tienes en el bloque DATOS.",
    ].join("\n");
  }

  return [
    "ESTADO DEL PERFIL",
    hayPlan
      ? "Hay un plan activo, así que lo básico ya se contestó en su momento. Pide solo lo que falte si viene a cuento; no interrumpas la conversación para completarlo."
      : "Incompleto: sin estos datos no se puede planificar nada.",
    tiene.length ? `Ya sabes (NO lo vuelvas a preguntar): ${tiene.map((e) => e.etiqueta).join(", ")}.` : null,
    `Te falta: ${faltan.map((e) => e.etiqueta).join(", ")}.`,
    "Preguntas sugeridas, en este orden:",
    ...faltan.map((e) => `- ${e.pregunta}`),
  ].filter(Boolean).join("\n");
}

/* Reglas de conversación para completar el perfil. Van aparte de REGLAS_COACH
   porque solo aplican mientras falte algo esencial. */
export const REGLAS_PERFIL = `CÓMO COMPLETAS EL PERFIL
- Extrae TODO lo que puedas de cada mensaje. Si dice "tengo 25 años, entreno cuatro días —lunes, miércoles, viernes y sábado— y tengo gimnasio", has recogido edad, disponibilidad y equipamiento de golpe: no los preguntes uno por uno después.
- Pregunta como máximo DOS cosas por mensaje. Esto es una conversación, no un formulario.
- Nunca preguntes por algo que ya aparezca en el bloque DATOS o en "Ya sabes".
- Cuando tengas datos nuevos que guardar, emítelos con la acción actualizar_perfil y deja que el atleta confirme. No afirmes que el perfil ya está guardado.
- Si el atleta da un dato con dudas ("unos cuatro o cinco días"), quédate con el valor conservador y dilo.
- No inventes valores para rellenar huecos. Un campo que no te han dicho se queda sin poner.`;
