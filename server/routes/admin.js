/* Rutas de administración de la biblioteca. Todo aquí exige rol admin:
   subir bibliografía es escribir en un recurso COMPARTIDO por todos los
   usuarios (docs/03-modelo-datos.md §11). */
import express from "express";
import { pool } from "../db/repositories/_helpers.js";
import * as documentsRepo from "../db/repositories/documents.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/authorization.js";
import { createStorageClient } from "../integrations/storage/r2.js";
import { createEmbeddingProvider, createLLMProvider } from "../ai/factory.js";
import { ingerirPDF, IngestaError, MAX_BYTES } from "../ingestion/pipeline.js";

const router = express.Router();
router.use(requireAuth, requireAdmin);

/* El cliente de R2 y el proveedor de IA se crean una sola vez: abren
   conexiones reutilizables y leer la configuración en cada petición no aporta
   nada. Si no hay credenciales, quedan a null y la ingesta lo reporta. */
let storage = null;
let storageIniciado = false;
const getStorage = () => {
  if (!storageIniciado) { storage = createStorageClient(); storageIniciado = true; }
  return storage;
};
let provider = null;
let providerIniciado = false;
const getProvider = () => {
  if (!providerIniciado) {
    try { provider = createLLMProvider(); } catch { provider = null; }
    providerIniciado = true;
  }
  return provider;
};
let embeddingProvider = null;
let embeddingProviderIniciado = false;
const getEmbeddingProvider = () => {
  if (!embeddingProviderIniciado) {
    embeddingProvider = createEmbeddingProvider();
    embeddingProviderIniciado = true;
  }
  return embeddingProvider;
};

/* El PDF llega como cuerpo binario en bruto, no como multipart: no hace falta
   una dependencia de parseo para subir UN archivo, y así no existe siquiera
   un nombre de archivo del cliente del que fiarse. El nombre original viaja
   en una cabecera y solo se usa para mostrarlo y para el prompt. */
const cuerpoPDF = express.raw({ type: ["application/pdf", "application/octet-stream"], limit: MAX_BYTES });

const nombreSeguro = (req) => {
  const bruto = String(req.get("x-nombre-archivo") || req.query.nombre || "documento.pdf");
  try { return decodeURIComponent(bruto).replace(/[\r\n]/g, " ").slice(0, 200); }
  catch { return "documento.pdf"; }
};

router.post("/documents/upload", cuerpoPDF, async (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ ok: false, message: "Envía el PDF como cuerpo binario con Content-Type: application/pdf" });
    }
    const resultado = await ingerirPDF(req.body, {
      db: pool,
      storage: getStorage(),
      provider: getProvider(),
      embeddingProvider: getEmbeddingProvider(),
      repo: documentsRepo,
      nombre: nombreSeguro(req),
      userId: req.auth.userId,
    });
    res.status(201).json({ ok: true, ...resultado });
  } catch (error) {
    if (error instanceof IngestaError) {
      return res.status(error.status).json({ ok: false, message: error.message, motivo: error.motivo, documento: error.documento });
    }
    next(error);
  }
});

/* Cola de revisión: lo subido que nadie ha confirmado. Se confirma con el
   PATCH /api/documents/:id que ya existe (revisado: true). */
router.get("/documents/pending", async (_req, res, next) => {
  try { res.json({ ok: true, documents: await documentsRepo.listPendingReview() }); }
  catch (error) { next(error); }
});

router.get("/documents/:id/chunks", async (req, res, next) => {
  try { res.json({ ok: true, chunks: await documentsRepo.listChunksByDocument(req.params.id) }); }
  catch (error) { next(error); }
});

/* Descarga del original. Si el bucket tiene dominio público se redirige; si
   no, el PDF se sirve por aquí para no exponer credenciales ni el bucket. */
router.get("/documents/:id/pdf", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT storage_key FROM documents WHERE id = $1;`, [req.params.id]);
    const key = rows[0]?.storage_key;
    if (!key) return res.status(404).json({ ok: false, message: "Ese documento no tiene PDF asociado" });
    const almacen = getStorage();
    if (!almacen) return res.status(503).json({ ok: false, message: "El almacenamiento R2 no está configurado" });
    const publica = almacen.urlPublica(key);
    if (publica) return res.redirect(publica);
    res.type("application/pdf").send(await almacen.leerPDF(key));
  } catch (error) { next(error); }
});

router.get("/storage/estado", (_req, res) => {
  res.json({ ok: true, r2: !!getStorage(), ia: !!getProvider(), embeddings: !!getEmbeddingProvider(), maxBytes: MAX_BYTES });
});

export default router;
