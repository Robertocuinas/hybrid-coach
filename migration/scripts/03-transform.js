import fs from 'fs/promises';
import path from 'node:path';
import { randomUUID } from 'crypto';

const LOCAL_DIR = path.resolve('migration/parsed/localstorage');
const SHEETS_DIR = path.resolve('migration/parsed/sheets');
const OUT_DIR = path.resolve('migration/transformed');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function normalizeExerciseName(name) {
  if (!name) return null;
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s–—]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeValue(value) {
  if (value === '' || value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).replace(/,/g, '.'));
  return Number.isFinite(n) ? n : null;
}

function mapLegacyId(oldId, table, source, map) {
  if (!oldId) return null;
  const key = `${source}:${table}:${oldId}`;
  if (!map[key]) {
    map[key] = randomUUID();
  }
  return map[key];
}

async function loadJsonFiles(dir) {
  const files = await fs.readdir(dir);
  return Promise.all(files.filter((f) => f.endsWith('.json')).map(async (file) => {
    const content = await fs.readFile(path.join(dir, file), 'utf8');
    return JSON.parse(content);
  }));
}

async function main() {
  await ensureDir(OUT_DIR);
  const localFiles = await fs.readdir(LOCAL_DIR);
  const legacyMap = {};
  const output = {
    athlete_profiles: [],
    injuries: [],
    documents: [],
    strength_exercises: [],
    routines: [],
    running_sessions: [],
    strength_sessions: [],
    strength_sets: [],
    recovery_logs: [],
    feedback_logs: [],
    plan_modifications: [],
    training_plans: [],
    training_weeks: [],
    planned_sessions: [],
    plan_decisions: [],
    nutrition_targets: [],
    meal_catalog: [],
    legacy_id_map: [],
  };

  for (const file of localFiles.filter((f) => f.endsWith('.json'))) {
    const data = JSON.parse(await fs.readFile(path.join(LOCAL_DIR, file), 'utf8'));
    if (!data.perfiles) continue;
    for (const [profileId, profileWrapper] of Object.entries(data.perfiles)) {
      const profileData = profileWrapper;
      const newProfileId = mapLegacyId(profileId, 'athlete_profiles', 'localStorage', legacyMap);
      output.athlete_profiles.push({
        id: newProfileId,
        legacy_id: profileId,
        source: 'localStorage',
        ...profileData.perfil,
      });

      if (Array.isArray(profileData.perfil.lesiones)) {
        for (const injury of profileData.perfil.lesiones) {
          const newInjuryId = mapLegacyId(injury.id, 'injuries', 'localStorage', legacyMap);
          output.injuries.push({
            id: newInjuryId,
            athlete_profile_id: newProfileId,
            zona: normalizeValue(injury.zona || injury.zona_texto || injury.zona || null),
            recurrente: injury.recurrente || false,
            contexto: normalizeValue(injury.cuando || injury.contexto || null),
            activa: injury.activa ?? true,
          });
        }
      }

      if (Array.isArray(profileData.running)) {
        for (const run of profileData.running) {
          const newRunId = mapLegacyId(run.id, 'running_sessions', 'localStorage', legacyMap);
          output.running_sessions.push({
            id: newRunId,
            atleta_profile_id: newProfileId,
            fecha: run.fecha,
            distancia_km: toNumber(run.km || run.distancia || run.distancia_km),
            duracion_min: toNumber(run.min || run.duracion_min || run.minutos),
            ritmo: toNumber(run.ritmo),
            fc_media: toNumber(run.fc_media),
            fc_max: toNumber(run.fc_max),
            desnivel: toNumber(run.desnivel),
            cadencia: toNumber(run.cadencia),
            rpe: toNumber(run.rpe),
            dolor: toNumber(run.dolor),
            notas: normalizeValue(run.notas),
            origen: normalizeValue(run.origen || 'manual'),
            external_id: normalizeValue(run.external_id),
          });
        }
      }
    }
  }

  // Produce legacy map JSON para referencia
  for (const [key, newId] of Object.entries(legacyMap)) {
    const [source, table, oldId] = key.split(':');
    output.legacy_id_map.push({ source, table, legacy_id: oldId, new_id: newId });
  }

  await fs.writeFile(path.join(OUT_DIR, 'migration.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log('transformed data written to', path.join(OUT_DIR, 'migration.json'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
