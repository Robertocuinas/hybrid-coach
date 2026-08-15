/* ============================================================
   PATRÓN DE MOVIMIENTO → CRITERIOS DE CATÁLOGO

   Esta es la pieza que mantiene la separación del encargo: el planificador y
   el RAG deciden QUÉ PATRÓN hace falta ("dominante de rodilla, bajo volumen"),
   y aquí se traduce ese patrón al vocabulario del catálogo externo para
   preguntar QUÉ EJERCICIOS existen que lo cumplan.

   El catálogo nunca decide. Si mañana se cambia de proveedor, cambia esta
   tabla y nada más: `PAT` en el cliente y las plantillas siguen igual.

   Las claves de `PATRONES` son exactamente las de `PAT` en src/HybridCoach.jsx.
   Los músculos y equipamientos son el vocabulario de ExerciseDB, en inglés y
   en minúsculas, en orden de preferencia.

   AVISO: este vocabulario está tomado de la documentación del proveedor y
   conviene contrastarlo contra la API real la primera vez que se configure una
   clave; por eso es una tabla de datos y no lógica repartida por el código.
   ============================================================ */

/* Niveles de equipamiento del perfil, y qué acepta cada uno. Son acumulativos
   hacia abajo: un gimnasio completo admite todo lo de casa, pero no al revés.
   Es lo que impide recomendar prensa a quien entrena en el salón. */
export const EQUIPO_POR_NIVEL = Object.freeze({
  casa: ["body weight", "band", "resistance band", "assisted"],
  basico: ["body weight", "band", "resistance band", "assisted", "dumbbell", "kettlebell", "leverage machine", "cable", "stability ball", "medicine ball"],
  full: ["body weight", "band", "resistance band", "assisted", "dumbbell", "kettlebell", "leverage machine", "cable", "stability ball", "medicine ball", "barbell", "ez barbell", "olympic barbell", "smith machine", "trap bar", "sled machine", "weighted", "rope"],
});

/* El perfil guarda el equipamiento como texto de un desplegable. Se traduce a
   nivel aquí para no repartir la comparación de cadenas por el código. */
export function nivelEquipamiento(texto) {
  const limpio = String(texto || "").toLowerCase();
  if (limpio.includes("gimnasio completo")) return "full";
  if (limpio.includes("casa") || limpio.includes("peso corporal")) return "casa";
  if (limpio.includes("básico") || limpio.includes("basico")) return "basico";
  /* Ante un valor desconocido se asume lo más restrictivo: proponer algo
     imposible es peor que proponer algo pobre. */
  return "casa";
}

export const PATRONES = Object.freeze({
  rodilla:     { musculos: ["quads", "glutes"], bodyPart: "upper legs", etiqueta: "dominante de rodilla" },
  rodilla_alt: { musculos: ["quads"], bodyPart: "upper legs", etiqueta: "dominante de rodilla alternativo" },
  cadera:      { musculos: ["hamstrings", "glutes"], bodyPart: "upper legs", etiqueta: "dominante de cadera" },
  gluteo:      { musculos: ["glutes"], bodyPart: "upper legs", etiqueta: "extensión de cadera" },
  isquios:     { musculos: ["hamstrings"], bodyPart: "upper legs", etiqueta: "flexión de rodilla" },
  unilateral:  { musculos: ["quads", "glutes"], bodyPart: "upper legs", etiqueta: "unilateral de pierna", unilateral: true },
  soleo:       { musculos: ["calves"], bodyPart: "lower legs", etiqueta: "sóleo (rodilla flexionada)" },
  gastro:      { musculos: ["calves"], bodyPart: "lower legs", etiqueta: "gastrocnemio (rodilla extendida)" },
  tibial:      { musculos: ["calves"], bodyPart: "lower legs", etiqueta: "tibial anterior" },
  emp_h:       { musculos: ["pectorals", "triceps"], bodyPart: "chest", etiqueta: "empuje horizontal" },
  emp_h2:      { musculos: ["pectorals"], bodyPart: "chest", etiqueta: "empuje horizontal inclinado" },
  emp_v:       { musculos: ["delts", "triceps"], bodyPart: "shoulders", etiqueta: "empuje vertical" },
  trac_h:      { musculos: ["upper back", "lats"], bodyPart: "back", etiqueta: "tracción horizontal" },
  trac_v:      { musculos: ["lats", "biceps"], bodyPart: "back", etiqueta: "tracción vertical" },
  delt_lat:    { musculos: ["delts"], bodyPart: "shoulders", etiqueta: "deltoides lateral" },
  biceps:      { musculos: ["biceps"], bodyPart: "upper arms", etiqueta: "flexión de codo" },
  triceps:     { musculos: ["triceps"], bodyPart: "upper arms", etiqueta: "extensión de codo" },
  core_ext:    { musculos: ["abs"], bodyPart: "waist", etiqueta: "core anti-extensión" },
  core_rot:    { musculos: ["abs"], bodyPart: "waist", etiqueta: "core antirrotación" },
  cadera_abd:  { musculos: ["abductors", "glutes"], bodyPart: "upper legs", etiqueta: "abducción de cadera" },
});

