import test from "node:test";
import assert from "node:assert/strict";
import { trocear, contarTokens, agruparPorSeccion, OBJETIVO_MAX_TOKENS } from "./chunker.js";

const parrafo = (texto, pagina, seccion) => ({ texto, pagina, seccion });
const relleno = (n, i) => `Frase ${i} sobre el efecto de interferencia en corredores entrenados. `.repeat(n).trim();

test("un chunk nunca mezcla dos secciones", () => {
  const chunks = trocear([
    parrafo("Corto en métodos.", 2, "methods"),
    parrafo("Corto en resultados.", 3, "results"),
  ]);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map((c) => c.seccion), ["methods", "results"]);
  assert.ok(!chunks[0].texto.includes("resultados"));
});

test("los chunks respetan el objetivo de 400-600 tokens en una sección larga", () => {
  const parrafos = Array.from({ length: 12 }, (_, i) => parrafo(relleno(8, i), 1 + Math.floor(i / 4), "results"));
  const chunks = trocear(parrafos);

  assert.ok(chunks.length >= 3, "una sección larga debe generar varios chunks");
  for (const chunk of chunks.slice(0, -1)) {
    assert.ok(chunk.num_tokens >= 400, `chunk ${chunk.chunk_index} demasiado corto: ${chunk.num_tokens}`);
    assert.ok(chunk.num_tokens <= 700, `chunk ${chunk.chunk_index} demasiado largo: ${chunk.num_tokens}`);
  }
});

test("hay solape real entre chunks consecutivos de la misma sección", () => {
  const parrafos = Array.from({ length: 12 }, (_, i) => parrafo(relleno(8, i), 1, "results"));
  const chunks = trocear(parrafos);
  const colaDelPrimero = chunks[0].texto.trim().slice(-40);
  assert.ok(chunks[1].texto.includes(colaDelPrimero), "el segundo chunk debe arrastrar el final del primero");
});

test("las páginas de origen se conservan y son coherentes", () => {
  const chunks = trocear([
    parrafo(relleno(8, 1), 4, "discussion"),
    parrafo(relleno(8, 2), 5, "discussion"),
    parrafo(relleno(8, 3), 6, "discussion"),
  ]);
  for (const chunk of chunks) {
    assert.ok(Number.isInteger(chunk.pagina_inicio) && Number.isInteger(chunk.pagina_fin));
    assert.ok(chunk.pagina_inicio <= chunk.pagina_fin);
  }
  assert.equal(chunks[0].pagina_inicio, 4);
  assert.equal(chunks[chunks.length - 1].pagina_fin, 6);
});

test("un párrafo más largo que el máximo se parte por frases", () => {
  const gigante = parrafo(relleno(150, 9), 1, "methods");
  assert.ok(contarTokens(gigante.texto) > OBJETIVO_MAX_TOKENS * 2);
  const chunks = trocear([gigante]);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.num_tokens <= 700, `chunk sin partir: ${chunk.num_tokens}`);
  assert.ok(chunks.every((c) => c.seccion === "methods"));
});

test("chunk_index es correlativo en todo el documento", () => {
  const chunks = trocear([
    parrafo(relleno(8, 1), 1, "abstract"),
    parrafo(relleno(8, 2), 2, "methods"),
    parrafo(relleno(8, 3), 3, "results"),
  ]);
  assert.deepEqual(chunks.map((c) => c.chunk_index), chunks.map((_, i) => i));
});

test("agruparPorSeccion respeta tramos consecutivos, no nombres repetidos", () => {
  const grupos = agruparPorSeccion([
    parrafo("a", 1, "methods"), parrafo("b", 1, "methods"),
    parrafo("c", 2, "results"), parrafo("d", 3, "methods"),
  ]);
  assert.deepEqual(grupos.map((g) => g.seccion), ["methods", "results", "methods"]);
  assert.equal(grupos[0].parrafos.length, 2);
});
