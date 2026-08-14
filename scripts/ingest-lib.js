/* ============================================================
   INGESTA MASIVA — comprobaciones previas y recorrido de carpeta

   Separado del ejecutable para poder probarlo sin lanzar la ingesta.

   La comprobación previa existe por una razón concreta: un lote de 200 PDF
   tarda horas y cuesta dinero. Descubrir al documento 180 que los embeddings
   no estaban configurados significa 180 documentos sin vectorizar y una
   factura de LLM ya gastada. Todo lo que se puede verificar en dos segundos
   se verifica antes de empezar.
   ============================================================ */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/* ---------- Recorrido de la carpeta ---------- */

/* Recursivo pero sin seguir enlaces simbólicos: una carpeta de papers puede
   contener atajos a otras y no queremos ingerir dos veces lo mismo ni entrar
   en un ciclo. */
export async function listarPDFs(dir, { maxProfundidad = 6 } = {}) {
  const salida = [];
  async function recorrer(actual, profundidad) {
    if (profundidad > maxProfundidad) return;
    let entradas;
    try { entradas = await readdir(actual, { withFileTypes: true }); }
    catch { return; }
    for (const entrada of entradas.sort((a, b) => a.name.localeCompare(b.name, "es"))) {
      if (entrada.name.startsWith(".")) continue;
      const completo = path.join(actual, entrada.name);
      if (entrada.isDirectory()) await recorrer(completo, profundidad + 1);
      else if (entrada.isFile() && /\.pdf$/i.test(entrada.name)) salida.push(completo);
    }
  }
  await recorrer(dir, 0);
  return salida;
}

export async function tamanoDe(ruta) {
  try { return (await stat(ruta)).size; } catch { return 0; }
}

/* ---------- Comprobación previa ---------- */

/**
 * Devuelve { listo, bloqueos[], avisos[], detalles{} }.
 *
 * Un bloqueo impide empezar. Un aviso deja continuar pero cambia el resultado:
 * ingerir sin proveedor de IA guarda los documentos sin ficha y sin clasificar,
 * lo que significa revisarlos a mano uno por uno después.
 */
export async function comprobarPrevio({ extractor, embeddingConfig, llmProvider, storage, totalPDFs, db }) {
  const bloqueos = [];
  const avisos = [];

  if (!totalPDFs) bloqueos.push("No se ha encontrado ningún PDF en esa carpeta.");

  if (!extractor?.ok) {
    bloqueos.push(`El extractor de PDF no funciona: ${extractor?.motivo || "motivo desconocido"}. Sin él no se puede leer ningún documento.`);
  }

  if (!embeddingConfig?.enabled) {
    /* No es bloqueo: los documentos entran y `npm run embeddings:reindex` los
       vectoriza después. Pero conviene decirlo antes, no después. */
    avisos.push("Sin proveedor de embeddings: los documentos entrarán sin vectorizar y el coach solo los encontrará por texto. Ejecuta npm run embeddings:reindex al terminar.");
  }

  if (!llmProvider) {
    avisos.push("Sin proveedor de IA: los documentos entrarán sin ficha (título, autores, año, tipo de estudio) y quedarán todos pendientes de revisión manual.");
  }

  if (!storage) {
    avisos.push("Sin almacenamiento R2: se conservará el texto pero no el PDF original.");
  }

  if (!db) bloqueos.push("No hay conexión con la base de datos.");

  return {
    listo: bloqueos.length === 0,
    bloqueos,
    avisos,
    detalles: {
      extractor: extractor?.ok ? `${extractor.pymupdf} (Python ${extractor.python})` : "no disponible",
      embeddings: embeddingConfig?.enabled ? `${embeddingConfig.provider}/${embeddingConfig.model}` : "sin configurar",
      ia: llmProvider ? "configurado" : "sin configurar",
      almacen: storage ? "R2" : "sin almacén",
      documentos: totalPDFs,
    },
  };
}

/* ---------- Clasificación del resultado ---------- */

/* Un duplicado NO es un error: es la señal de que la ingesta es reanudable.
   Volver a lanzar el mismo lote debe saltarse lo ya hecho y seguir, no
   abortar ni duplicar. */
export function clasificar(error) {
  if (!error) return "ok";
  if (error.status === 409) return "duplicado";
  if (error.status === 415 || error.status === 413 || error.status === 422) return "descartado";
  if (error.status === 503) return "servidor";
  return "error";
}

export const ETIQUETAS = {
  ok: "ingeridos",
  duplicado: "ya estaban",
  descartado: "descartados",
  servidor: "fallo de servidor",
  error: "errores",
};

/* Resumen legible por consola. Se calcula aparte para poder probarlo. */
export function resumir(resultados) {
  const conteo = { ok: 0, duplicado: 0, descartado: 0, servidor: 0, error: 0 };
  let chunks = 0, embeddings = 0, disponibles = 0;
  for (const r of resultados) {
    conteo[r.estado] = (conteo[r.estado] || 0) + 1;
    if (r.estado === "ok") {
      chunks += r.chunks || 0;
      embeddings += r.embeddings || 0;
      if (r.revisado) disponibles += 1;
    }
  }
  return { conteo, chunks, embeddings, disponibles, total: resultados.length };
}