export const PATRONES_CONOCIDOS = Object.freeze(Object.keys(PATRONES));

/**
 * Traduce un patrón + el equipamiento del atleta a criterios de búsqueda.
 * @returns { musculos, equipamientos, bodyPart, etiqueta } o null si el patrón
 *          no existe: preferimos no buscar a buscar cualquier cosa.
 */
export function criteriosDe(patron, equipamiento) {
  const definicion = PATRONES[patron];
  if (!definicion) return null;
  const nivel = nivelEquipamiento(equipamiento);
  return {
    patron,
    etiqueta: definicion.etiqueta,
    musculos: [...definicion.musculos],
    equipamientos: [...EQUIPO_POR_NIVEL[nivel]],
    bodyPart: definicion.bodyPart,
    nivel,
  };
}

/* ---------- Filtrado y orden de candidatos ----------

   El proveedor devuelve lo que casa con la consulta; aquí se descarta lo que
   el atleta no puede hacer y se ordena por lo que mejor sirve al patrón.

   El filtro de equipamiento se aplica SIEMPRE en local aunque ya se haya
   enviado a la API: es la garantía de que no se cuela un ejercicio con prensa
   para alguien que entrena en casa, independientemente de lo que devuelva el
   proveedor. */
export function compatible(ejercicio, criterios) {
  if (!ejercicio) return false;

  const equipos = ejercicio.equipamientos?.length ? ejercicio.equipamientos : [ejercicio.equipamiento];
  const equipoOk = equipos.filter(Boolean).some((e) => criterios.equipamientos.includes(String(e).toLowerCase()));
  if (!equipoOk) return false;

  /* Además del equipamiento, el ejercicio tiene que tocar de verdad alguno de
     los músculos del patrón, como principal o como secundario. Sin esto un
     curl de bíceps entraba como candidato para "dominante de rodilla": mal
     puntuado, sí, pero presente — y bastaría con que el catálogo devolviese
     pocos resultados para que acabara propuesto como sustitución. */
  const target = String(ejercicio.target || "").toLowerCase();
  const secundarios = (ejercicio.secundarios || []).map((s) => String(s).toLowerCase());
  return criterios.musculos.some((m) => m === target || secundarios.includes(m));
}

/* Puntuación deliberadamente simple y explicable: acertar el músculo principal
   pesa más que rozarlo como secundario, y a igualdad se prefiere el material
   más básico, que es el que casi siempre está disponible. */
export function puntuar(ejercicio, criterios) {
  let score = 0;
  const target = String(ejercicio.target || "").toLowerCase();
  const secundarios = (ejercicio.secundarios || []).map((s) => String(s).toLowerCase());

  const iPrincipal = criterios.musculos.indexOf(target);
  if (iPrincipal === 0) score += 100;
  else if (iPrincipal > 0) score += 70 - iPrincipal * 10;

  for (const musculo of criterios.musculos) if (secundarios.includes(musculo)) score += 15;
  if (String(ejercicio.bodyPart || "").toLowerCase() === criterios.bodyPart) score += 20;

  /* Preferencia por equipamiento accesible: el índice en la lista del nivel va
     de lo más básico a lo más específico. */
  const equipo = String(ejercicio.equipamiento || "").toLowerCase();
  const iEquipo = criterios.equipamientos.indexOf(equipo);
  if (iEquipo >= 0) score += Math.max(0, 10 - iEquipo);

  if (ejercicio.instrucciones?.length) score += 5;
  if (ejercicio.media) score += 3;
  return score;
}

export function ordenarCandidatos(ejercicios, criterios, { limite = 5 } = {}) {
  return (ejercicios || [])
    .filter((e) => compatible(e, criterios))
    .map((e) => ({ ...e, score: puntuar(e, criterios) }))
    .sort((a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre, "es"))
    .slice(0, limite);
}
