/* ============================================================
   RECOMENDACIÓN DIARIA DE COMIDAS — generación fundamentada

   Reparto que no se mezcla (igual que en /api/foods):
     - El OBJETIVO del día (cuánto comer) lo calcula el motor determinista
       del cliente y lo publica en `nutrition_targets`. Aquí solo se lee.
     - Open Food Facts (FOOD_PROVIDER) aporta los DATOS REALES de cada
       alimento (macros por 100 g). Nunca se inventan esos datos: si el
       proveedor cae, la opción se queda sin macros y se declara la fuente.
     - La EVIDENCIA que justifica cada toma son las referencias de
       nutrición de la biblioteca (BIBLIO_SEED, ids n1-n18). Cada sugerencia
       lleva sus `citas` para que la UI las resuelva con RefChips.

   MAPA DE LO QUE HAY (15.1) — no se duplica nada que ya exista:
     nutrition_targets : objetivo diario del atleta (lo escribe el cliente
                         vía POST /api/nutrition/targets; lo lee /api/foods/dia).
     meal_catalog      : catálogo PROPIO del atleta (sus comidas editables),
                         por categoría (desayuno/comida/cena/snack).
     consumed_foods    : lo que el atleta dice haber comido (snapshot de macros
                         en el momento del registro). Se usa para el progreso.
     /api/foods/*      : búsqueda OFF, código de barras, registro de consumo y
                         conteo del día. Este módulo NO toca esas rutas: solo
                         recibe los datos ya resueltos y genera la recomendación.

   Por qué es determinista y no usa IA: la prescripción de comidas no necesita
   un modelo para repartir un objetivo conocido entre cuatro tomas citando la
   bibliografía. Mantenerlo en código (como el resto del módulo de nutrición
   del cliente) evita alucinar valores y respeta la regla de no mostrar salida
   de LLM sin validación: aquí no hay LLM. El "RAG" de la fase es la doble
   fundamentación —base de datos (objetivo + catálogo + consumido) y base de
   evidencia (referencias n*)—, y cada toma declara su fuente.
   ============================================================ */

export const MOMENTOS_COMIDA = ["desayuno", "comida", "cena", "snack"];
const ETIQUETA = { desayuno: "Desayuno", comida: "Comida", cena: "Cena", snack: "Snack" };

/* Solo estos contextos son válidos; cualquier otro se trata como día suave.
   Los valores coinciden con los de `contextoDelDia` del cliente. */
const CONTEXTO_VALIDOS = new Set(["descanso", "larga", "calidad", "fuerza", "suave"]);

/* Reparto porcentual de las kcal del día según el tipo de sesión.
   No son "valores fijos sin fuente": reflejan la recomendación de concentrar
   el carbohidrato en la comida los días de tirada larga o calidad [n2, n10] y
   repartir la proteína en torno a 4 tomas [n6, n7, n8]. El reparto es relativo
   al objetivo del atleta, que ya lleva suelo de seguridad. */
const DISTRIBUCION = {
  descanso: { desayuno: 0.25, comida: 0.35, cena: 0.30, snack: 0.10 },
  suave:    { desayuno: 0.25, comida: 0.35, cena: 0.30, snack: 0.10 },
  fuerza:   { desayuno: 0.25, comida: 0.35, cena: 0.30, snack: 0.10 },
  calidad:  { desayuno: 0.20, comida: 0.40, cena: 0.30, snack: 0.10 },
  larga:    { desayuno: 0.20, comida: 0.40, cena: 0.30, snack: 0.10 },
};

const red = (n) => (Number.isFinite(+n) ? Math.round(+n * 10) / 10 : 0);

/* Referencias que sostienen cada toma. Todos los ids existen en BIBLIO_SEED
   (bloque de nutrición n1-n18), así que la UI los resuelve sin riesgo de
   citar algo inexistente (regla 4 de CLAUDE.md: nunca se cita evidencia que
   no exista). */
function citasPara(momento, ctx) {
  if (momento === "desayuno") return ["n1", "n6", "n7", "n8"];
  if (momento === "comida") return (ctx === "larga" || ctx === "calidad") ? ["n1", "n2", "n10", "n3"] : ["n1", "n6", "n8"];
  if (momento === "cena") return ["n1", "n8", "n4"];
  if (momento === "snack") return (ctx === "larga" || ctx === "calidad") ? ["n1", "n3", "n16"] : ["n1", "n6", "n8"];
  return ["n1", "n8"];
}

/* Texto de la sugerencia. Determinista: depende del objetivo (si lo hay), del
   momento y del contexto. Nunca inventa cifras: si no hay objetivo, lo dice. */
