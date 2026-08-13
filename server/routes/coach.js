/* Rutas del coach con RAG (Fase 8). Todo exige sesión y perfil activo: el
   perfil sale de la sesión autenticada, NUNCA de un parámetro de la petición
   (docs/03-modelo-datos.md §11). */
import express from "express";
import { pool } from "../db/repositories/_helpers.js";
import * as documentsRepo from "../db/repositories/documents.js";
import { requireAuth } from "../middleware/auth.js";
import { requireActiveProfile } from "../middleware/authorization.js";
import { createEmbeddingProvider, createLLMProvider, createRerankProvider, createToolRouterProvider, readEmbeddingConfig, readRAGConfig } from "../ai/factory.js";
import { responder } from "../domain/coach/chat.js";
import { decisionesIA } from "../domain/coach/decisiones.js";
import { listarDecisionesConCitas } from "../db/repositories/trainingPlans.js";
import { listConversationsByProfile } from "../db/repositories/aiConversations.js";
import { compararSistemas, PREGUNTAS_COMPARACION } from "../domain/coach/comparacion.js";
import { COACH_LOCAL_TOOLS, NEEDLE_SYSTEM_PROMPT } from "../domain/coach/local-tools.js";

const router = express.Router();
router.use(requireAuth, requireActiveProfile);

/* Los proveedores se crean una sola vez por proceso. */
const perezoso = (fabrica) => {
  let valor = null, iniciado = false;
  return () => {
    if (!iniciado) { try { valor = fabrica(); } catch { valor = null; } iniciado = true; }
    return valor;
  };
};
const getLLM = perezoso(() => createLLMProvider());
const getEmbeddings = perezoso(() => createEmbeddingProvider());
const getRerank = perezoso(() => createRerankProvider());
const getToolRouter = perezoso(() => createToolRouterProvider());

function dependencias() {
  const embeddingConfig = readEmbeddingConfig();
  return {
    db: pool,
    repo: documentsRepo,
    llmProvider: getLLM(),
    embeddingProvider: getEmbeddings(),
    rerankProvider: getRerank(),
    indice: embeddingConfig.enabled
      ? { provider: embeddingConfig.provider, model: embeddingConfig.model, dimensions: embeddingConfig.dimensions }
      : null,
    config: readRAGConfig(),
  };
}

const perfil = (req) => req.auth.athleteProfileId;

/* Diagnóstico y clasificación local. Needle nunca recibe ni acepta un
   athlete_profile_id del cliente y no ejecuta la herramienta elegida. */
router.post("/route", async (req, res, next) => {
  try {
    const consulta = String(req.body?.consulta || "").trim().slice(0, 1000);
    if (!consulta) return res.status(400).json({ ok: false, message: "Falta la consulta" });
    const provider = getToolRouter();
    if (!provider) return res.status(503).json({ ok: false, message: "Needle local no está configurado" });
    const route = await provider.route(consulta, COACH_LOCAL_TOOLS, { system: NEEDLE_SYSTEM_PROMPT });
    res.json({ ok: true, route });
  } catch (error) { next(error); }
});

router.post("/chat", async (req, res, next) => {
  try {
    const consulta = String(req.body?.consulta || "").trim();
    if (!consulta) return res.status(400).json({ ok: false, message: "Falta la consulta" });
    const deps = dependencias();
    if (!deps.llmProvider) return res.status(503).json({ ok: false, message: "Este servidor no tiene proveedor de IA configurado" });

    const salida = await responder(perfil(req), consulta, { ...deps, conversationId: req.body?.conversationId || null });
    res.json({ ok: true, ...salida });
  } catch (error) { next(error); }
});

router.post("/decisiones", async (req, res, next) => {
  try {
    const deps = dependencias();
    if (!deps.llmProvider) return res.status(503).json({ ok: false, message: "Este servidor no tiene proveedor de IA configurado" });
    const salida = await decisionesIA(perfil(req), { ...deps, persistir: req.body?.persistir !== false });
    res.json({ ok: true, ...salida });
  } catch (error) { next(error); }
});

/* Decisiones ya guardadas con sus citas resueltas (texto, página, DOI): es lo
   que la UI necesita para el "Ver evidencia" de la Fase 9. */
router.get("/decisiones", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM training_plans WHERE athlete_profile_id = $1 AND activo = true ORDER BY generado_en DESC LIMIT 1;`,
      [perfil(req)]
    );
    if (!rows[0]) return res.json({ ok: true, decisiones: [] });
    res.json({ ok: true, decisiones: await listarDecisionesConCitas(rows[0].id) });
  } catch (error) { next(error); }
});

router.get("/conversations", async (req, res, next) => {
  try { res.json({ ok: true, conversations: await listConversationsByProfile(perfil(req)) }); }
  catch (error) { next(error); }
});

router.get("/conversations/:id/messages", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.role, m.contenido, m.cambio_propuesto, m.citas, m.created_at
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = $1 AND c.athlete_profile_id = $2
        ORDER BY m.created_at;`,
      [req.params.id, perfil(req)]
    );
    const { rows: conv } = await pool.query(
      `SELECT resumen FROM conversations WHERE id = $1 AND athlete_profile_id = $2;`, [req.params.id, perfil(req)]);
    if (!conv[0]) return res.status(404).json({ ok: false, message: "Conversación no encontrada" });
    res.json({ ok: true, resumen: conv[0].resumen, messages: rows });
  } catch (error) { next(error); }
});

/* Ejecución en paralelo: mismas preguntas contra el sistema nuevo (RAG) y el
   anterior (selección léxica sobre fichas). Sirve para detectar regresiones
   ANTES de apagar el viejo, que es el riesgo principal de esta fase. */
router.post("/comparar", async (req, res, next) => {
  try {
    const deps = dependencias();
    const preguntas = Array.isArray(req.body?.preguntas) && req.body.preguntas.length
      ? req.body.preguntas.map((p) => String(p).slice(0, 300))
      : PREGUNTAS_COMPARACION;
    res.json({ ok: true, ...(await compararSistemas(perfil(req), preguntas, deps)) });
  } catch (error) { next(error); }
});

export default router;
