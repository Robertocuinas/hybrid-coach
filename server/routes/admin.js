/* Rutas de administración de la biblioteca. Todo aquí exige rol admin:
   subir bibliografía es escribir en un recurso COMPARTIDO por todos los
   usuarios (docs/03-modelo-datos.md §11). */
import express from "express";
import { pool } from "../db/repositories/_helpers.js";
import * as documentsRepo from "../db/repositories/documents.js";
import { aiRateLimiter, requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/authorization.js";
import { createStorageClient, missingStorageVars } from "../integrations/storage/r2.js";
import { comprobarExtractor } from "../integrations/pdf-extractor.js";
import { createLLMProvider, createRerankProvider, readRAGConfig, readRerankConfig } from "../ai/factory.js";
import { resolveUserLLMProvider } from "../ai/user-provider.js";
import {
  EMBEDDING_PROVIDERS_UI, cifrarClaveEmbeddings, crearDesdeConfig, invalidarEmbeddingsDeInstancia,
  publicEmbeddingSettings, resolveEmbeddingConfig, resolveEmbeddingProvider,
} from "../ai/instance-embeddings.js";
import {
  deleteInstanceEmbeddingSettings, findInstanceEmbeddingSettings,
  saveInstanceEmbeddingSettings, updateInstanceEmbeddingTest,
} from "../db/repositories/embeddingSettings.js";
import { listPlanningRuns } from "../db/repositories/weeklyPlanning.js";
import { ingerirPDF, IngestaError, MAX_BYTES } from "../ingestion/pipeline.js";
import { recuperar } from "../rag/retrieval.js";

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
/* Los embeddings NO se cachean aquí: su configuración vive en la base de datos
   y puede cambiar sin reiniciar. El resolutor tiene su propia memoria corta. */

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
    /* La ficha la genera el proveedor que el admin tenga configurado en sus
       ajustes, con el del servidor como respaldo (mismo patrón que el coach,
       server/routes/coach.js). Sin esto, una instancia sin LLM_PROVIDER dejaba
       todos los PDF sin clasificar aunque el admin tuviera su propia clave.

       Los embeddings NO siguen esta regla: van a un índice compartido por toda
       la biblioteca y tienen que salir siempre del mismo modelo. */
    const resultado = await ingerirPDF(req.body, {
      db: pool,
      storage: getStorage(),
      provider: await resolveUserLLMProvider(req.auth.userId, { fallbackProvider: getProvider() }),
      embeddingProvider: await resolveEmbeddingProvider(),
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

/* Diagnóstico de la subida: las tres cosas que tienen que estar antes de que
   un PDF entre en la biblioteca. Devuelve NOMBRES de variables que faltan y
   motivos de fallo, nunca valores de secretos (CLAUDE.md §4.6). */
router.get("/storage/estado", async (req, res, next) => {
  try {
    const almacen = getStorage();
    /* `ia` responde a "¿tendría ficha un PDF que suba YO?", no a "¿hay
       LLM_PROVIDER?": si no, el panel avisaba de que no había IA a un admin
       que sí tiene su propia clave configurada. */
    const [extractor, acceso, llm, embeddingConfig] = await Promise.all([
      comprobarExtractor(),
      almacen ? almacen.comprobar() : null,
      resolveUserLLMProvider(req.auth.userId, { fallbackProvider: getProvider() }),
      resolveEmbeddingConfig(),
    ]);
    res.json({
      ok: true,
      r2: !!almacen,
      r2Faltan: missingStorageVars(),
      r2Acceso: acceso,
      extractor,
      ia: !!llm,
      embeddings: !!embeddingConfig.enabled,
      maxBytes: MAX_BYTES,
    });
  } catch (error) { next(error); }
});

/* ============================================================
   RETRIEVAL — endpoint interno de depuración
   Devuelve los scores desglosados de cada componente. Es lo que permite
   entender por qué salió un fragmento y no otro, y lo que consumirá el
   dataset de evaluación de la Fase 10.

   Solo admin: expone contenido de la biblioteca y permite sondear el corpus.
   ============================================================ */
let rerankProvider = null;
let rerankIniciado = false;
const getRerankProvider = () => {
  if (!rerankIniciado) { rerankProvider = createRerankProvider(); rerankIniciado = true; }
  return rerankProvider;
};

const listaDe = (valor) => {
  if (valor === undefined || valor === null || valor === "") return undefined;
  const lista = (Array.isArray(valor) ? valor : [valor]).map((v) => String(v).trim()).filter(Boolean);
  return lista.length ? lista : undefined;
};
const enteroDe = (valor) => {
  const n = Number.parseInt(valor, 10);
  return Number.isInteger(n) ? n : undefined;
};

router.post("/retrieval", async (req, res, next) => {
  try {
    const cuerpo = req.body || {};
    const consulta = String(cuerpo.consulta || "").trim();
    if (!consulta) return res.status(400).json({ ok: false, message: "Falta la consulta" });

    const embeddingConfig = await resolveEmbeddingConfig();
    if (!embeddingConfig.enabled) {
      return res.status(503).json({ ok: false, message: "Los embeddings no están configurados: el retrieval solo tendría la mitad léxica." });
    }

    /* El índice activo manda sobre la configuración: validateEmbeddingStartup()
       ya garantiza al arrancar que coinciden, así que basta con leer la config. */
    const indice = { provider: embeddingConfig.provider, model: embeddingConfig.model, dimensions: embeddingConfig.dimensions };

    const config = { ...readRAGConfig(), ...sobrescrituras(cuerpo) };
    const resultado = await recuperar(consulta, {
      db: pool,
      repo: documentsRepo,
      embeddingProvider: crearDesdeConfig(embeddingConfig),
      rerankProvider: getRerankProvider(),
      indice,
      config,
      contexto: cuerpo.contexto || {},
      filtros: {
        studyType: listaDe(cuerpo.filtros?.studyType),
        populationType: listaDe(cuerpo.filtros?.populationType),
        evidenceGrade: listaDe(cuerpo.filtros?.evidenceGrade),
        seccion: listaDe(cuerpo.filtros?.seccion),
        anioMin: enteroDe(cuerpo.filtros?.anioMin),
        anioMax: enteroDe(cuerpo.filtros?.anioMax),
      },
    });

    res.json({ ...resultado, rerank: getRerankProvider().provider });
  } catch (error) { next(error); }
});

/* Permite probar umbrales y top-K sin reiniciar el servidor. Solo afecta a
   esta petición: las variables de entorno no se tocan. */
function sobrescrituras(cuerpo = {}) {
  const salida = {};
  const minScore = Number(cuerpo.minScore);
  if (Number.isFinite(minScore) && minScore >= 0 && minScore <= 1) salida.minScore = minScore;
  const topKFinal = enteroDe(cuerpo.topKFinal);
  if (topKFinal && topKFinal > 0) salida.topKFinal = topKFinal;
  const topKRetrieval = enteroDe(cuerpo.topKRetrieval);
  if (topKRetrieval && topKRetrieval > 0) salida.topKRetrieval = topKRetrieval;
  if (typeof cuerpo.weightByGrade === "boolean") salida.weightByGrade = cuerpo.weightByGrade;
  return salida;
}

router.get("/retrieval/config", async (_req, res, next) => {
  try {
    /* Nunca se devuelve apiKey: los secretos no salen del proceso ni para un
       admin (CLAUDE.md §4.6). Solo qué proveedor y qué modelo están en uso. */
    const { provider, model, baseURL } = readRerankConfig();
    const embeddings = await resolveEmbeddingConfig();
    res.json({
      ok: true,
      rag: readRAGConfig(),
      rerank: { provider, model: model || null, baseURL: baseURL || null },
      embeddings: embeddings.enabled ? { provider: embeddings.provider, model: embeddings.model, dimensions: embeddings.dimensions } : null,
    });
  } catch (error) { next(error); }
});

/* ============================================================
   PLANIFICADOR — diagnóstico de generaciones

   `planning_runs` ya guardaba por qué falló cada generación y cuánto tardó,
   pero no había forma de leerlo sin abrir una consola de PostgreSQL, así que
   en la práctica nadie lo miraba y un planificador roto solo se veía como un
   mensaje genérico en la pantalla del atleta.

   No devuelve datos de salud: el repositorio filtra por lista blanca y aquí
   solo se derivan agregados. Ver listPlanningRuns().
   ============================================================ */
router.get("/planning/runs", async (req, res, next) => {
  try {
    const runs = await listPlanningRuns({
      limit: req.query.limit,
      status: req.query.status || null,
      /* ?failed=true devuelve toda generación que no acabó en propuesta, sin
         depender de la columna status. Ver listPlanningRuns(). */
      onlyFailed: String(req.query.failed || "") === "true",
    }, pool);
    /* El desglose por fase que faltaba: `latency_ms` es el total de la
       generación y cada consulta de retrieval trae el suyo. La diferencia es,
       en la práctica, el LLM más la validación —que es código y no llega al
       milisegundo—, así que sirve para saber si el tiempo se va en recuperar
       evidencia o en el modelo, que es la pregunta que importa. */
    const resumen = runs.map((run) => {
      const diagnosticos = Array.isArray(run.retrieval_diagnostics) ? run.retrieval_diagnostics : [];
      const latenciasRetrieval = diagnosticos.map((d) => Number(d?.diagnostico?.latenciaMs) || 0);
      /* Las consultas van en paralelo (Promise.allSettled): el coste real del
         retrieval es la más lenta, no la suma. */
      const retrievalMs = latenciasRetrieval.length ? Math.max(...latenciasRetrieval) : null;
      const totalMs = Number(run.latency_ms) || null;
      return {
        id: run.id,
        kind: run.kind,
        status: run.status,
        weekNumber: run.week_number,
        provider: run.provider,
        model: run.model,
        createdAt: run.created_at,
        promptVersion: run.prompt_version,
        rulesVersion: run.rules_version,
        fases: {
          totalMs,
          retrievalMs,
          restoMs: totalMs !== null && retrievalMs !== null ? Math.max(0, totalMs - retrievalMs) : null,
          consultas: diagnosticos.map((d) => ({
            key: d?.queryKey || null, chunks: d?.chunks ?? 0,
            hayEvidencia: d?.hayEvidencia ?? null, motivo: d?.motivo || null,
            latenciaMs: Number(d?.diagnostico?.latenciaMs) || null,
          })),
        },
        queryPlan: run.queryPlan,
        failure: run.failure,
        validationResults: run.validation_results,
      };
    });
    res.json({ ok: true, runs: resumen });
  } catch (error) { next(error); }
});

/* ============================================================
   EMBEDDINGS — configuración de instancia

   Es un ajuste del SERVIDOR, no de la cuenta: los vectores de toda la
   biblioteca tienen que salir del mismo modelo. Cambiar de modelo invalida el
   índice existente y obliga a `npm run embeddings:reindex`, así que la
   respuesta lo advierte en lugar de dejarlo a la memoria de quien lo toca.
   ============================================================ */

function validarAjustesEmbeddings({ provider, model, baseURL }) {
  const proveedor = String(provider || "").trim().toLowerCase();
  const modelo = String(model || "").trim();
  const base = String(baseURL || "").trim();
  if (!EMBEDDING_PROVIDERS_UI.includes(proveedor)) throw new Error("Proveedor de embeddings no válido");
  if (!modelo || modelo.length > 200 || !/^[a-zA-Z0-9._:/-]+$/.test(modelo)) throw new Error("Nombre de modelo no válido");
  return { provider: proveedor, model: modelo, baseURL: base };
}

const respuestaAjustes = async (res, extra = {}) => {
  const [config, settings] = await Promise.all([resolveEmbeddingConfig(), findInstanceEmbeddingSettings(pool)]);
  res.json({ ok: true, embeddings: publicEmbeddingSettings(config, settings), proveedores: EMBEDDING_PROVIDERS_UI, ...extra });
};

router.get("/embeddings/config", async (_req, res, next) => {
  try { await respuestaAjustes(res); }
  catch (error) { next(error); }
});

router.put("/embeddings/config", async (req, res, next) => {
  try {
    const draft = validarAjustesEmbeddings(req.body || {});
    const anterior = await resolveEmbeddingConfig();
    const existente = await findInstanceEmbeddingSettings(pool);
    const apiKey = String(req.body?.apiKey || "").trim();

    let apiKeyCiphertext = existente?.api_key_ciphertext ?? null;
    if (apiKey) apiKeyCiphertext = cifrarClaveEmbeddings(apiKey);
    else if (!existente || existente.provider !== draft.provider) {
      /* openai-compatible admite servidores locales sin clave; el resto no. */
      if (draft.provider !== "openai-compatible") {
        return res.status(400).json({ ok: false, message: "Introduce una clave para el proveedor seleccionado" });
      }
      apiKeyCiphertext = null;
    }

    await saveInstanceEmbeddingSettings({ ...draft, apiKeyCiphertext, updatedBy: req.auth.userId }, pool);
    invalidarEmbeddingsDeInstancia();

    /* Si el modelo o el proveedor cambian, los vectores ya guardados dejan de
       ser comparables con los nuevos: hay que reindexar antes de que el coach
       vuelva a citar bien. */
    const cambioDeIndice = anterior.enabled
      && (anterior.provider !== draft.provider || anterior.model !== draft.model);
    await respuestaAjustes(res, {
      avisoReindexado: cambioDeIndice
        ? `El índice existente se generó con ${anterior.provider}/${anterior.model}. Ejecuta npm run embeddings:reindex antes de confiar en las respuestas del coach.`
        : null,
    });
  } catch (error) {
    if (/Proveedor|modelo|clave|EMBEDDING_/i.test(error.message || "")) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    next(error);
  }
});

router.post("/embeddings/config/test", aiRateLimiter, async (req, res, next) => {
  try {
    const config = await resolveEmbeddingConfig();
    if (!config.enabled) return res.status(400).json({ ok: false, message: "No hay proveedor de embeddings configurado" });
    const provider = crearDesdeConfig(config);
    const { vectors } = await provider.embed(["prueba de conexión"], { inputType: "document" });
    const dimensiones = vectors?.[0]?.length ?? 0;
    if (dimensiones !== config.dimensions) {
      throw new Error(`El modelo devolvió ${dimensiones} dimensiones y el proyecto exige ${config.dimensions}`);
    }
    if (config.origen === "instancia") await updateInstanceEmbeddingTest(true, pool).catch(() => {});
    res.json({ ok: true, provider: config.provider, model: config.model, dimensions: dimensiones });
  } catch (error) {
    const config = await resolveEmbeddingConfig().catch(() => ({ origen: null }));
    if (config.origen === "instancia") await updateInstanceEmbeddingTest(false, pool).catch(() => {});
    if (error?.status || /dimensiones|EMBEDDING_/i.test(error.message || "")) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    next(error);
  }
});

router.delete("/embeddings/config", async (_req, res, next) => {
  try {
    await deleteInstanceEmbeddingSettings(pool);
    invalidarEmbeddingsDeInstancia();
    await respuestaAjustes(res);
  } catch (error) { next(error); }
});

export default router;
