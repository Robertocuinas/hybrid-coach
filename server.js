/**
 * HYBRID COACH — servidor para Railway
 *
 * Hace cuatro cosas:
 *   1. Sirve la aplicación compilada.
 *   2. Proxy de la API de Anthropic, con la clave SIEMPRE en el servidor.
 *   3. Puente a Google Sheets (por Apps Script o por cuenta de servicio).
 *   4. OAuth e importación de Strava.
 *
 * Todo es opcional salvo el punto 1: sin claves configuradas la aplicación
 * funciona igual, solo pierde la capa de IA y el respaldo en la hoja.
 */

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDatabaseStatus } from "./server/db/status.js";
import { isReady } from "./server/health.js";
import pool from "./server/db/pool.js";
import authRoutes from "./server/routes/auth.js";
import apiRoutes from "./server/routes/api.js";
import adminRoutes from "./server/routes/admin.js";
import coachRoutes from "./server/routes/coach.js";
import planningRoutes from "./server/routes/planning.js";
import evidenceRoutes from "./server/routes/evidence.js";
import exerciseRoutes from "./server/routes/exercises.js";
import foodRoutes from "./server/routes/foods.js";
import syncRoutes from "./server/routes/sync.js";
import aiSettingsRoutes from "./server/routes/ai-settings.js";
import { startReconciliationJob } from "./server/jobs/reconciliation.js";
import { aiRateLimiter, loginRateLimiter, registrationRateLimiter, requireAuth, uploadRateLimiter } from "./server/middleware/auth.js";
import { requireTrustedOrigin, securityHeaders } from "./server/middleware/security.js";
import { createLLMProvider, createToolRouterProvider, readEmbeddingConfig } from "./server/ai/factory.js";
import { resolveEmbeddingConfig } from "./server/ai/instance-embeddings.js";
import { resolveUserLLMProvider } from "./server/ai/user-provider.js";
import { getEmbeddingStatus, validateEmbeddingStartup } from "./server/embeddings/index-state.js";
import { readLegacyStravaConfig, requireLegacyStrava } from "./server/integrations/strava-config.js";
import { comprobarExtractor } from "./server/integrations/pdf-extractor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const legacyStravaConfig = readLegacyStravaConfig(process.env);
const requireLegacyStravaEnabled = requireLegacyStrava(legacyStravaConfig);

const {
  APPS_SCRIPT_URL,
  SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_JSON,
  STRAVA_CLIENT_ID,
  STRAVA_CLIENT_SECRET,
} = process.env;

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET es obligatoria y debe tener al menos 32 caracteres.");
}
const llmProvider = createLLMProvider(process.env);
/* La configuración de embeddings puede venir de la base de datos (ajuste de
   instancia editable desde la aplicación) o del entorno. Se resuelve aquí para
   que la validación de arranque compruebe la que se va a usar de verdad. */
const embeddingConfig = await resolveEmbeddingConfig({ db: pool, env: process.env });
const toolRouterProvider = createToolRouterProvider(process.env);
if (readEmbeddingConfig(process.env).enabled && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL es obligatoria cuando los embeddings están activados.");
}
await validateEmbeddingStartup(embeddingConfig, pool);

/* El extractor de PDF se comprueba UNA vez al arrancar y se cachea. Es lo
   primero que hay que saber antes de ingerir bibliografía —sin Python o sin
   PyMuPDF no entra ni un documento— y hasta ahora solo se veía desde el panel
   de administración, con sesión de admin.

   Cacheado y no bajo demanda a propósito: `comprobarExtractor()` lanza un
   subproceso, y exponer eso en un endpoint sin autenticar sería un vector de
   saturación trivial. */
const extractorPDF = await comprobarExtractor().catch((error) => ({ ok: false, motivo: error.message }));

