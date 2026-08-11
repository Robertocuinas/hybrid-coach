import fs from 'fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const OUT_FILE = path.resolve('migration/transformed/migration.json');

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to verify migration data.');
  }

  const client = new Client({ connectionString });
  await client.connect();
  const raw = await fs.readFile(OUT_FILE, 'utf8');
  const data = JSON.parse(raw);

  const checks = [];

  checks.push({
    name: 'athlete_profiles_count',
    expected: data.athlete_profiles.length,
    actual: Number((await client.query('SELECT COUNT(*) FROM athlete_profiles')).rows[0].count),
  });

  checks.push({
    name: 'running_sessions_count',
    expected: data.running_sessions.length,
    actual: Number((await client.query('SELECT COUNT(*) FROM running_sessions')).rows[0].count),
  });

  checks.push({
    name: 'running_sessions_km_total',
    expected: data.running_sessions.reduce((sum, row) => sum + safeNumber(row.distancia_km), 0),
    actual: Number((await client.query('SELECT COALESCE(SUM(distancia_km),0) FROM running_sessions')).rows[0].coalesce),
  });

  checks.push({
    name: 'strength_sets_count',
    expected: data.strength_sets.length,
    actual: Number((await client.query('SELECT COUNT(*) FROM strength_sets')).rows[0].count),
  });

  checks.push({
    name: 'strength_sets_kg_total',
    expected: data.strength_sets.reduce((sum, row) => sum + safeNumber(row.peso_kg) * safeNumber(row.reps), 0),
    actual: Number((await client.query('SELECT COALESCE(SUM(peso_kg * reps),0) FROM strength_sets')).rows[0].coalesce),
  });

  checks.push({
    name: 'feedback_logs_count',
    expected: data.feedback_logs.length,
    actual: Number((await client.query('SELECT COUNT(*) FROM feedback_logs')).rows[0].count),
  });

  checks.push({
    name: 'recovery_logs_count',
    expected: data.recovery_logs.length,
    actual: Number((await client.query('SELECT COUNT(*) FROM recovery_logs')).rows[0].count),
  });

  checks.push({
    name: 'completed_sessions_date_range',
    expected: {
      min: data.running_sessions.reduce((min, row) => row.fecha && (!min || row.fecha < min) ? row.fecha : min, null),
      max: data.running_sessions.reduce((max, row) => row.fecha && (!max || row.fecha > max) ? row.fecha : max, null),
    },
    actual: await (async () => {
      const { rows } = await client.query('SELECT MIN(fecha) AS min, MAX(fecha) AS max FROM completed_sessions');
      return rows[0];
    })(),
  });

  checks.push({
    name: 'active_training_plan_per_profile',
    expected: data.athlete_profiles.length,
    actual: Number((await client.query(`
      SELECT COUNT(*) FROM (
        SELECT athlete_profile_id
        FROM training_plans
        WHERE activo = true
        GROUP BY athlete_profile_id
        HAVING COUNT(*) = 1
      ) t
    `)).rows[0].count),
  });

  checks.push({
    name: 'orphan_strength_sets',
    expected: 0,
    actual: Number((await client.query(`
      SELECT COUNT(*)
      FROM strength_sets s
      LEFT JOIN strength_sessions ss ON s.strength_session_id = ss.id
      LEFT JOIN strength_exercises se ON s.strength_exercise_id = se.id
      WHERE ss.id IS NULL OR se.id IS NULL
    `)).rows[0].count),
  });

  checks.push({
    name: 'documents_count',
    expected: data.documents.length,
    actual: Number((await client.query('SELECT COUNT(*) FROM documents')).rows[0].count),
  });

  let failed = 0;
  for (const check of checks) {
    const pass = JSON.stringify(check.expected) === JSON.stringify(check.actual);
    if (!pass) failed += 1;
    console.log(`${pass ? 'PASS' : 'FAIL'} - ${check.name}: expected=${JSON.stringify(check.expected)}, actual=${JSON.stringify(check.actual)}`);
  }

  if (failed > 0) {
    console.error(`${failed} verification checks failed.`);
    process.exit(1);
  }

  console.log('All verification checks passed.');
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
