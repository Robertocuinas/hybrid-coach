import { fileURLToPath } from "node:url";
import pool from "../db/pool.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOLERANCE = 0.001;

const numeric = (value) => Number(value || 0);

export function compareTotals(local, database) {
  const differences = {};
  for (const key of ["runningCount", "strengthSets", "checkins"]) {
    if (numeric(local[key]) !== numeric(database[key])) differences[key] = { local: numeric(local[key]), database: numeric(database[key]) };
  }
  for (const key of ["km", "kg"]) {
    if (Math.abs(numeric(local[key]) - numeric(database[key])) > TOLERANCE) {
      differences[key] = { local: numeric(local[key]), database: numeric(database[key]) };
    }
  }
  return differences;
}

async function sendAlert(run) {
  if (!process.env.RECONCILIATION_WEBHOOK_URL || run.status === "green") return;
  try {
    await fetch(process.env.RECONCILIATION_WEBHOOK_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "hybridcoach.reconciliation", status: run.status,
        athleteProfileId: run.profileId, differenceKeys: Object.keys(run.differences), checkedAt: run.checkedAt }),
    });
  } catch (error) { console.warn("Reconciliation webhook failed:", error.name); }
}

export async function runReconciliation(queryable = pool, clock = () => new Date()) {
  const snapshots = await queryable.query(`SELECT athlete_profile_id,local_totals,captured_at
    FROM client_state_snapshots ORDER BY athlete_profile_id`);
  const results = [];
  for (const snapshot of snapshots.rows) {
    const actualResult = await queryable.query(`SELECT
      (SELECT count(*)::int FROM running_sessions rs JOIN completed_sessions cs ON cs.id=rs.completed_session_id WHERE cs.athlete_profile_id=$1) AS "runningCount",
      (SELECT coalesce(sum(rs.distancia_km),0)::float8 FROM running_sessions rs JOIN completed_sessions cs ON cs.id=rs.completed_session_id WHERE cs.athlete_profile_id=$1) AS km,
      (SELECT count(*)::int FROM strength_sets ss JOIN strength_sessions s ON s.id=ss.strength_session_id JOIN completed_sessions cs ON cs.id=s.completed_session_id WHERE cs.athlete_profile_id=$1) AS "strengthSets",
      (SELECT coalesce(sum(ss.peso_kg*ss.reps),0)::float8 FROM strength_sets ss JOIN strength_sessions s ON s.id=ss.strength_session_id JOIN completed_sessions cs ON cs.id=s.completed_session_id WHERE cs.athlete_profile_id=$1) AS kg,
      (SELECT count(*)::int FROM feedback_logs WHERE athlete_profile_id=$1) AS checkins`, [snapshot.athlete_profile_id]);
    const local = snapshot.local_totals;
    const database = actualResult.rows[0];
    const differences = compareTotals(local, database);
    const checkedAt = clock();
    const stale = checkedAt.getTime() - new Date(snapshot.captured_at).getTime() > 36 * 60 * 60 * 1000;
    const status = stale ? "stale" : Object.keys(differences).length ? "red" : "green";
    await queryable.query(`INSERT INTO reconciliation_runs
      (athlete_profile_id,local_totals,database_totals,differences,status,checked_at)
      VALUES ($1,$2,$3,$4,$5,$6)`, [snapshot.athlete_profile_id, local, database, differences, status, checkedAt]);
    const run = { profileId: snapshot.athlete_profile_id, status, differences, checkedAt: checkedAt.toISOString() };
    results.push(run);
    console[status === "green" ? "info" : "warn"](`RECONCILIATION ${status.toUpperCase()} profile=${snapshot.athlete_profile_id} differences=${Object.keys(differences).join(",") || "none"}`);
    await sendAlert(run);
  }
  return results;
}

export function startReconciliationJob({ intervalMs = DAY_MS, runImmediately = true } = {}) {
  const execute = () => runReconciliation().catch((error) => console.error("Reconciliation job failed:", error.name, error.code || ""));
  if (runImmediately) void execute();
  const timer = setInterval(execute, intervalMs);
  timer.unref?.();
  return timer;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startReconciliationJob({ runImmediately: true });
}
