import fs from 'fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

const SOURCE_DIR = path.resolve('migration/source/sheets');
const OUT_DIR = path.resolve('migration/parsed/sheets');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function normalizeHeader(header) {
  return header.trim().replace(/\s+/g, '_').toLowerCase();
}

async function main() {
  await ensureDir(OUT_DIR);
  const files = await fs.readdir(SOURCE_DIR);
  const csvFiles = files.filter((f) => f.endsWith('.csv'));

  for (const file of csvFiles) {
    const sourcePath = path.join(SOURCE_DIR, file);
    const raw = await fs.readFile(sourcePath, 'utf8');
    const records = parse(raw, { columns: true, skip_empty_lines: true });
    const normalized = records.map((row) => {
      const normalizedRow = {};
      for (const [key, value] of Object.entries(row)) {
        normalizedRow[normalizeHeader(key)] = value === '' ? null : value;
      }
      return normalizedRow;
    });
    const outFile = path.basename(file, '.csv') + '.json';
    const outPath = path.join(OUT_DIR, outFile);
    await fs.writeFile(outPath, JSON.stringify(normalized, null, 2), 'utf8');
    console.log('parsed', file, '=>', outPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
