import test from "node:test";
import assert from "node:assert/strict";
import { refsRelevantesLexico, PREGUNTAS_COMPARACION } from "./comparacion.js";

const FICHAS = [
  {
    id: "doc-concurrente", titulo: "Entrenamiento concurrente: metaanálisis del efecto de interferencia",
    autores: "Wilson, J. M. y cols.", anio: 2012, fuente_revista: "J Strength Cond Res",
    tema_principal: "Concurrente", tags: ["concurrente", "interferencia"], evidence_grade: "fuerte",
    aplicacion_practica: "Separar modalidades y limitar volumen simultáneo.", resumen: null, poblacion: null,
  },
  {
    id: "doc-taper", titulo: "Efectos del taper sobre el rendimiento", autores: "Bosquet, L. y cols.",
    anio: 2007, fuente_revista: "Med Sci Sports Exerc", tema_principal: "Taper", tags: ["taper", "descarga"],
    evidence_grade: "fuerte", aplicacion_practica: "Reducir volumen 40-60% manteniendo intensidad.",
    resumen: null, poblacion: null,
  },
  {
    id: "doc-nutricion", titulo: "Proteína y ganancias de masa muscular", autores: "Morton, R. W. y cols.",
    anio: 2018, fuente_revista: "Br J Sports Med", tema_principal: "Nutrición", tags: ["proteina"],
    evidence_grade: "fuerte", aplicacion_practica: "1,6 g/kg cubre a la mayoría.", resumen: null, poblacion: null,
  },
];

test("el sistema léxico portado puntúa igual que el original: tema y tags pesan más", () => {
  const sobreTaper = refsRelevantesLexico(FICHAS, "cuánto bajar el volumen en el taper", { min: 1 });
  assert.equal(sobreTaper[0].id, "doc-taper");

  const sobreProteina = refsRelevantesLexico(FICHAS, "cuánta proteína al día", { min: 1 });
  assert.equal(sobreProteina[0].id, "doc-nutricion");
});

test("el sistema antiguo da falsos positivos por prefijo: 'protector' casa con 'proteína'", () => {
  /* No es un fallo del port, es cómo puntuaba el original: compara los cinco
     primeros caracteres, así que "protector solar" activa la ficha de
     proteína. Queda fijado aquí a propósito, porque es exactamente el tipo de
     ruido que el retrieval nuevo debe evitar y que la comparación mide. */
  const salida = refsRelevantesLexico(FICHAS, "protector solar para correr en agosto", { min: 3 });
  assert.equal(salida.length, 3);
  const reales = salida.filter((r) => !r._relleno);
  assert.equal(reales.length, 1);
  assert.equal(reales[0].id, "doc-nutricion", "coincidencia espuria por el prefijo 'prote'");
});

test("sin ninguna coincidencia, ni siquiera espuria, todo lo devuelto va como relleno", () => {
  const salida = refsRelevantesLexico(FICHAS, "bicicleta estática montaña", { min: 3 });
  assert.ok(salida.every((r) => r._relleno), "el sistema antiguo siempre devolvía algo, marcado como relleno");
});

test("una consulta vacía devuelve las de mayor grado de evidencia", () => {
  const salida = refsRelevantesLexico(FICHAS, "", { min: 2 });
  assert.equal(salida.length, 2);
  assert.ok(salida.every((r) => r.evidence_grade === "fuerte"));
});

test("el banco de preguntas cubre el dominio e incluye un control negativo", () => {
  assert.ok(PREGUNTAS_COMPARACION.length >= 10, "la ficha pide 10-15 preguntas de prueba");
  assert.ok(PREGUNTAS_COMPARACION.some((p) => /protector solar/i.test(p)),
    "debe haber una pregunta sin respuesta posible en la biblioteca, como control");
  assert.ok(PREGUNTAS_COMPARACION.some((p) => /interval|series|fuerza/i.test(p)));
  assert.ok(PREGUNTAS_COMPARACION.some((p) => /taper/i.test(p)));
});
