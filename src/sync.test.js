import test from "node:test";
import assert from "node:assert/strict";
import { calculateLocalTotals, createSyncController } from "./sync.js";

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
}

const state = {
  activo: "p1",
  perfiles: { p1: { id: "p1", perfil: { nombre: "Test" }, running: [{ distancia_km: 8.5 }],
    strength: [{ weight: 50, reps: 5 }, { weight: 40, reps: 8 }], checkins: [{ date: "2026-08-10" }] } },
};

test("calcula los totales locales usados por conciliación", () => {
  assert.deepEqual(calculateLocalTotals(state), { runningCount: 1, km: 8.5, strengthSets: 2, kg: 570, checkins: 1 });
});

test("conserva una operación fallida y la reintenta silenciosamente", async () => {
  const storage = new MemoryStorage();
  let currentTime = Date.parse("2026-08-11T12:00:00Z");
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error("network unavailable");
    return { ok: true, status: 200 };
  };
  const sync = createSyncController({ storage, fetchImpl, now: () => currentTime });
  sync.enqueue(state);
  await sync.flush();
  assert.equal(sync.readQueue().items.length, 1);
  assert.equal(sync.readQueue().items[0].attempts, 1);

  currentTime += 7 * 60 * 60 * 1000;
  await sync.flush();
  assert.equal(calls, 2);
  assert.equal(sync.readQueue().items.length, 0);
});

test("un fetch antiguo no pisa un snapshot nuevo", async () => {
  const storage = new MemoryStorage();
  let finishRequest;
  const fetchImpl = () => new Promise((resolve) => { finishRequest = resolve; });
  const sync = createSyncController({ storage, fetchImpl });
  sync.enqueue(state);
  const flushing = sync.flush();
  await new Promise((resolve) => setImmediate(resolve));
  const newer = structuredClone(state);
  newer.perfiles.p1.running[0].distancia_km = 9;
  sync.enqueue(newer);
  finishRequest({ ok: true, status: 200 });
  await flushing;
  assert.equal(sync.readQueue().items.length, 1);
  assert.equal(sync.readQueue().items[0].snapshot.totals.km, 9);
});
