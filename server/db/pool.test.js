import test from "node:test";
import assert from "node:assert/strict";
import { resolveDatabaseSSL } from "./pool.js";

test("las conexiones públicas exigen TLS por defecto", () => {
  assert.deepEqual(resolveDatabaseSSL({ mode: "auto", local: false, railwayPrivate: false }), { rejectUnauthorized: false });
});

test("localhost y Railway privado no fuerzan TLS en auto", () => {
  assert.equal(resolveDatabaseSSL({ mode: "auto", local: true, railwayPrivate: false }), false);
  assert.equal(resolveDatabaseSSL({ mode: "auto", local: false, railwayPrivate: true }), false);
});

test("desactivar TLS requiere una elección explícita", () => {
  assert.equal(resolveDatabaseSSL({ mode: "disable", local: false, railwayPrivate: false }), false);
  assert.deepEqual(resolveDatabaseSSL({ mode: "require", local: true, railwayPrivate: false }), { rejectUnauthorized: false });
});