function sugerenciaPara(momento, ctx, objetivo, pct) {
  const partes = [];
  if (objetivo) {
    partes.push(
      `Apuesta aquí unas ${red(objetivo.kcal * pct)} kcal ` +
      `(${red(objetivo.proteina * pct)} g de proteína, ${red(objetivo.carbohidrato * pct)} g de carbohidrato).`
    );
  } else {
    partes.push("Sin objetivo calculado para hoy: toma como referencia las cifras de tu pantalla de Nutrición en vez de estas pautas generales.");
  }

  if (momento === "desayuno") {
    partes.push("Incluye una fuente de proteína de unos 0,4 g/kg para arrancar la síntesis proteica del día [n6, n7].");
  } else if (momento === "comida") {
    partes.push(
      (ctx === "larga" || ctx === "calidad")
        ? "Es la comida clave los días con entreno duro: aquí concentra el carbohidrato que vas a gastar [n2, n10]."
        : "Equilibra el plato con proteína y carbohidrato; es la toma principal del día."
    );
  } else if (momento === "cena") {
    partes.push("Proteína y verduras; baja el carbohidrato si no entrenas después. La proteína antes de dormir suma un beneficio modesto [n8].");
  } else if (momento === "snack") {
    partes.push(
      (ctx === "larga" || ctx === "calidad")
        ? "Úsalo como toma de antes o después del entreno si la sesión queda lejos de las comidas [n3, n16]."
        : "Resérvalo para cubrir proteína si se te alejan las comidas; no lo uses para sumar calorías vacías."
    );
  }
  return partes.join(" ");
}

/* Convierte una opción del catálogo en una tarjeta de comida. Si el proveedor
   devolvió datos reales (alimentos[nombre]), se adjuntan; si no, la opción
   queda sin macros y la UI lo indica (no se inventa nada). */
function opcionDesde(nombre, alimento) {
  const tiene = alimento && alimento.por100g && alimento.por100g.kcal != null;
  return {
    nombre,
    externalId: alimento?.externalId || null,
    provider: alimento?.provider || "catalogo",
    marca: alimento?.marca || null,
    por100g: alimento?.por100g || null,
    encontrado: Boolean(alimento),
    // `por100g` viaja tal cual para que el registro de consumo lo use sin
    // volver a llamar a la API (igual que en /api/foods/consumo).
    macros: tiene ? alimento.por100g : null,
  };
}

/* ---- Función pública: genera la recomendación del día ----
   Entradas (todas ya resueltas por la ruta; esta función es pura y testeable
   sin base de datos ni red):
     objetivo : { kcal, proteina, carbohidrato, grasa, fibra, agua } | null
     catalogo : { desayuno:[], comida:[], cena:[], snack:[] }  (textos del atleta)
     alimentos: { [nombreOpcion]: alimentoNormalizadoOFF | null }  (enriquecimiento)
     contexto : "descanso" | "larga" | "calidad" | "fuerza" | "suave"
   Salida (contrato claro, 15.2):
     { evidenciaSuficiente, contexto, tomas:[ { momento, titulo, sugerencia,
       distribucion, opciones, citas } ] } */
export function generarRecomendacionDia({ objetivo = null, catalogo = {}, alimentos = {}, contexto = "suave" } = {}) {
  const ctx = CONTEXTO_VALIDOS.has(contexto) ? contexto : "suave";
  const dist = DISTRIBUCION[ctx];

  /* "Sin evidencia suficiente" = no tenemos el objetivo personalizado del
     atleta para repartir: avisamos en vez de dar cifras vacías. La base de
     evidencia (las referencias) sí está, pero falta el dato del atleta. */
  const evidenciaSuficiente = Boolean(objetivo);

  const cat = {
    desayuno: catalogo.desayuno || [],
    comida: catalogo.comida || [],
    cena: catalogo.cena || [],
    snack: catalogo.snack || [],
  };

  const tomas = MOMENTOS_COMIDA.map((momento) => {
    const pct = dist[momento];
    const distribucion = objetivo
      ? {
          kcal: red(objetivo.kcal * pct),
          proteina: red(objetivo.proteina * pct),
          carbohidrato: red(objetivo.carbohidrato * pct),
          grasa: red(objetivo.grasa * pct),
        }
      : null;

    const opciones = cat[momento].map((nombre) => opcionDesde(nombre, alimentos[nombre] || null));

    return {
      momento,
      titulo: ETIQUETA[momento],
      sugerencia: sugerenciaPara(momento, ctx, objetivo, pct),
      distribucion,
      opciones,
      citas: citasPara(momento, ctx),
    };
  });

  return { evidenciaSuficiente, contexto: ctx, tomas };
}
