/* Tests DB-free de server/domain/coach/comparacion.js (10.5).

   El test existente `comparacion.test.js` cubre refsRelevantesLexico.
   Este añade cobertura al nuevo fichero comparacion.js: estructura de
   PREGUNTAS_COMPARACION, helpers de extracción de títulos, y el contrato
   de los resultados de compararSistemas, todo sin DB.
*/

import test from "node:test";
import assert from "node:assert/strict";
import {
  PREGUNTAS_COMPARACION,
  construirResultado,
  titulosDocumentos,
} from "./comparacion.js";

test("PREGUNTAS_COMPARACION cubre el dominio y tiene control negativo", () => {
  assert.ok(PREGUNTAS_COMPARACION.length >= 12, "al menos 12 preguntas de prueba");
  assert.ok(
    PREGUNTAS_COMPARACION.some((p) => /sin respuesta|no lo sé|no encuentro|ninguno|irades|protector solar/i.test(p)),
    "debe incluir al menos una pregunta sin respuesta posible en la biblioteca (control negativo)"
  );
  assert.ok(
    PREGUNTAS_COMPARACION.some((p) => /fuerza|muscul|proteina|serie|volume|interferencia|concurrente/i.test(p)),
    "debe cubrir el tema de fuerza/músculo"
  );
  assert.ok(
    PREGUNTAS_COMPARACION.some((p) => /taper|descarga|reduccion de volumen/i.test(p)),
    "debe cubrir el tema de taper/descarga"
  );
  assert.ok(
    PREGUNTAS_COMPARACION.some((p) => /lesión|dolor|sóleo|gemelo|rodilla|prevención/i.test(p)),
    "debe cubrir el tema de lesiones/recuperación"
  );
  assert.ok(
    PREGUNTAS_COMPARACION.some((p) => /horas|sueño|dormir|fatiga|recuperación/i.test(p)),
    "debe cubrir el tema de sueño/recuperación"
  );
  assert.ok(
    PREGUNTAS_COMPARACION.some((p) => /nutrición|proteína|carbohidrato|hidratación|ayunas/i.test(p)),
    "debe cubrir el tema de nutrición"
  );
});

test("construirResultado estructura la respuesta de comparación", () => {
  const pregunta = "¿cuánta proteína al día?";
  const docsNuevo = new Set(["doc-A", "doc-B"]);
  const docsAntiguo = new Set(["doc-A"]);

  const resultado = construirResultado(pregunta, docsNuevo, docsAntiguo, {
    hayEvidencia: true,
    fragmentos: 3,
    citasConPagina: 2,
    motivo: null,
    relleno: 0,
  });

  assert.equal(resultado.pregunta, pregunta);
  assert.equal(resultado.nuevo.hayEvidencia, true);
  assert.equal(resultado.nuevo.fragmentos, 3);
  assert.equal(resultado.nuevo.citasConPagina, 2);
  assert.equal(resultado.nuevo.documentos.length, 2);
  assert.equal(resultado.antiguo.documentos.length, 1);
  assert.equal(resultado.antiguo.relleno, 0);
  assert.equal(resultado.posibleRegresion, false, "no hay pérdida de documentos antiguos");
});

test("construirResultado marca posible regresión cuando el nuevo pierde docs del antiguo", () => {
  const docsNuevo = new Set(["doc-A"]);
  const docsAntiguo = new Set(["doc-A", "doc-B"]);

  const resultado = construirResultado("pregunta de prueba", docsNuevo, docsAntiguo, {
    hayEvidencia: true, fragmentos: 2, citasConPagina: 1,
    motivo: "sin componente vectorial: RAG_MIN_SCORE no se aplica",
    relleno: 0,
  });

  assert.equal(resultado.posibleRegresion, true, "el nuevo perdió doc-B del antiguo");
  assert.ok(resultado.regresion.map((d) => d.id).includes("doc-B"));
});

test("titulosDocumentos devuelve títulos o ids cuando no hay ficha", () => {
  const fichas = [{ id: "doc-1", titulo: "Taper y rendimiento" }, { id: "doc-2", titulo: null }];
  const ids = ["doc-1", "doc-2", "doc-3"];
  const titulos = titulosDocumentos(ids, fichas);
  assert.equal(titulos[0], "Taper y rendimiento");
  assert.ok(titulos[1].includes("doc-2") || titulos[1] === "doc-2", "documento sin título queda como id");
  assert.ok(titulos[2].includes("doc-3") || titulos[2] === "doc-3", "documento inexistente queda como id");
});

test("los resultados tienen los campos que el endpoint /api/coach/comparar consumiría", () => {
  const docsNuevo = new Set(["doc-x"]);
  const docsAntiguo = new Set([]);
  const resultado = construirResultado("consulta", docsNuevo, docsAntiguo, {
    hayEvidencia: false, fragmentos: 0, citasConPagina: 0,
    motivo: "no existe evidencia suficiente en la biblioteca cargada",
    relleno: 0,
  });

  /* Contrato de salida del endpoint (sin ejecutar la ruta, que necesita DB) */
  assert.equal(typeof resultado.pregunta, "string");
  assert.equal(typeof resultado.nuevo.hayEvidencia, "boolean");
  assert.equal(typeof resultado.nuevo.fragmentos, "number");
  assert.equal(typeof resultado.nuevo.documentos, "object");
  assert.equal(resultado.nuevo.documentos.length, 1);
  assert.equal(typeof resultado.nuevo.citasConPagina, "number");
  assert.ok(resultado.nuevo.motivo);
  assert.equal(typeof resultado.antiguo.documentos, "object");
  assert.equal(resultado.antiguo.relleno, 0);
  assert.equal(typeof resultado.posibleRegresion, "boolean");
});
