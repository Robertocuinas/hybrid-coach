/* Orquesta la ingesta de un PDF (docs/05-rag.md §2).

   Orden deliberado: primero lo barato y lo que puede rechazar (magic bytes,
   hash, duplicados), después lo caro (extracción, LLM) y por último lo que
   deja rastro (R2, PostgreSQL). Así un duplicado no gasta ni una llamada al
   modelo ni un objeto en el bucket. */
import { sha256 } from "../integrations/storage/r2.js";
import { extraerDocumento, analizarFicha } from "../integrations/pdf-extractor.js";
import { trocear } from "./chunker.js";
import { guardarEmbeddings, vectorizarChunksPorLotes } from "./embedder.js";
import { activateIndex, refreshIndexProgress } from "../embeddings/index-state.js";

export const MAX_BYTES = Number(process.env.PDF_MAX_BYTES || 50 * 1024 * 1024);

/* El tipo real se comprueba por los primeros bytes, no por la extensión ni
   por el Content-Type: los dos los controla quien sube (docs/08-seguridad.md §8). */
export const esPDF = (buffer) => Buffer.isBuffer(buffer) && buffer.length > 4 && buffer.subarray(0, 5).toString("latin1") === "%PDF-";

export class IngestaError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = "IngestaError";
    this.status = status;
    Object.assign(this, extra);
  }
}

/**
 * @param buffer   bytes del PDF
 * @param deps     { db, storage, provider, embeddingProvider, repo, nombre, userId, extraer }
 *
 * `extraer` se inyecta para poder probar el pipeline sin depender de Python;
 * en producción siempre es extraerDocumento().
 */
export async function ingerirPDF(buffer, { db, storage, provider, embeddingProvider = null, repo, nombre = "documento.pdf", userId = null, extraer = extraerDocumento }) {
  if (!esPDF(buffer)) throw new IngestaError(415, "El archivo no es un PDF (no empieza por %PDF-)");
  if (buffer.length > MAX_BYTES) throw new IngestaError(413, `El PDF supera el límite de ${Math.round(MAX_BYTES / 1024 / 1024)} MB`);
  if (!storage) throw new IngestaError(503, "El almacenamiento R2 no está configurado en este servidor");

  // 1. Deduplicación por archivo, antes de gastar nada.
  const hash = sha256(buffer);
  const yaPorHash = await repo.findDocumentByHash(hash);
  if (yaPorHash) throw new IngestaError(409, "Este PDF ya está en la biblioteca", { documento: yaPorHash, motivo: "hash" });

  // 2. Extracción y limpieza.
  const extraido = await extraer(buffer);
  if (!extraido.tieneCapaDeTexto) {
    throw new IngestaError(422, "El PDF no tiene capa de texto (parece escaneado). Este flujo no hace OCR: convierte el PDF a texto y vuelve a subirlo.");
  }

  // 3. Deduplicación por DOI: el mismo paper desde otro archivo.
  if (extraido.doi) {
    const yaPorDoi = await repo.findDocumentByDoi(extraido.doi);
    if (yaPorDoi) throw new IngestaError(409, `Ese paper ya está en la biblioteca (DOI ${extraido.doi})`, { documento: yaPorDoi, motivo: "doi" });
  }

  // 4. Ficha por LLM. Si no hay proveedor, el documento entra igual y se
  //    rellena a mano: perder el PDF sería peor que una ficha incompleta.
  let ficha = {};
  let avisoFicha = null;
  try {
    ficha = await analizarFicha(extraido.texto, { provider, nombre, doiDetectado: extraido.doi });
  } catch (error) {
    avisoFicha = `No se pudo generar la ficha automáticamente: ${error.message}`;
    ficha = { doi: extraido.doi, titulo: extraido.meta?.titulo || null, autores: extraido.meta?.autores || null, tags: [] };
  }

  // 5. Troceado.
  const chunks = trocear(extraido.parrafos);
  if (!chunks.length) throw new IngestaError(422, "No se pudo trocear el documento: no se extrajo texto aprovechable");

  // 6. Embeddings por lotes antes de abrir una transacción. Si no están
  // configurados, el PDF entra pendiente y el reindexado lo completará.
  let vectorizados = null;
  let avisoEmbedding = null;
  if (embeddingProvider) {
    try {
      vectorizados = await vectorizarChunksPorLotes(chunks, { provider: embeddingProvider, inputType: "document" });
    } catch (error) {
      throw new IngestaError(502, `No se pudieron generar los embeddings: ${error.message}`);
    }
  } else {
    avisoEmbedding = "Documento guardado sin embeddings: configura el proveedor y ejecuta npm run embeddings:reindex.";
  }

  // 7. Original a R2. Se sube antes de insertar para no dejar en la base de
  //    datos una storage_key que apunte a un objeto que no existe.
  const storageKey = await storage.guardarPDF(buffer, hash);

  // 8. Persistencia. revisado=false: no participa en retrieval hasta que un
  //    admin lo confirma (docs/05-rag.md §2.5).
  const documento = {
    titulo: ficha.titulo ?? null,
    autores: ficha.autores ?? null,
    anio: ficha.anio ?? null,
    fuente_revista: ficha.fuenteRevista ?? null,
    doi: ficha.doi ?? null,
    hash_archivo: hash,
    study_type: ficha.studyType ?? null,
    evidence_grade: ficha.evidenceGrade ?? null,
    poblacion: ficha.poblacion ?? null,
    population_type: ficha.populationType ?? null,
    sample_size: ficha.sampleSize ?? null,
    tema_principal: ficha.temaPrincipal ?? null,
    tags: ficha.tags?.length ? ficha.tags : null,
    resumen: ficha.resumen ?? null,
    limites: ficha.limites ?? null,
    aplicacion_practica: ficha.aplicacionPractica ?? null,
    storage_key: storageKey,
    origen: "pdf",
    revisado: false,
    subido_por: userId,
  };

  const guardado = await repo.crearDocumentoConChunks(db, {
    documento,
    chunks,
    onChunks: vectorizados ? async (transaction, chunkRows) => {
      await guardarEmbeddings(transaction, {
        ...vectorizados,
        items: vectorizados.items.map((item, index) => ({ ...item, chunk: chunkRows[index] })),
      });
    } : null,
  });

  if (vectorizados) {
    const config = { provider: vectorizados.provider, model: vectorizados.model, dimensions: vectorizados.dimensions };
    const counts = await refreshIndexProgress(db, config);
    if (counts.indexed_chunks === counts.total_chunks) await activateIndex(db, config);
  }

  return {
    documento: guardado.documento,
    chunks: chunks.length,
    numPaginas: extraido.numPaginas,
    secciones: resumenSecciones(chunks),
    storageKey,
    aviso: avisoFicha,
    avisoEmbedding,
    embeddings: vectorizados?.items.length || 0,
  };
}

export function resumenSecciones(chunks) {
  const conteo = {};
  for (const chunk of chunks) conteo[chunk.seccion] = (conteo[chunk.seccion] || 0) + 1;
  return conteo;
}
