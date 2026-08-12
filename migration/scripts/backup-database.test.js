import test from "node:test";
import assert from "node:assert/strict";
import { safeBackupName } from "./backup-database.js";

test("el backup solo acepta nombres locales .dump", () => {
  assert.equal(safeBackupName("staging-2026-08-12.dump"), "staging-2026-08-12.dump");
  assert.throws(() => safeBackupName("../secreto.dump"), /no puede contener rutas/);
  assert.throws(() => safeBackupName("backup.sql"), /terminar en .dump/);
});
