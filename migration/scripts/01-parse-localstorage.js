import fs from 'fs/promises';
import path from 'node:path';

const SOURCE_DIR = path.resolve('migration/source');
const OUT_DIR = path.resolve('migration/parsed/localstorage');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function parseLocalStorageFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  const data = JSON.parse(content);
  return data;
}

function standardizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

async function main() {
  await ensureDir(OUT_DIR);
  const files = await fs.readdir(SOURCE_DIR);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  for (const file of jsonFiles) {
    const sourcePath = path.join(SOURCE_DIR, file);
    const parsed = await parseLocalStorageFile(sourcePath);
    const outPath = path.join(OUT_DIR, standardizeFilename(file));
    await fs.writeFile(outPath, JSON.stringify(parsed, null, 2), 'utf8');
    console.log('parsed', file, '=>', outPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
