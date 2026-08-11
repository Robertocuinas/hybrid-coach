/* Paso 02 — parsea los CSV exportados de Google Sheets a JSON normalizado.
   Google Sheets es un respaldo de solo escritura, no la fuente de verdad
   (docs/06-migracion.md §1): estos datos NO se cargan en Postgres. Solo
   sirven para la comparación de migration/DISCREPANCIAS.md. Si no hay CSVs
   exportados, este paso se salta sin error — es opcional. */
import path from "node:path";
import { parse } from "csv-parse/sync";
import fs from "node:fs/promises";
import { SHEETS_DIR, PARSED_SHEETS_DIR, listFiles, writeJson, logStep } from "./lib/util.js";

function normalizeHeader(header) {
  return header.trim().replace(/\s+/g, "_").toLowerCase();
}

export async function run() {
  logStep("02 · parse-sheets");
  const files = await listFiles(SHEETS_DIR, ".csv");

  if (!files.length) {
    console.log(`No hay CSV en ${SHEETS_DIR}. Sheets es opcional — se continúa sin comparación.`);
    return { archivos: 0 };
  }

  for (const file of files) {
    const sourcePath = path.join(SHEETS_DIR, file);
    const raw = await fs.readFile(sourcePath, "utf8");
    const records = parse(raw, { columns: true, skip_empty_lines: true, bom: true });
    const normalized = records.map((row) => {
      const out = {};
      for (const [key, value] of Object.entries(row)) out[normalizeHeader(key)] = value === "" ? null : value;
      return out;
    });
    const outFile = path.basename(file, ".csv") + ".json";
    await writeJson(path.join(PARSED_SHEETS_DIR, outFile), normalized);
    console.log(`✓ ${file}: ${normalized.length} fila(s) → ${outFile}`);
  }

  console.log(`\n${files.length} hoja(s) parseada(s) → ${PARSED_SHEETS_DIR}`);
  console.log("Recuerda: estos datos son solo para comparar en DISCREPANCIAS.md, no se cargan en Postgres.");
  return { archivos: files.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
