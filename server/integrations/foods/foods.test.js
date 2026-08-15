import test from "node:test";
import assert from "node:assert/strict";
import { createFoodProvider, readFoodConfig, userAgentDe } from "./factory.js";
import {
  ATRIBUCION_OFF, gramosDeRacion, macrosPara, normalizarAlergenos,
  normalizarAlimento, tieneMacros, totalDiario,
} from "./types.js";

/* Producto real de Open Food Facts, con los nombres de campo tal cual los
   devuelve la API v2. */
const BRUTO = {
  code: "3017624010701",
  product_name: "Nutella",
  brands: "Ferrero, Nutella",
  quantity: "400 g",
  serving_size: "15 g",
  nutriments: {
    "energy_100g": 2227.9,          // kJ — la trampa
    "energy-kcal_100g": 539,        // kcal — con guion
    proteins_100g: 6.3,
    carbohydrates_100g: 57.5,
    fat_100g: 30.9,
    sugars_100g: 56.3,
    salt_100g: 0.1075,
  },
  allergens_tags: ["en:nuts", "en:milk"],
  ingredients_text: "Azúcar, aceite de palma, avellanas",
  image_url: "https://ejemplo/img.jpg",
};

/* La energía en kilocalorías viene en `energy-kcal_100g` CON GUION; leer
   `energy_100g` devuelve kilojulios y multiplica las calorías por 4,18. */
test("se lee la energía en kcal, no los kilojulios", () => {
  const a = normalizarAlimento(BRUTO);
  assert.equal(a.por100g.kcal, 539);
  assert.notEqual(a.por100g.kcal, 2227.9, "2227,9 son kJ, no kcal");
});

test("el producto se traduce a nuestro modelo sin dejar pasar el JSON externo", () => {
  const a = normalizarAlimento(BRUTO);
  assert.equal(a.externalId, "3017624010701");
  assert.equal(a.provider, "openfoodfacts");
  assert.equal(a.nombre, "Nutella");
  assert.equal(a.marca, "Ferrero", "solo la primera marca");
  assert.equal(a.racionGramos, 15);
  assert.equal(a.por100g.proteina, 6.3);
  assert.equal(a.por100g.fibra, null, "un nutriente ausente es null, no cero");
  for (const campo of ["nutriments", "allergens_tags", "product_name", "code"]) {
    assert.ok(!(campo in a), `${campo} no debe salir del adaptador`);
  }
});

test("un producto sin nombre o sin código no entra", () => {
  assert.equal(normalizarAlimento({ code: "1" }), null);
  assert.equal(normalizarAlimento({ product_name: "X" }), null);
  assert.equal(normalizarAlimento(null), null);
});

/* De los alérgenos depende una decisión de salud: se limpia el prefijo de
   idioma pero no se traduce ni se interpreta el término. */
test("los alérgenos pierden el prefijo de idioma y nada más", () => {
  assert.deepEqual(normalizarAlergenos(["en:nuts", "en:milk"]), ["nuts", "milk"]);
  assert.deepEqual(normalizarAlergenos(["es:gluten"]), ["gluten"]);
  assert.deepEqual(normalizarAlergenos(null), []);
  assert.deepEqual(normalizarAlergenos([]), []);
});

test("la ración se interpreta cuando se puede y se deja vacía cuando no", () => {
  assert.equal(gramosDeRacion("30 g"), 30);
  assert.equal(gramosDeRacion("15g"), 15);
  assert.equal(gramosDeRacion("1 vaso (250 ml)"), 250, "para líquidos se asume densidad 1");
  assert.equal(gramosDeRacion("2,5 g"), 2.5, "coma decimal");
  assert.equal(gramosDeRacion("una porción"), null, "mejor vacío que inventado");
  assert.equal(gramosDeRacion(""), null);
});

test("un alimento sin energía se marca en vez de contarse como cero", () => {
  assert.equal(tieneMacros(normalizarAlimento(BRUTO)), true);
  const sinMacros = normalizarAlimento({ ...BRUTO, nutriments: {} });
  assert.equal(tieneMacros(sinMacros), false);
});

/* ---------- Cálculo ---------- */

test("los macros de una cantidad se calculan en código, no se estiman", () => {
  const a = normalizarAlimento(BRUTO);
  const m = macrosPara(a, 30);
  assert.equal(m.gramos, 30);
  assert.equal(m.kcal, 161.7, "539 × 0,30");
  assert.equal(m.proteina, 1.9);
  assert.equal(m.fibra, null, "lo que no se sabe sigue sin saberse");
});

