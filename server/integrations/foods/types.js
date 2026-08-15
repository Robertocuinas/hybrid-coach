/* ============================================================
   CONTRATO DE PROVEEDORES DE ALIMENTOS

   Open Food Facts aporta DATOS DE ALIMENTOS. No decide cuántas calorías debe
   comer nadie: eso lo sigue calculando el motor determinista con el suelo de
   seguridad energética, y esa frontera no se toca.

   Todo lo que sale de aquí está normalizado a nuestro modelo. El JSON del
   proveedor no cruza esta capa.
   ============================================================ */

/* Texto de atribución que exige la licencia ODbL. Va aquí, junto al
   adaptador, para que sea imposible mostrar los datos sin él: cualquier
   pantalla que enseñe un alimento importa esta constante. */
export const ATRIBUCION_OFF = Object.freeze({
  texto: "Datos de alimentos: Open Food Facts, bajo licencia Open Database License (ODbL).",
  enlace: "https://world.openfoodfacts.org",
  licencia: "https://opendatacommons.org/licenses/odbl/1-0/",
});

export class FoodProvider {
  async buscar(_texto, _opciones) { throw new Error("FoodProvider.buscar() no implementado"); }
  async porCodigoBarras(_codigo) { throw new Error("FoodProvider.porCodigoBarras() no implementado"); }
  capabilities() { throw new Error("FoodProvider.capabilities() no implementado"); }
}

export function assertFoodProvider(provider) {
  if (!provider || typeof provider.buscar !== "function" || typeof provider.porCodigoBarras !== "function"
      || typeof provider.capabilities !== "function") {
    throw new TypeError("El adaptador no cumple FoodProvider { buscar(), porCodigoBarras(), capabilities() }");
  }
  const capabilities = provider.capabilities();
  for (const key of ["provider", "codigoBarras", "atribucion"]) {
    if (!(key in capabilities)) throw new TypeError(`Falta capability de alimentos: ${key}`);
  }
  return provider;
}

/* ---------- Normalización ----------

   Trampa del formato: la energía en kilocalorías viene en `energy-kcal_100g`,
   CON GUION, mientras que el resto de macros usa guion bajo. Leer `energy_100g`
   por descuido devuelve kilojulios y multiplica las calorías por 4,18. */
const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/* Los alérgenos vienen etiquetados por idioma: ["en:nuts", "en:milk"]. Se
   quita el prefijo, pero se conserva el término original del proveedor: no se
   traduce ni se interpreta, porque de eso depende una decisión de salud. */
export function normalizarAlergenos(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => String(t).split(":").pop().trim())
    .filter(Boolean);
}

/* La ración viene como texto libre ("30 g", "1 tasse (250 ml)"). Se intenta
   sacar los gramos y, si no se puede, se deja a null: inventar una ración es
   peor que pedirle al usuario que ponga la cantidad. */
export function gramosDeRacion(texto) {
  const limpio = String(texto || "").toLowerCase().replace(",", ".");
  const g = limpio.match(/([\d.]+)\s*g\b/);
  if (g) return numero(g[1]);
  const ml = limpio.match(/([\d.]+)\s*ml\b/);
  /* Para líquidos se asume densidad 1: es exacto para agua y una aproximación
     razonable para leche o zumo. Se marca como estimado en quien lo use. */
  if (ml) return numero(ml[1]);
  return null;
}

export function normalizarAlimento(bruto, { provider = "openfoodfacts" } = {}) {
  const nombre = String(bruto?.product_name || "").trim();
  const codigo = String(bruto?.code || "").trim();
  if (!nombre || !codigo) return null;

  const n = bruto.nutriments || {};
  return {
    externalId: codigo,
    provider,
    codigoBarras: codigo,
    nombre,
    marca: String(bruto.brands || "").split(",")[0].trim() || null,
    cantidad: String(bruto.quantity || bruto.product_quantity || "").trim() || null,
    racionTexto: String(bruto.serving_size || "").trim() || null,
    racionGramos: gramosDeRacion(bruto.serving_size),
    /* Todo por 100 g, que es como lo publica el proveedor. La conversión a la
       cantidad consumida se hace en código, no aquí. */
    por100g: {
      kcal: numero(n["energy-kcal_100g"]),
      proteina: numero(n.proteins_100g),
      carbohidrato: numero(n.carbohydrates_100g),
      grasa: numero(n.fat_100g),
      fibra: numero(n.fiber_100g),
      azucares: numero(n.sugars_100g),
      sal: numero(n.salt_100g),
    },
    alergenos: normalizarAlergenos(bruto.allergens_tags),
    ingredientes: String(bruto.ingredients_text || "").trim() || null,
    imagen: bruto.image_url || null,
  };
}

/* Un alimento sin energía por 100 g no sirve para contar: entra en la lista
   pero marcado, para que la interfaz pueda avisar en vez de sumar ceros. */
export const tieneMacros = (alimento) => alimento?.por100g?.kcal !== null && alimento?.por100g?.kcal !== undefined;

/* ---------- Cálculo ----------
   En código, nunca en el modelo (§47 del encargo). */
export function macrosPara(alimento, gramos) {
  const g = Number(gramos);
  if (!alimento?.por100g || !Number.isFinite(g) || g <= 0) return null;
  const factor = g / 100;
  const escala = (v) => (v === null || v === undefined ? null : Math.round(v * factor * 10) / 10);
  return {
    gramos: g,
    kcal: escala(alimento.por100g.kcal),
    proteina: escala(alimento.por100g.proteina),
    carbohidrato: escala(alimento.por100g.carbohidrato),
    grasa: escala(alimento.por100g.grasa),
    fibra: escala(alimento.por100g.fibra),
  };
}

/* Suma de un día. Los nulos NO cuentan como cero: se informa de cuántos
   registros no tenían el dato para no presentar un total incompleto como
   exacto. */
export function totalDiario(registros = []) {
  const total = { kcal: 0, proteina: 0, carbohidrato: 0, grasa: 0, fibra: 0 };
  let incompletos = 0;
  for (const r of registros) {
    if (r?.kcal === null || r?.kcal === undefined) { incompletos += 1; continue; }
    for (const clave of Object.keys(total)) total[clave] += Number(r[clave]) || 0;
  }
  for (const clave of Object.keys(total)) total[clave] = Math.round(total[clave] * 10) / 10;
  return { ...total, registros: registros.length, incompletos };
}
