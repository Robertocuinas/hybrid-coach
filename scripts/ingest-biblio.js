#!/usr/bin/env node
/* ============================================================
   INGESTA MASIVA DE BIBLIOGRAFÍA

     npm run biblio:ingest -- --dir ./papers --user tu@correo.com

   Por qué un script y no la interfaz: la subida por HTTP está limitada a 10
   documentos por hora (UPLOAD_RATE_LIMIT_PER_HOUR), el navegador tiene que
   mantener cada archivo en memoria y una tanda de cien PDF tarda horas. Aquí
   no hay ninguna de esas tres restricciones.

   Es REANUDABLE: la deduplicación por hash y por DOI que ya hace la ingesta
   convierte un segundo pase sobre la misma carpeta en un salto rápido de lo
   ya hecho. Si el proceso se corta, se vuelve a lanzar y sigue.

   Va de uno en uno a propósito. Paralelizar multiplicaría el gasto de tokens
   por minuto y es la vía rápida a que el proveedor devuelva 429 a mitad del
   lote; el cuello de botella real es la API, no el disco.
   ============================================================ */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pool from "../server/db/pool.js";
import * as documentsRepo from "../server/db/repositories/documents.js";
import { findUserByEmail } from "../server/db/repositories/users.js";
import { ingerirPDF, MAX_BYTES } from "../server/ingestion/pipeline.js";
import { comprobarExtractor } from "../server/integrations/pdf-extractor.js";
import { createStorageClient } from "../server/integrations/storage/r2.js";
import { createLLMProvider } from "../server/ai/factory.js";
import { resolveUserLLMProvider } from "../server/ai/user-provider.js";
import { resolveEmbeddingConfig, resolveEmbeddingProvider } from "../server/ai/instance-embeddings.js";
import { clasificar, comprobarPrevio, listarPDFs, resumir, tamanoDe } from "./ingest-lib.js";

function parseArgs(argv) {
  const args = { dir: null, user: null, pausa: 0, limite: 0, dryRun: false, informe: null, si: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") args.dir = argv[++i];
    else if (a === "--user") args.user = argv[++i];
    else if (a === "--pausa") args.pausa = Number(argv[++i]) || 0;
    else if (a === "--limite") args.limite = Number(argv[++i]) || 0;
    else if (a === "--informe") args.informe = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--si" || a === "--yes") args.si = true;
  }
  return args;
}

const AYUDA = `
Ingesta masiva de bibliografía en PDF.

  npm run biblio:ingest -- --dir <carpeta> [opciones]

  --dir <carpeta>     Carpeta con los PDF. Se recorre recursivamente.
  --user <correo>     Cuenta de la que tomar la clave de IA para las fichas.
                      Sin esto se usa LLM_PROVIDER del entorno, si existe.
  --pausa <ms>        Espera entre documentos. Úsalo si el proveedor limita.
  --limite <n>        Procesa solo los n primeros. Para probar el lote.
  --dry-run           Comprueba y lista, sin escribir nada.
  --informe <ruta>    Escribe el detalle en un JSON.
  --si                No pide confirmación antes de empezar.
`;

