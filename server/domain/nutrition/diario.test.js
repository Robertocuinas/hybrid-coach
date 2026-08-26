/* Tests del generador de recomendación diaria de comidas (Fase 15).
   No tocan la base de datos ni la red: `generarRecomendacionDia` es pura.
   Se ejecutan con `node --test` (DATABASE_URL="" es suficiente). */
import test from "node:test";
import assert from "node:assert/strict";
import { generarRecomendacionDia, MOMENTOS_COMIDA } from "./diario.js";

const OBJETIVO = { kcal: 2400, proteina: 160, carbohidrato: 300, grasa: 70, fibra: 30, agua: 3 };

test("15.2 devuelve las cuatro tomas con distribución y citas cuando hay objetivo", () => {
  const rec = generarRecomendacionDia({
    objetivo: OBJETIVO,
    catalogo: { desayuno: ["Yogur griego"], comida: ["Pollo"], cena: ["Salmón"], snack: ["Frutos secos"] },
    alimentos: {},
    contexto: "fuerza",
  });

  assert.equal(rec.contexto, "fuerza");
  assert.equal(rec.evidenciaSuficiente, true, "hay objetivo personalizado para repartir");
  assert.equal(rec.tomas.length, MOMENTOS_COMIDA.length);

  const comida = rec.tomas.find((t) => t.momento === "comida");
  // 2400 * 0.35 = 840 kcal de comida (distribución fuerza)
  assert.equal(comida.distribucion.kcal, 840);
  assert.ok(comida.citas.length > 0, "cada toma cita su base de evidencia");
  // Cada cita debe ser un id de la bibliografía de nutrición (n1-n18)
  for (const c of comida.citas) assert.match(c, /^n\d+$/);
});

test("15.2 sin objetivo declara evidencia insuficiente y no reparte cifras", () => {
  const rec = generarRecomendacionDia({ objetivo: null, catalogo: {}, alimentos: {}, contexto: "suave" });
  assert.equal(rec.evidenciaSuficiente, false, "falta el dato del atleta: no se inventan cifras");
  for (const t of rec.tomas) {
    assert.equal(t.distribucion, null);
    assert.ok(t.sugerencia.toLowerCase().includes("sin objetivo"));
  }
});

test("15.3 enriquece opciones con datos reales del proveedor cuando los hay", () => {
  const alim = {
    provider: "openfoodfacts", marca: "Marca X",
    por100g: { kcal: 100, proteina: 10, carbohidrato: 5, grasa: 3, fibra: 1 },
  };
  const rec = generarRecomendacionDia({
    objetivo: OBJETIVO,
    catalogo: { desayuno: ["Yogur griego"] },
    alimentos: { "Yogur griego": alim },
    contexto: "suave",
  });
  const op = rec.tomas[0].opciones[0];
  assert.equal(op.encontrado, true, "la opción quedó enlazada al alimento real");
  assert.deepEqual(op.macros, alim.por100g, "usa los macros reales por 100 g, no inventa");
  assert.equal(op.por100g.kcal, 100);
});

test("15.3 opción sin datos del proveedor queda sin macros y no inventa nada", () => {
  const rec = generarRecomendacionDia({
    objetivo: OBJETIVO,
    catalogo: { comida: ["Plato casero"] },
    alimentos: {},
    contexto: "suave",
  });
  const op = rec.tomas.find((t) => t.momento === "comida").opciones[0];
  assert.equal(op.encontrado, false, "no hay alimento real enlazado");
  assert.equal(op.macros, null, "no se inventan macros cuando el proveedor no responde");
  assert.equal(op.por100g, null);
});

test("15.2 contexto no reconocido se trata como suave sin romper", () => {
  const rec = generarRecomendacionDia({ objetivo: OBJETIVO, catalogo: {}, alimentos: {}, contexto: "raro" });
  assert.equal(rec.contexto, "suave");
  assert.equal(rec.tomas[0].distribucion.kcal, 600); // 2400 * 0.25 (suave)
});

test("15.4 días de tirada larga concentran el carbohidrato en comida y citan periodización", () => {
  const rec = generarRecomendacionDia({ objetivo: OBJETIVO, catalogo: {}, alimentos: {}, contexto: "larga" });
  const comida = rec.tomas.find((t) => t.momento === "comida");
  assert.equal(comida.distribucion.kcal, 960); // 2400 * 0.40
  assert.ok(comida.citas.includes("n10"), "cita periodización del carbohidrato (Impey 2018)");
  assert.ok(comida.citas.includes("n2"), "cita estrategia de carbohidrato (Burke 2011)");
});
