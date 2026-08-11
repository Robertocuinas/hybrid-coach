import fs from 'fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const OUT_FILE = path.resolve('migration/transformed/migration.json');

function withNull(value) {
  return value === undefined ? null : value;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to load migration data.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  const raw = await fs.readFile(OUT_FILE, 'utf8');
  const data = JSON.parse(raw);

  await client.query('BEGIN');
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS legacy_id_map (
      source text NOT NULL,
      table_name text NOT NULL,
      legacy_id text NOT NULL,
      new_id uuid NOT NULL,
      PRIMARY KEY (source, table_name, legacy_id)
    );`);

    for (const row of data.legacy_id_map) {
      await client.query(`INSERT INTO legacy_id_map (source, table_name, legacy_id, new_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (source, table_name, legacy_id) DO UPDATE SET new_id = EXCLUDED.new_id;`,
        [row.source, row.table, row.legacy_id, row.new_id]);
    }

    for (const row of data.athlete_profiles) {
      await client.query(`INSERT INTO athlete_profiles (id, nombre, edad, sexo, altura_cm, peso_kg, grasa_pct, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
        ON CONFLICT (id) DO NOTHING;`,
        [row.id, row.nombre, row.edad, row.sexo, row.altura_cm, row.peso_kg, row.grasa_pct]);
    }

    for (const row of data.injuries) {
      await client.query(`INSERT INTO injuries (id, athlete_profile_id, zona, recurrente, contexto, activa, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (id) DO NOTHING;`,
        [row.id, row.athlete_profile_id, row.zona, row.recurrente, row.contexto, row.activa]);
    }

    await client.query('COMMIT');
    console.log('migration load completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
