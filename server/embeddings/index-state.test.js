import test from "node:test";
import assert from "node:assert/strict";
import { validateEmbeddingStartup } from "./index-state.js";

test("el arranque falla claramente si EMBEDDING_MODEL no coincide", async () => {
  const db = { async query() { return { rows: [{
    provider: "voyage", model: "voyage-3", dimensions: 1024, status: "active",
    indexed_chunks: 20, total_chunks: 20, active: true,
  }] }; } };
  await assert.rejects(
    () => validateEmbeddingStartup({ enabled: true, provider: "voyage", model: "voyage-4", dimensions: 1024 }, db),
    /Mismatch: EMBEDDING_MODEL=voyage-4.*stored_embeddings\.model=voyage-3/
  );
});
