import test from "node:test";
import assert from "node:assert/strict";
import { documentoDesdeAPI, documentoParaAPI } from "./documentAdapter.js";

test("adapta el documento SQL al contrato heredado del frontend", () => {
  const ref = documentoDesdeAPI({
    id: "uuid-1", legacy_id: "b3", titulo: "Título", autores: "Autora", anio: 2024,
    fuente_revista: "Revista", tema_principal: "Lesiones", evidence_grade: "debil",
    aplicacion_practica: "Aplicación", resumen: "Resumen", study_type: "meta_analysis",
    population_type: null, tags: ["lesiones"], revisado: true,
  });
  assert.equal(ref.id, "b3");
  assert.equal(ref._dbId, "uuid-1");
  assert.equal(ref.grado, "débil");
  assert.equal(ref.resumenIA, "Resumen");
  assert.equal(ref.studyType, "meta_analysis");
});

test("adapta una edición del frontend al contrato de escritura API", () => {
  const body = documentoParaAPI({ titulo: "Título", anio: 2024, fuente: "Revista", tema: "Fuerza",
    grado: "práctica", aplicacion: "Aplicación", resumenIA: "Resumen", doi: "", tags: [] });
  assert.equal(body.evidenceGrade, "practica");
  assert.equal(body.fuenteRevista, "Revista");
  assert.equal(body.temaPrincipal, "Fuerza");
  assert.equal(body.doi, null);
  assert.equal(body.revisado, false, "una ficha manual sin chunks no puede activarse como evidencia");
});

test("solo una ficha PDF persistida puede pedir confirmación humana", () => {
  assert.equal(documentoParaAPI({ _dbId: "doc-1", origen: "pdf", titulo: "Paper" }).revisado, true);
  assert.equal(documentoParaAPI({ origen: "pdf", titulo: "Importación local" }).revisado, false);
});
