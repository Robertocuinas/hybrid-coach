/* Evidencia citada en la UI. El cliente solo aporta el id opaco del chunk: la
   ruta comprueba que pertenece a un documento revisado y deriva la clave R2
   desde PostgreSQL. Nunca se acepta un bucket/key enviado por el navegador. */
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireActiveProfile } from "../middleware/authorization.js";
import { findReviewedChunkEvidence } from "../db/repositories/documents.js";
import { createStorageClient, signedURLTTL } from "../integrations/storage/r2.js";

const router = express.Router();
router.use(requireAuth, requireActiveProfile);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storage = createStorageClient();

function dto(row) {
  return {
    chunkId: row.id,
    documentId: row.document_id,
    texto: row.texto,
    seccion: row.seccion,
    paginaInicio: row.pagina_inicio,
    paginaFin: row.pagina_fin,
    titulo: row.titulo,
    autores: row.autores,
    anio: row.anio,
    fuente: row.fuente_revista,
    studyType: row.study_type,
    evidenceGrade: row.evidence_grade,
    poblacion: row.poblacion,
    populationType: row.population_type,
    sampleSize: row.sample_size,
    doi: row.doi,
    origen: row.origen,
    hasPdf: !!row.storage_key,
  };
}

router.get("/chunks/:chunkId", async (req, res, next) => {
  try {
    if (!UUID.test(req.params.chunkId)) return res.status(400).json({ ok: false, message: "Identificador de fragmento no válido" });
    const chunk = await findReviewedChunkEvidence(req.params.chunkId);
    if (!chunk) return res.status(404).json({ ok: false, message: "Fragmento no encontrado" });
    res.json({ ok: true, evidence: dto(chunk) });
  } catch (error) { next(error); }
});

router.get("/chunks/:chunkId/pdf-url", async (req, res, next) => {
  try {
    if (!UUID.test(req.params.chunkId)) return res.status(400).json({ ok: false, message: "Identificador de fragmento no válido" });
    const chunk = await findReviewedChunkEvidence(req.params.chunkId);
    if (!chunk) return res.status(404).json({ ok: false, message: "Fragmento no encontrado" });
    if (!chunk.storage_key) return res.status(404).json({ ok: false, message: "Esta referencia no tiene PDF asociado" });
    if (!storage) return res.status(503).json({ ok: false, message: "El almacenamiento de PDFs no está configurado" });
    const expiresIn = signedURLTTL();
    const url = await storage.urlFirmada(chunk.storage_key, { expiresIn });
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, url, expiresIn });
  } catch (error) { next(error); }
});

export default router;
