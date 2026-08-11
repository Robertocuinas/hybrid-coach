/* Diccionario ES→EN del dominio (docs/05-rag.md §6).

   El corpus es mayoritariamente inglés y las consultas siempre en español. El
   componente léxico (`tsv @@ ...`) es coincidencia de palabras: sin traducir,
   "entrenamiento concurrente" no encuentra jamás "concurrent training" y la
   mitad léxica del híbrido queda muerta.

   Determinista y gratis, frente a gastar una llamada al LLM por consulta. Se
   eligió la opción (a) de §6 a propósito: con ~50 términos del dominio se
   cubre lo que de verdad se pregunta aquí.

   Los términos se AÑADEN, nunca sustituyen: la consulta original en español
   sigue sirviendo al componente vectorial, que sí es cross-lingual. */
export const DICCIONARIO_ES_EN = Object.freeze({
  // --- Estructura del entrenamiento ---
  "entrenamiento concurrente": "concurrent training",
  "concurrente": "concurrent training",
  "interferencia": "interference effect",
  "tirada larga": "long run",
  "rodaje": "easy run",
  "series": "intervals",
  "intervalos": "intervals",
  "fartlek": "fartlek",
  "umbral": "lactate threshold",
  "ritmo objetivo": "race pace",
  "media maratón": "half marathon",
  "maratón": "marathon",
  "volumen": "training volume",
  "kilometraje": "weekly mileage",
  "intensidad": "training intensity",
  "polarizado": "polarized training",
  "periodización": "periodization",
  "descarga": "deload",
  "taper": "tapering",
  "puesta a punto": "tapering",
  "desentrenamiento": "detraining",
  "adherencia": "adherence",

  // --- Fuerza ---
  "fuerza": "strength training",
  "hipertrofia": "hypertrophy",
  "sentadilla": "squat",
  "peso muerto": "deadlift",
  "press banca": "bench press",
  "excéntrico": "eccentric",
  "pliometría": "plyometrics",
  "repeticiones en reserva": "repetitions in reserve RIR",
  "series efectivas": "effective sets",
  "carga": "training load",
  "progresión de carga": "load progression",
  "fuerza máxima": "maximal strength",
  "economía de carrera": "running economy",

  // --- Anatomía y lesiones ---
  "sóleo": "soleus",
  "gemelo": "gastrocnemius calf",
  "tendón de aquiles": "achilles tendon",
  "tendinopatía": "tendinopathy",
  "fascitis plantar": "plantar fasciitis",
  "periostitis": "medial tibial stress syndrome shin splints",
  "rodilla": "knee patellofemoral",
  "isquiotibiales": "hamstrings",
  "cadera": "hip",
  "lumbar": "low back",
  "fractura por estrés": "bone stress injury stress fracture",
  "sobreuso": "overuse injury",
  "dolor": "pain",
  "lesión": "injury",
  "prevención de lesiones": "injury prevention",

  // --- Fisiología y recuperación ---
  "consumo máximo de oxígeno": "VO2max",
  "frecuencia cardíaca": "heart rate",
  "variabilidad de la frecuencia cardíaca": "heart rate variability HRV",
  "sueño": "sleep",
  "recuperación": "recovery",
  "fatiga": "fatigue",
  "sobreentrenamiento": "overtraining",
  "agujetas": "delayed onset muscle soreness DOMS",
  "esfuerzo percibido": "rating of perceived exertion RPE",

  // --- Nutrición ---
  "proteína": "protein",
  "carbohidrato": "carbohydrate",
  "hidratos": "carbohydrate",
  "grasa": "fat",
  "creatina": "creatine",
  "cafeína": "caffeine",
  "hidratación": "hydration",
  "disponibilidad energética": "energy availability",
  "déficit calórico": "energy deficit",
  "composición corporal": "body composition",
  "masa muscular": "muscle mass",
});

/* Se ordena por longitud descendente para que "tendón de aquiles" gane a
   "aquiles" y "entrenamiento concurrente" a "concurrente": si se aplicara el
   término corto primero, el largo ya no encontraría su texto. */
const ENTRADAS_ORDENADAS = Object.entries(DICCIONARIO_ES_EN)
  .sort(([a], [b]) => b.length - a.length);

const sinAcentos = (texto) => String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Devuelve los términos ingleses que corresponden a lo que aparece en el texto.
 * No modifica la consulta: quien llama decide cómo combinarlos.
 */
export function terminosIngleses(texto) {
  let restante = sinAcentos(texto);
  const encontrados = new Set();
  for (const [es, en] of ENTRADAS_ORDENADAS) {
    const clave = sinAcentos(es);
    if (!restante.includes(clave)) continue;
    encontrados.add(en);
    /* Se consume el trozo reconocido para que un término más corto contenido
       en él no vuelva a disparar: "media maratón" ya está traducido, y dejar
       que "maratón" añada además "marathon" solo mete ruido. */
    restante = restante.split(clave).join(" ");
  }
  return [...encontrados];
}