app.use(express.json({ limit: "2mb" }));
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(requireTrustedOrigin);
app.get("/health/live", (_req, res) => res.json({ ok: true }));
app.get("/health/ready", async (_req, res) => {
  const status = await checkDatabaseStatus();
  const ready = isReady(status);
  res.status(ready ? 200 : 503).json({ ok: ready, db: status.db, pgvector: status.pgvector });
});
app.get("/api/estado", async (_req, res) => {
  const dbStatus = await checkDatabaseStatus();
  const embeddings = await getEmbeddingStatus(embeddingConfig, pool);
  const localModelHealth = toolRouterProvider ? await toolRouterProvider.health() : { ready: false, version: null };
  res.json({
    ok: true,
    requiereLogin: true,
    ia: !!llmProvider,
    hoja: !!(APPS_SCRIPT_URL || (SHEET_ID && GOOGLE_SERVICE_ACCOUNT_JSON)),
    strava: legacyStravaConfig.enabled,
    db: dbStatus.db,
    pgvector: dbStatus.pgvector,
    embeddings,
    /* Estado del extractor sin exponer rutas ni versiones del sistema: solo si
       se puede ingerir bibliografía y, si no, por qué. */
    extractorPdf: { ok: !!extractorPDF.ok, motivo: extractorPDF.ok ? null : extractorPDF.motivo || null },
    localModel: {
      enabled: !!toolRouterProvider,
      provider: toolRouterProvider ? "needle" : null,
      purpose: toolRouterProvider ? "tool-routing" : null,
      ready: localModelHealth.ready,
      version: localModelHealth.version,
    },
  });
});
app.use("/api/auth/login", loginRateLimiter);
app.use("/api/auth/register", registrationRateLimiter);
app.use("/api/auth", authRoutes);
app.use("/auth/login", loginRateLimiter);
app.use("/auth/register", registrationRateLimiter);
app.use("/auth", authRoutes);
app.use("/api", syncRoutes);
app.use("/api/ai/settings", aiSettingsRoutes);
/* Antes que apiRoutes: /api/admin/* tiene su propio parseo de cuerpo binario
   y no debe caer en los manejadores JSON genéricos. */
app.use("/api/admin/documents/upload", uploadRateLimiter);
app.use("/api/admin", adminRoutes);
app.use("/api/planning", aiRateLimiter, planningRoutes);
app.use("/api/coach", aiRateLimiter, coachRoutes);
app.use("/api/evidence", evidenceRoutes);
app.use("/api/exercises", exerciseRoutes);
app.use("/api/foods", foodRoutes);
app.use("/api", apiRoutes);

/* La ruta heredada /api/entrar devuelve 410; no existe fallback de contraseña compartida. */
app.post("/api/entrar", (_req, res) => res.status(410).json({ ok: false, message: "Usa /api/auth/login" }));

/* ============================================================
   IA — la clave se queda aquí
   ============================================================ */
app.post("/api/ia", requireAuth, aiRateLimiter, async (req, res) => {
  try {
    const provider = await resolveUserLLMProvider(req.auth.userId, { fallbackProvider: llmProvider });
    if (!provider) {
      return res.status(503).json({ ok: false, message: "Configura GPT o Claude en Ajustes para activar la IA." });
    }
    const result = await provider.call({
      system: req.body?.system,
      messages: req.body?.messages || [],
      maxTokens: Math.min(+req.body?.max_tokens || 1400, 4000),
      temperature: req.body?.temperature,
      responseFormat: req.body?.response_format,
      stopSequences: req.body?.stop_sequences,
    });
    res.json(result);
  } catch (e) {
    const status = e.status >= 400 && e.status < 600 ? e.status : 502;
    res.status(status).json({ ok: false, message: e.message || "No se pudo hablar con el proveedor de IA" });
  }
});

/* ============================================================
   GOOGLE SHEETS
   Dos caminos. Si tienes Apps Script desplegado (lo normal), el servidor
   reenvía ahí y no hace falta nada más. Si prefieres saltártelo, con una
   cuenta de servicio el servidor escribe directamente en la hoja.
   ============================================================ */
