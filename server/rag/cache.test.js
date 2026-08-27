/* Tests DB-free de la caché de retrieval (Fase 12.3).

   Verifica que el cache:
   - devuelve null si no hay nada,
   - guarda y recupera por clave estable (consulta+filtros+índice),
   - expira por TTL,
   - no colisiona entre consultas distintas. */

import test from "node:test";
import assert from "node:assert/strict";
import { CacheRetrieval } from "./cache.js";

test("devuelve null cuando está vacío", () => {
  const c = new CacheRetrieval();
  assert.equal(c.obtener("hola", {}, { provider: "v", model: "m" }), null);
});

test("guarda y recupera por clave estable", () => {
  const c = new CacheRetrieval();
  const valor = { ok: true, chunks: [{ id: "n1" }] };
  c.poner("¿cuánto descanso?", { poblacion: "runner" }, { provider: "v", model: "m" }, valor);
  const leido = c.obtener("¿cuánto descanso?", { poblacion: "runner" }, { provider: "v", model: "m" });
  assert.deepEqual(leido, valor);
});

test("no colisiona entre consultas distintas", () => {
  const c = new CacheRetrieval();
  c.poner("A", {}, { provider: "v", model: "m" }, { tag: "A" });
  c.poner("B", {}, { provider: "v", model: "m" }, { tag: "B" });
  assert.equal(c.obtener("A", {}, { provider: "v", model: "m" }).tag, "A");
  assert.equal(c.obtener("B", {}, { provider: "v", model: "m" }).tag, "B");
});

test("la clave cambia si cambian los filtros o el índice", () => {
  const c = new CacheRetrieval();
  c.poner("X", { poblacion: "a" }, { provider: "v", model: "m" }, { tag: "f1" });
  // Misma consulta, distinto filtro → no debería encontrar nada.
  assert.equal(c.obtener("X", { poblacion: "b" }, { provider: "v", model: "m" }), null);
  // Misma consulta, distinto índice → no debería encontrar nada.
  assert.equal(c.obtener("X", { poblacion: "a" }, { provider: "otro", model: "m" }), null);
});

test("expira por TTL", async () => {
  const c = new CacheRetrieval({ ttlMs: 5 });
  c.poner("Y", {}, { provider: "v", model: "m" }, { tag: "viejo" });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(c.obtener("Y", {}, { provider: "v", model: "m" }), null);
});

test("limpiar vacía el cache", () => {
  const c = new CacheRetrieval();
  c.poner("Z", {}, { provider: "v", model: "m" }, { tag: "z" });
  c.limpiar();
  assert.equal(c.obtener("Z", {}, { provider: "v", model: "m" }), null);
});
