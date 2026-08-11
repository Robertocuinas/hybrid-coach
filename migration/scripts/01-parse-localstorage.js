/* Paso 01 — parsea cada volcado de migration/source/localstorage-*.json a
   migration/parsed/localstorage/. Solo valida forma y JSON íntegro; el
   mapeo real ocurre en 03-transform.js. Uno por dispositivo (docs/roadmap/
   fase-00-auditoria.md): si hay varios, todos se conservan aquí y es
   03-transform.js quien los fusiona y deduplica. */
import path from "node:path";
import { SOURCE_DIR, PARSED_LOCAL_DIR, listFiles, readJson, writeJson, logStep } from "./lib/util.js";

function validar(nombreArchivo, data) {
  const errores = [];
  if (typeof data !== "object" || data === null) errores.push("el JSON no es un objeto");
  if (data?.v === undefined) errores.push("falta el campo 'v' (versión de esquema)");
  if (typeof data?.perfiles !== "object" || data?.perfiles === null) errores.push("falta 'perfiles' o no es un objeto");
  if (errores.length) throw new Error(`${nombreArchivo}: volcado inválido o incompleto — ${errores.join("; ")}`);
  return data;
}

export async function run() {
  logStep("01 · parse-localstorage");
  const files = await listFiles(SOURCE_DIR, ".json");

  if (!files.length) {
    console.log(`No hay volcados en ${SOURCE_DIR}. Nada que parsear (¿ya hiciste la Fase 0?).`);
    return { archivos: 0 };
  }

  let ok = 0;
  for (const file of files) {
    const sourcePath = path.join(SOURCE_DIR, file);
    let data;
    try {
      data = validar(file, await readJson(sourcePath));
    } catch (e) {
      console.error(`✗ ${file}: ${e.message}`);
      continue;
    }
    const nPerfiles = Object.keys(data.perfiles).length;
    const nBiblio = Array.isArray(data.biblio) ? data.biblio.length : 0;
    await writeJson(path.join(PARSED_LOCAL_DIR, file), data);
    console.log(`✓ ${file}: ${nPerfiles} perfil(es), ${nBiblio} referencia(s) bibliográficas`);
    ok++;
  }

  console.log(`\n${ok}/${files.length} volcados parseados correctamente → ${PARSED_LOCAL_DIR}`);
  if (ok < files.length) throw new Error(`${files.length - ok} volcado(s) con errores. Revisa el JSON antes de continuar.`);
  return { archivos: ok };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
