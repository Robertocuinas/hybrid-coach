/* Tests de las métricas de evaluación del retrieval — puras, sin DB ni LLM.
   Se ejecutan con `node --test eval/metrics.test.js`. */

import test from "node:test";
import assert from "node:assert/strict";
import { precision, recall, mrr, hitRateDocumento, agregarMetricasDeEvaluacion } from "./metrics.js";

const esperados = new Set(["doc-1", "doc-2", "doc-3"]);

test("precision@k cuenta coincidencias entre los k primeros", () => {
  // recuperados en orden de score: doc-1 relevante, doc-4 ruido, doc-2 relevante
  const recuperados = ["doc-1", "doc-4", "doc-2", "doc-5", "doc-3"];
  assert.equal(precision(3, recuperados, esperados), 2 / 3, "2 de 3 primeros son relevantes");
  assert.equal(precision(1, recuperados, esperados), 1, "el primero es relevante");
  assert.equal(precision(5, recuperados, esperados), 3 / 5, "3 de 5 son relevantes");
  assert.equal(precision(0, recuperados, esperados), 0, "k=0 no tiene resultados");
});

test("precision devuelve 0 con conjunto de esperados vacío", () => {
  assert.equal(precision(10, ["a"], new Set()), 0);
  assert.equal(precision(10, [], new Set(["a"])), 0);
});

test("recall@k cuenta cuántos esperados se recuperaron", () => {
  const recuperados = ["doc-1", "doc-4", "doc-2", "doc-5"];
  assert.equal(recall(3, recuperados, esperados), 2 / 3, "2 de 3 esperados aparecen en top-3");
  assert.equal(recall(4, recuperados, esperados), 2 / 3, "aún solo 2 de 3 (doc-3 fuera)");
  assert.equal(recall(10, recuperados, esperados), 2 / 3);
  assert.equal(recall(1, ["doc-1"], esperados), 1 / 3);
});

test("recall es 1 cuando se recuperan todos los esperados", () => {
  const recuperados = ["doc-1", "doc-2", "doc-3"];
  assert.equal(recall(3, recuperados, esperados), 1);
});

test("mrr devuelve 1/rank del primer esperado", () => {
  // doc-1 relevante en posición 1 → 1/1 = 1
  assert.equal(mrr(3, ["doc-1", "doc-4", "doc-2"], esperados), 1);
  // doc-2 relevante en posición 3 → 1/3
  assert.equal(mrr(3, ["doc-4", "doc-5", "doc-2"], esperados), 1 / 3);
  // ninguno relevante en top-3 → 0
  assert.equal(mrr(3, ["doc-4", "doc-5", "doc-6"], esperados), 0);
  // con k menor que la posición del primero relevante → 0
  assert.equal(mrr(1, ["doc-4", "doc-1"], esperados), 0);
});

test("hitRateDocumento es binario: al menos un documento esperado aparece", () => {
  assert.equal(hitRateDocumento(["doc-1", "doc-4"], esperados), 1);
  assert.equal(hitRateDocumento(["doc-4", "doc-5"], esperados), 0);
  assert.equal(hitRateDocumento(["doc-2"], esperados), 1);
  assert.equal(hitRateDocumento([], esperados), 0);
});

test("agregarMetricasDeEvaluacion promedia sobre un conjunto de preguntas", () => {
  const evaluadas = [
    { pregunta: "p1", recuperados: ["doc-1", "doc-4"], documentos_esperados: new Set(["doc-1", "doc-2"]) },
    { pregunta: "p2", recuperados: ["doc-2"], documentos_esperados: new Set(["doc-2", "doc-3"]) },
    { pregunta: "p3", recuperados: ["doc-4", "doc-5"], documentos_esperados: new Set(["doc-1"]) },
    {
      pregunta: "p4-sin-evidencia",
      recuperados: [],
      documentos_esperados: new Set(),
      debe_responder: false,
    },
  ];
  const m = agregarMetricasDeEvaluacion(evaluadas, 2);
  assert.equal(m.preguntas, 4);
  assert.equal(m.sinEvidencia, 0, "la pregunta debe_responder:false no cuenta como sin evidencia");
  assert.equal(m.conEvidencia, 3);
  // p1: precision@2 = 1/2, recall@2 = 1/2, mrr = 1 (doc-1 en pos 1), hitRateDoc = 1
  // p2: precision@2 = 1/1 = 1, recall@2 = 1/2, mrr = 1 (doc-2 en pos 1), hitRateDoc = 1
  // p3: precision@2 = 0/2 = 0, recall@2 = 0/1 = 0, mrr = 0, hitRateDoc = 0
  assert.equal(m.precision, (0.5 + 1 + 0) / 3);
  assert.equal(m.recall, (0.5 + 0.5 + 0) / 3);
  assert.equal(m.mrr, (1 + 1 + 0) / 3);
  assert.equal(m.hitRateDocumento, (1 + 1 + 0) / 3);
});

test("agregarMetricasDeEvaluacion con lista vacía devuelve ceros", () => {
  const m = agregarMetricasDeEvaluacion([]);
  assert.equal(m.precision, 0);
  assert.equal(m.recall, 0);
  assert.equal(m.mrr, 0);
  assert.equal(m.hitRateDocumento, 0);
  assert.equal(m.preguntas, 0);
  assert.equal(m.sinEvidencia, 0);
});
