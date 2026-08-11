import test from "node:test";
import assert from "node:assert/strict";
import { evidenceDTO, isValidChunkId } from "./evidence.js";

test("la ficha de evidencia no filtra la clave privada de R2", () => {
  const dto = evidenceDTO({
    id: "11111111-1111-4111-8111-111111111111",
    document_id: "22222222-2222-4222-8222-222222222222",
    texto: "Fragmento real", storage_key: "documents/secret/paper.pdf", origen: "pdf",
  });
  assert.equal(dto.texto, "Fragmento real");
  assert.equal(dto.hasPdf, true);
  assert.equal(Object.hasOwn(dto, "storageKey"), false);
  assert.equal(Object.hasOwn(dto, "storage_key"), false);
});

test("solo se aceptan ids UUID de fragmento", () => {
  assert.equal(isValidChunkId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isValidChunkId("../../documents/secret.pdf"), false);
  assert.equal(isValidChunkId("b5"), false);
});