let sheetsApi = null;
async function conectarSheets() {
  if (sheetsApi) return sheetsApi;
  if (!SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  const { google } = await import("googleapis");
  const cred = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.JWT({
    email: cred.client_email,
    key: cred.private_key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsApi = google.sheets({ version: "v4", auth });
  return sheetsApi;
}

/* Hojas que son un ESTADO, no un historial: se sustituyen las filas de ese
   perfil en vez de acumular. Si no, cada edición de rutina dejaría un rastro
   de versiones viejas que nadie va a limpiar.                                */
const HOJAS_ESTADO = ["Rutinas", "Ejercicios_Propios", "Decisiones_Plan", "Perfiles", "Nutricion_Catalogo", "Nutricion_Config"];

app.post("/api/sheets", requireAuth, async (req, res) => {
  const { sheet, rows = [], perfil } = req.body || {};
  if (!sheet) return res.status(400).json({ ok: false, message: "Falta el nombre de la hoja" });

  if (APPS_SCRIPT_URL) {
    try {
      const r = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "append", sheet, rows, perfil, estado: HOJAS_ESTADO.includes(sheet) }),
        redirect: "follow",
      });
      const t = await r.text();
      try { return res.json(JSON.parse(t)); } catch { return res.json({ ok: r.ok, message: t.slice(0, 200) }); }
    } catch (e) {
      return res.status(502).json({ ok: false, message: "Apps Script no respondió: " + e.message });
    }
  }

  const api = await conectarSheets();
  if (!api) return res.json({ ok: false, message: "Este servidor no tiene hoja configurada" });

  try {
    const cab = (await api.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheet}!1:1` }))
      .data.values?.[0];
    if (!cab) return res.json({ ok: false, message: `La hoja "${sheet}" no existe o no tiene cabecera` });

    const filas = rows.map((row) => cab.map((h) => (row[h] === undefined || row[h] === null ? "" : row[h])));

    if (HOJAS_ESTADO.includes(sheet) && perfil) {
      const todo = (await api.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: sheet })).data.values || [];
      const iPerfil = cab.indexOf("perfil");
      const otros = todo.slice(1).filter((r) => iPerfil < 0 || String(r[iPerfil]) !== String(perfil));
      await api.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${sheet}!A2:ZZ` });
      const juntas = [...otros, ...filas];
      if (juntas.length) {
        await api.spreadsheets.values.update({
          spreadsheetId: SHEET_ID, range: `${sheet}!A2`,
          valueInputOption: "RAW", requestBody: { values: juntas },
        });
      }
      return res.json({ ok: true, message: `${filas.length} filas actualizadas en ${sheet}` });
    }

    if (filas.length) {
      await api.spreadsheets.values.append({
        spreadsheetId: SHEET_ID, range: sheet,
        valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
        requestBody: { values: filas },
      });
    }
    res.json({ ok: true, message: `${filas.length} filas escritas en ${sheet}` });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Error escribiendo en la hoja: " + e.message });
  }
});

app.get("/api/sheets", requireAuth, async (req, res) => {
  const sheet = req.query.sheet;
  if (!sheet) return res.status(400).json({ ok: false, message: "Falta el parámetro sheet" });
  if (APPS_SCRIPT_URL) {
    const r = await fetch(`${APPS_SCRIPT_URL}?action=read&sheet=${encodeURIComponent(sheet)}`, { redirect: "follow" });
    return res.json(await r.json());
  }
  const api = await conectarSheets();
  if (!api) return res.json({ ok: false, rows: [] });
  const v = (await api.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: sheet })).data.values || [];
  const cab = v.shift() || [];
  res.json({ ok: true, rows: v.map((r) => Object.fromEntries(cab.map((h, i) => [h, r[i] ?? ""]))) });
});

/* ============================================================
   STRAVA
   El secreto vive aquí. La aplicación nunca lo ve.
   ============================================================ */
const strava = { refresh: null, access: null, expira: 0 };

app.get("/api/strava/entrar", requireAuth, requireLegacyStravaEnabled, (req, res) => {
  const vuelta = `${req.protocol}://${req.get("host")}/api/strava/vuelta`;
  res.redirect("https://www.strava.com/oauth/authorize"
    + `?client_id=${STRAVA_CLIENT_ID}&response_type=code`
    + `&redirect_uri=${encodeURIComponent(vuelta)}`
    + "&approval_prompt=auto&scope=activity:read_all");
});

app.get("/api/strava/vuelta", requireLegacyStravaEnabled, async (req, res) => {
  try {
    const r = await fetch("https://www.strava.com/oauth/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET,
        code: req.query.code, grant_type: "authorization_code",
      }),
    });
    const d = await r.json();
    if (!d.refresh_token) return res.status(400).send("Strava no autorizó: " + JSON.stringify(d));
    strava.refresh = d.refresh_token; strava.access = d.access_token; strava.expira = d.expires_at;
    res.send("<p style='font-family:sans-serif'>Strava conectado. Ya puedes cerrar esta pestaña.</p>");
  } catch (e) {
    res.status(500).send("Error: " + e.message);
  }
});

