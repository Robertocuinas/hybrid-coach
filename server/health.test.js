import test from "node:test";
import assert from "node:assert/strict";
import { isReady } from "./health.js";

test("readiness exige PostgreSQL y pgvector cuando está habilitado", () => {
  assert.equal(isReady({ db: true, pgvector: true }, { PGVECTOR_ENABLED: "true" }), true);
  assert.equal(isReady({ db: false, pgvector: false }, { PGVECTOR_ENABLED: "true" }), false);
  assert.equal(isReady({ db: true, pgvector: false }, { PGVECTOR_ENABLED: "true" }), false);
});

test("readiness permite PostgreSQL sin vector si se desactiva expresamente", () => {
  assert.equal(isReady({ db: true, pgvector: false }, { PGVECTOR_ENABLED: "false" }), true);
});
