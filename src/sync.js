const QUEUE_KEY = "hybridcoach:sync:v1";
const DAILY_KEY = "hybridcoach:reconciliation:v1";

const numeric = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export function calculateLocalTotals(state) {
  const profile = state?.perfiles?.[state?.activo];
  if (!profile) return null;
  return {
    runningCount: (profile.running || []).length,
    km: (profile.running || []).reduce((sum, row) => sum + numeric(row.distancia_km), 0),
    strengthSets: (profile.strength || []).length,
    kg: (profile.strength || []).reduce((sum, row) => sum + numeric(row.weight ?? row.peso_kg) * numeric(row.reps), 0),
    checkins: (profile.checkins || []).length,
  };
}

function emptyQueue() {
  return { version: 1, items: [], lastFlushAt: null, pausedReason: null };
}

function parseQueue(storage) {
  try {
    const value = JSON.parse(storage.getItem(QUEUE_KEY) || "null");
    return value?.version === 1 && Array.isArray(value.items) ? value : emptyQueue();
  } catch { return emptyQueue(); }
}

const operationId = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function createSyncController({ storage, fetchImpl = fetch, now = () => Date.now() }) {
  let flushing = false;
  const save = (queue) => storage.setItem(QUEUE_KEY, JSON.stringify(queue));

  function enqueue(state) {
    const profile = state?.perfiles?.[state?.activo];
    const totals = calculateLocalTotals(state);
    if (!profile || !totals) return null;
    const queue = parseQueue(storage);
    const item = {
      operationId: operationId(),
      profileLocalId: String(profile.id || state.activo),
      kind: "profile.snapshot",
      snapshot: { profileLocalId: String(profile.id || state.activo), profile, totals, capturedAt: new Date(now()).toISOString() },
      createdAt: new Date(now()).toISOString(),
      attempts: 0,
      nextAttemptAt: now(),
      lastErrorCode: null,
    };
    // Un snapshot completo más nuevo sustituye cualquier snapshot pendiente del mismo perfil.
    queue.items = queue.items.filter((entry) => entry.profileLocalId !== item.profileLocalId);
    queue.items.push(item);
    queue.pausedReason = null;
    save(queue);
    return item.operationId;
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      const pendingAtStart = [...parseQueue(storage).items];
      for (const original of pendingAtStart) {
        const currentQueue = parseQueue(storage);
        const item = currentQueue.items.find((entry) => entry.operationId === original.operationId);
        if (!item) continue; // Un snapshot más reciente ya lo ha sustituido.
        if (item.nextAttemptAt > now()) continue;
        try {
          const response = await fetchImpl("/api/sync", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "Idempotency-Key": item.operationId },
            body: JSON.stringify({ operationId: item.operationId, snapshot: item.snapshot }),
          });
          if (response.ok) {
            const latest = parseQueue(storage);
            latest.items = latest.items.filter((entry) => entry.operationId !== item.operationId);
            latest.pausedReason = null;
            save(latest);
            continue;
          }
          if (response.status === 401) {
            const latest = parseQueue(storage);
            latest.pausedReason = "authentication";
            save(latest);
            break;
          }
          if (![408, 425, 429].includes(response.status) && response.status < 500) {
            const latest = parseQueue(storage);
            const live = latest.items.find((entry) => entry.operationId === item.operationId);
            if (live) {
              live.lastErrorCode = `HTTP_${response.status}`;
              live.nextAttemptAt = now() + 6 * 60 * 60 * 1000;
            }
            latest.pausedReason = "blocked";
            save(latest);
            continue;
          }
          throw Object.assign(new Error("retryable response"), { code: `HTTP_${response.status}` });
        } catch (error) {
          const latest = parseQueue(storage);
          const live = latest.items.find((entry) => entry.operationId === item.operationId);
          if (live) {
            live.attempts += 1;
            live.lastErrorCode = error.code || "NETWORK_ERROR";
            const base = Math.min(6 * 60 * 60 * 1000, 5000 * (2 ** Math.min(live.attempts - 1, 12)));
            live.nextAttemptAt = now() + Math.round(base * (1 + Math.random() * 0.25));
            save(latest);
          }
        }
      }
      const latest = parseQueue(storage);
      latest.lastFlushAt = new Date(now()).toISOString();
      save(latest);
    } finally { flushing = false; }
  }

  async function reportDaily(state) {
    const totals = calculateLocalTotals(state);
    const profile = state?.perfiles?.[state?.activo];
    if (!totals || !profile) return;
    const today = new Date(now()).toISOString().slice(0, 10);
    if (storage.getItem(DAILY_KEY) === `${profile.id}:${today}`) return;
    const response = await fetchImpl("/api/reconciliation-snapshot", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileLocalId: String(profile.id), totals, capturedAt: new Date(now()).toISOString() }),
    });
    if (response.ok) storage.setItem(DAILY_KEY, `${profile.id}:${today}`);
  }

  return { enqueue, flush, reportDaily, readQueue: () => parseQueue(storage) };
}
