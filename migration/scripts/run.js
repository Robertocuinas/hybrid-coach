/* Runner de la migración: npm run migrate:data -- --step 01
   Sin --step ejecuta la secuencia completa 01→05.
   Los pasos 04 y 05 necesitan DATABASE_URL; 01-03 trabajan solo con ficheros. */
const PASOS = {
  "01": { fichero: "./01-parse-localstorage.js", nombre: "parse-localstorage" },
  "02": { fichero: "./02-parse-sheets.js", nombre: "parse-sheets" },
  "03": { fichero: "./03-transform.js", nombre: "transform" },
  "04": { fichero: "./04-load.js", nombre: "load" },
  "05": { fichero: "./05-verify.js", nombre: "verify" },
};

function parseArgs(argv) {
  const i = argv.indexOf("--step");
  if (i === -1) return null;
  const valor = argv[i + 1];
  if (!valor) throw new Error("--step necesita un número de paso (01..05).");
  return valor.padStart(2, "0");
}

async function ejecutar(clave) {
  const paso = PASOS[clave];
  if (!paso) throw new Error(`Paso desconocido: "${clave}". Válidos: ${Object.keys(PASOS).join(", ")}.`);
  const mod = await import(paso.fichero);
  return mod.run();
}

async function main() {
  const paso = parseArgs(process.argv.slice(2));

  if (paso) {
    await ejecutar(paso);
    return;
  }

  console.log("Ejecutando la migración completa (01 → 05). Usa --step NN para un paso suelto.");
  for (const clave of Object.keys(PASOS)) await ejecutar(clave);
}

main().catch((e) => { console.error(`\n${e.message}`); process.exit(1); });