const barra = (hecho, total, ancho = 24) => {
  const lleno = total ? Math.round((hecho / total) * ancho) : 0;
  return "█".repeat(lleno) + "·".repeat(ancho - lleno);
};

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function confirmar(pregunta) {
  /* stdin puede no ser un TTY (CI, tubería): ahí no se pregunta, se aborta,
     porque una ingesta masiva no debe arrancar sola por accidente. */
  if (!process.stdin.isTTY) return false;
  process.stdout.write(pregunta);
  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (d) => {
      process.stdin.pause();
      resolve(/^s|^y/i.test(d.trim()));
    });
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.dir) { console.log(AYUDA); return 1; }

  const carpeta = path.resolve(args.dir);
  console.log(`\n  Carpeta: ${carpeta}\n`);

  const todos = await listarPDFs(carpeta);
  const pdfs = args.limite > 0 ? todos.slice(0, args.limite) : todos;

  /* ---------- Proveedores ---------- */
  let llmProvider = null;
  if (args.user) {
    const usuario = await findUserByEmail(args.user);
    if (!usuario) { console.error(`  No existe ninguna cuenta con el correo ${args.user}.`); return 1; }
    llmProvider = await resolveUserLLMProvider(usuario.id, { fallbackProvider: createLLMProvider() });
  } else {
    try { llmProvider = createLLMProvider(); } catch { llmProvider = null; }
  }

  const [extractor, embeddingConfig, embeddingProvider] = await Promise.all([
    comprobarExtractor(),
    resolveEmbeddingConfig(),
    resolveEmbeddingProvider().catch(() => null),
  ]);
  const storage = createStorageClient();

  /* ---------- Comprobación previa ---------- */
  const previo = await comprobarPrevio({
    extractor, embeddingConfig, llmProvider, storage, totalPDFs: pdfs.length, db: pool,
  });

  console.log("  COMPROBACIÓN PREVIA");
  for (const [clave, valor] of Object.entries(previo.detalles)) {
    console.log(`    ${clave.padEnd(12)} ${valor}`);
  }
  console.log("");
  for (const b of previo.bloqueos) console.log(`    ✖ ${b}`);
  for (const a of previo.avisos) console.log(`    ! ${a}`);
  if (previo.bloqueos.length || previo.avisos.length) console.log("");

  if (!previo.listo) { console.error("  No se puede empezar. Corrige lo anterior.\n"); return 1; }

  /* Peso total: da una idea del tiempo y ayuda a detectar un PDF gigante que
     vaya a rebotar contra el límite antes de gastar nada en él. */
  const pesos = await Promise.all(pdfs.map(tamanoDe));
  const totalMB = pesos.reduce((a, b) => a + b, 0) / 1024 / 1024;
  const grandes = pdfs.filter((_, i) => pesos[i] > MAX_BYTES);
  console.log(`  ${pdfs.length} documentos · ${totalMB.toFixed(1)} MB${todos.length !== pdfs.length ? ` (de ${todos.length} encontrados)` : ""}`);
  if (grandes.length) console.log(`    ! ${grandes.length} superan el límite de ${Math.round(MAX_BYTES / 1024 / 1024)} MB y se descartarán.`);
  if (llmProvider) console.log(`    Se hará una llamada al modelo por documento: ${pdfs.length} en total.`);
  console.log("");

  if (args.dryRun) {
    pdfs.forEach((p, i) => console.log(`    ${String(i + 1).padStart(4)}  ${path.relative(carpeta, p)}`));
    console.log("\n  Dry run: no se ha escrito nada.\n");
    return 0;
  }

  if (!args.si && !(await confirmar(`  ¿Empezar la ingesta de ${pdfs.length} documentos? [s/N] `))) {
    console.log("\n  Cancelado.\n");
    return 0;
  }
  console.log("");

  /* ---------- Ingesta ---------- */
  const resultados = [];
  const arranque = Date.now();

  for (let i = 0; i < pdfs.length; i++) {
    const ruta = pdfs[i];
    const nombre = path.basename(ruta);
    const rel = path.relative(carpeta, ruta);
    process.stdout.write(`  [${String(i + 1).padStart(4)}/${pdfs.length}] ${barra(i, pdfs.length)}  ${rel.slice(0, 52).padEnd(52)}`);

    try {
      const buffer = await readFile(ruta);
      const salida = await ingerirPDF(buffer, {
        db: pool, storage, provider: llmProvider, embeddingProvider,
        repo: documentsRepo, nombre, userId: null,
      });
      resultados.push({
        archivo: rel, estado: "ok", titulo: salida.documento.titulo,
        chunks: salida.chunks, embeddings: salida.embeddings, revisado: salida.revisado,
      });
      console.log(` ✓ ${salida.chunks} frag.${salida.revisado ? " · disponible" : " · a revisar"}`);
    } catch (error) {
      const estado = clasificar(error);
      resultados.push({ archivo: rel, estado, mensaje: error.message });
      const simbolo = estado === "duplicado" ? "=" : estado === "descartado" ? "–" : "✖";
      console.log(` ${simbolo} ${error.message.slice(0, 60)}`);

      /* Un fallo del servidor (sin extractor, sin almacén accesible) se va a
         repetir en todos los documentos siguientes: no tiene sentido seguir
         gastando el lote entero para acumular el mismo error. */
      if (estado === "servidor") {
        console.log("\n  Fallo de configuración del servidor: se detiene el lote.\n");
        break;
      }
    }

    if (args.pausa) await espera(args.pausa);
  }

  /* ---------- Resumen ---------- */
  const r = resumir(resultados);
  const minutos = ((Date.now() - arranque) / 60000).toFixed(1);
  console.log(`\n  ${barra(1, 1)}  ${minutos} min\n`);
  console.log("  RESULTADO");
  console.log(`    ingeridos      ${r.conteo.ok}`);
  console.log(`    ya estaban     ${r.conteo.duplicado}`);
  console.log(`    descartados    ${r.conteo.descartado}`);
  if (r.conteo.error || r.conteo.servidor) console.log(`    errores        ${r.conteo.error + r.conteo.servidor}`);
  console.log(`    fragmentos     ${r.chunks}`);
  console.log(`    vectorizados   ${r.embeddings}`);
  console.log(`    disponibles    ${r.disponibles} de ${r.conteo.ok} (el resto espera revisión)`);

  const fallidos = resultados.filter((x) => x.estado === "error" || x.estado === "servidor");
  if (fallidos.length) {
    console.log("\n  FALLIDOS");
    for (const f of fallidos.slice(0, 20)) console.log(`    ${f.archivo}\n      ${f.mensaje}`);
    if (fallidos.length > 20) console.log(`    … y ${fallidos.length - 20} más (usa --informe para el detalle).`);
  }

  if (!embeddingConfig.enabled && r.conteo.ok) {
    console.log("\n  Siguiente paso: configura los embeddings y ejecuta npm run embeddings:reindex");
  }
  if (r.disponibles < r.conteo.ok) {
    console.log("  Revisa las fichas incompletas en el panel de administración.");
  }

  if (args.informe) {
    await writeFile(args.informe, JSON.stringify({ carpeta, fecha: new Date().toISOString(), resumen: r, resultados }, null, 2), "utf8");
    console.log(`\n  Informe: ${args.informe}`);
  }
  console.log("");

  return r.conteo.error + r.conteo.servidor > 0 ? 2 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(async (codigo) => { await pool.end().catch(() => {}); process.exit(codigo); })
    .catch(async (error) => { console.error(`\n  ${error.message}\n`); await pool.end().catch(() => {}); process.exit(1); });
}