async function tokenStrava() {
  if (strava.access && strava.expira > Date.now() / 1000 + 120) return strava.access;
  if (!strava.refresh) throw new Error("Strava no está autorizado todavía");
  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: strava.refresh, grant_type: "refresh_token",
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("No se pudo refrescar el token");
  strava.access = d.access_token; strava.expira = d.expires_at;
  if (d.refresh_token) strava.refresh = d.refresh_token;
  return d.access_token;
}

app.get("/api/strava/actividades", requireAuth, requireLegacyStravaEnabled, async (req, res) => {
  try {
    const desde = req.query.desde || "2026-01-01";
    const after = Math.floor(new Date(desde + "T00:00:00Z").getTime() / 1000);
    const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=50`,
      { headers: { Authorization: "Bearer " + (await tokenStrava()) } });
    const acts = await r.json();
    if (!Array.isArray(acts)) return res.status(502).json({ ok: false, message: JSON.stringify(acts).slice(0, 200) });
    res.json({
      ok: true,
      actividades: acts.filter((a) => /run|ride/i.test(a.type)).map((a) => ({
        id: a.id, fecha: a.start_date_local.slice(0, 10), nombre: a.name, tipo: a.type,
        km: +(a.distance / 1000).toFixed(2), min: Math.round(a.moving_time / 60),
        fc_media: a.average_heartrate || "", fc_max: a.max_heartrate || "",
        desnivel: a.total_elevation_gain || "",
        cadencia: a.average_cadence ? Math.round(a.average_cadence * 2) : "",
      })),
    });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
});

app.use((error, _req, res, _next) => {
  const requested = Number(error.status);
  const status = error.code === "23505" ? 409
    : Number.isInteger(requested) && requested >= 400 && requested < 600 ? requested
      : 500;
  if (status === 500) console.error("Error interno de API:", error.name, error.code || "");
  const postgresError = /^[0-9A-Z]{5}$/.test(String(error.code || ""));
  const safeMessage = error.publicMessage
    || (error.code === "23505" ? "El registro ya existe"
      : status < 500 && error.message && !postgresError ? error.message
        : status === 409 ? "La operación entra en conflicto con el estado actual" : "Error interno");
  res.status(status).json({ ok: false, message: safeMessage, ...(error.publicCode ? { code: error.publicCode } : {}) });
});

/* ============================================================
   LA APLICACIÓN
   ============================================================ */
/* Sin caché fuerte en app.js: si no, un redeploy tarda hasta una hora en verse
   porque el navegador sigue sirviendo el bundle anterior desde su propia caché.
   El resto de estáticos (manifest, iconos) sí pueden cachearse tranquilamente. */
app.use(express.static(path.join(__dirname, "public"), {
  index: false,
  setHeaders: (res, filePath) => {
    res.setHeader("Cache-Control", filePath.endsWith("app.js") ? "no-cache" : "public, max-age=3600");
  },
}));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hybrid Coach escuchando en el puerto ${PORT}`);
  console.log(`  IA:     ${llmProvider ? `${process.env.LLM_PROVIDER}/${process.env.LLM_MODEL}` : "sin proveedor (la app funciona igual)"}`);
  console.log(`  Embed:  ${embeddingConfig.enabled ? `${embeddingConfig.provider}/${embeddingConfig.model} (${embeddingConfig.dimensions}d, ${embeddingConfig.origen})` : "desactivados"}`);
  console.log(`  Local:  ${toolRouterProvider ? "needle/tool-routing" : "desactivado"}`);
  console.log(`  Hoja:   ${APPS_SCRIPT_URL ? "vía Apps Script" : SHEET_ID && GOOGLE_SERVICE_ACCOUNT_JSON ? "vía cuenta de servicio" : "sin configurar"}`);
  console.log(`  Strava: ${legacyStravaConfig.enabled ? "legacy monousuario activo" : legacyStravaConfig.credentialsConfigured ? "credenciales presentes, legacy bloqueado" : "sin configurar"}`);
  console.log("  Acceso: sesiones autenticadas");
});

if (process.env.DATABASE_URL && process.env.RECONCILIATION_ENABLED !== "false" && process.env.RECONCILIATION_MODE !== "external") {
  startReconciliationJob();
}
