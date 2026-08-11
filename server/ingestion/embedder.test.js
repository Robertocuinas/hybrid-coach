import test from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../ai/providers/types.js";
import { procesarChunksPorLotes, vectorizarChunksPorLotes } from "./embedder.js";

const makeVector = (value) => Array(1024).fill(value);
const chunks = Array.from({ length: 23 }, (_, index) => ({ id: `chunk-${index}`, texto: `texto ${index}` }));

test("vectoriza en lotes de 10 y escribe provider/model/dimensions", async () => {
  const batches = [];
  const provider = {
    provider: "local-test", model: "bge-m3", dimensions: () => 1024,
    async embed(texts, { inputType }) {
      batches.push({ size: texts.length, inputType });
      return { vectors: texts.map((_, index) => makeVector(index)), dimensions: 1024, usage: { tokens: texts.length } };
    },
  };
  let write;
  const db = { async query(sql, params) { write = { sql, params }; return { rowCount: 23 }; } };
  const result = await procesarChunksPorLotes(chunks, { db, provider, batchSize: 10, maxRetries: 0 });
  assert.deepEqual(batches, [{ size: 10, inputType: "document" }, { size: 10, inputType: "document" }, { size: 3, inputType: "document" }]);
  assert.equal(result.written, 23);
  assert.match(write.sql, /ON CONFLICT/);
  assert.equal(write.params[1], "local-test");
  assert.equal(write.params[2], "bge-m3");
  assert.equal(write.params[3], 1024);
});

test("reintenta 429 antes de completar el lote", async () => {
  let calls = 0;
  let sleeps = 0;
  const provider = {
    provider: "voyage", model: "voyage-4", dimensions: () => 1024,
    async embed(texts) {
      calls += 1;
      if (calls === 1) throw new ProviderError("voyage", 429, "rate limit");
      return { vectors: texts.map(() => makeVector(1)), dimensions: 1024, usage: { tokens: 1 } };
    },
  };
  const result = await vectorizarChunksPorLotes(chunks.slice(0, 1), { provider, maxRetries: 1, sleep: async () => { sleeps += 1; } });
  assert.equal(result.items.length, 1);
  assert.equal(calls, 2);
  assert.equal(sleeps, 1);
});