test("una cantidad inválida no produce un cálculo falso", () => {
  const a = normalizarAlimento(BRUTO);
  assert.equal(macrosPara(a, 0), null);
  assert.equal(macrosPara(a, -5), null);
  assert.equal(macrosPara(a, "mucho"), null);
  assert.equal(macrosPara(null, 30), null);
});

/* Un registro sin datos no puede contar como cero: el total parecería exacto
   cuando en realidad falta comida por sumar. */
test("el total del día informa de los registros incompletos", () => {
  const t = totalDiario([
    { kcal: 500, proteina: 30, carbohidrato: 60, grasa: 15, fibra: 5 },
    { kcal: 300, proteina: 20, carbohidrato: 40, grasa: 8, fibra: 3 },
    { kcal: null },
  ]);
  assert.equal(t.kcal, 800);
  assert.equal(t.proteina, 50);
  assert.equal(t.registros, 3);
  assert.equal(t.incompletos, 1);
});

test("un día sin registros da cero, no error", () => {
  const t = totalDiario([]);
  assert.equal(t.kcal, 0);
  assert.equal(t.registros, 0);
  assert.equal(t.incompletos, 0);
});

/* ---------- Configuración ---------- */

/* La licencia exige identificarse en cada llamada, así que la capability lleva
   la atribución: es imposible usar el proveedor sin tenerla a mano. */
test("el proveedor expone la atribución que exige la licencia", () => {
  const p = createFoodProvider({});
  assert.equal(p.capabilities().atribucion, ATRIBUCION_OFF);
  assert.match(ATRIBUCION_OFF.texto, /Open Food Facts/);
  assert.match(ATRIBUCION_OFF.texto, /ODbL|Open Database License/);
});

test("el User-Agent identifica la instancia, como pide la licencia", () => {
  assert.equal(userAgentDe({ APP_ORIGIN: "https://coach.ejemplo.com" }), "HybridCoach/2.0 (coach.ejemplo.com)");
  assert.match(userAgentDe({}), /^HybridCoach\/2\.0 \(/, "sin origen configurado sigue identificándose");
});

/* Viene activado por defecto porque no necesita clave: desactivarlo no
   protegería de nada. */
test("los alimentos funcionan sin configurar nada, y se pueden apagar", () => {
  assert.equal(readFoodConfig({}).enabled, true);
  assert.equal(readFoodConfig({ FOOD_PROVIDER: "ninguno" }).enabled, false);
  assert.equal(createFoodProvider({ FOOD_PROVIDER: "ninguno" }), null);
  assert.throws(() => readFoodConfig({ FOOD_PROVIDER: "inventado" }), /desconocido/);
});

/* ---------- Peticiones ---------- */

test("la búsqueda pide solo los campos que se usan y en el idioma configurado", async () => {
  let pedida = null;
  const provider = createFoodProvider({ FOOD_LANG: "es" }, {
    fetchImpl: async (url, opciones) => {
      pedida = { url, opciones };
      return { ok: true, json: async () => ({ products: [BRUTO] }) };
    },
  });

  const salida = await provider.buscar("nutella");
  assert.match(pedida.url, /search_terms=nutella/);
  assert.match(pedida.url, /fields=/, "no se pide el producto entero");
  assert.match(pedida.url, /lc=es/);
  assert.match(pedida.opciones.headers["user-agent"], /HybridCoach/);
  assert.equal(salida[0].nombre, "Nutella");
});

test("una búsqueda vacía no llega a llamar a la API", async () => {
  let llamada = false;
  const provider = createFoodProvider({}, { fetchImpl: async () => { llamada = true; return { ok: true, json: async () => ({}) }; } });
  assert.deepEqual(await provider.buscar("   "), []);
  assert.equal(llamada, false);
});

/* "No encontrado" llega con HTTP 200 y status 0: comprobar solo el código de
   estado daría por bueno un producto vacío. */
test("un código de barras inexistente devuelve null aunque la respuesta sea 200", async () => {
  const provider = createFoodProvider({}, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: 0, status_verbose: "product not found" }) }),
  });
  assert.equal(await provider.porCodigoBarras("0000000000000"), null);
});

test("el código de barras se limpia y sin dígitos no se consulta", async () => {
  let pedida = null;
  const provider = createFoodProvider({}, {
    fetchImpl: async (url) => { pedida = url; return { ok: true, json: async () => ({ status: 1, product: BRUTO }) }; },
  });

  const a = await provider.porCodigoBarras(" 3017-624 010701 ");
  assert.match(pedida, /product\/3017624010701\.json/);
  assert.equal(a.nombre, "Nutella");
  assert.equal(await provider.porCodigoBarras("abc"), null);
});

test("un límite de la API llega con mensaje legible", async () => {
  const provider = createFoodProvider({}, { fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) });
  await assert.rejects(() => provider.buscar("pollo"), /límite temporal/);
});
