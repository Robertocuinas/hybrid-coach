/**
 * Construcción de la aplicación Express.
 *
 * Separada de `server.js` para poder ejercitar el binario desde los tests de
 * integración sin levantar un puerto real (supertest u `app.listen(0)`). Toda
 * la inicialización que estaba en top-level — pool, embeddings, extractor PDF,
 * middlewares y routers — vive aquí, y `server.js` se queda como un bootstrap
 * mínimo que llama a `buildApp()` y pone a escuchar el puerto.
 *
 * `buildApp()` es async porque la configuración de embeddings y el extractor de
 * PDF hacen `await` al arrancar; sin async ese await sería top-level y obligaría
 * a `server.js` a esperarlo (igual de válido, pero más difícil de testear).
 *
 * Devuelve `{ app, llmProvider, embeddingConfig, toolRouterProvider,
 * legacyStravaConfig, embeddingsDegradados, extractorPDF }` para que los tests
 * o scripts externos puedan inspeccionar el estado sin re-leer process.env.
 */
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDatabaseStatus, describirErrorDb } from "./db/status.js";
import { isReady } from "./health.js";
import pool from "./db/pool.js";
import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import adminRoutes from "./routes/admin.js";
import coachRoutes from "./routes/coach.js";
import planningRoutes from "./routes/planning.js";
import evidenceRoutes from "./routes/evidence.js";
import exerciseRoutes from "./routes/exercises.js";
import foodRoutes from "./routes/foods.js";
import syncRoutes from "./routes/sync.js";
import aiSettingsRoutes from "./routes/ai-settings.js";
import { aiRateLimiter, loginRateLimiter, registrationRateLimiter, requireAuth, uploadRateLimiter } from "./middleware/auth.js";
import { requireTrustedOrigin, securityHeaders } from "./middleware/security.js";
import { createLLMProvider, createToolRouterProvider, readEmbeddingConfig } from "./ai/factory.js";
import { topeSalidaPeticion } from "./ai/limits.js";
import { resolveEmbeddingConfig } from "./ai/instance-embeddings.js";
import { resolveUserLLMProvider } from "./ai/user-provider.js";
import { getEmbeddingStatus, validateEmbeddingStartup } from "./embeddings/index-state.js";
import { readLegacyStravaConfig, requireLegacyStrava } from "./integrations/strava-config.js";
import { comprobarExtractor } from "./integrations/pdf-extractor.js";

export async function buildApp({ env = process.env } = {}) {
  /* ============================================================
     SUPERVIVENCIA DEL PROCESO — registrado una sola vez.
     Si los tests importan buildApp varias veces en el mismo proceso, los
     listeners se duplican y un error de pg acaba registrado dos veces. El
     flag global evita eso y se reinicia con _resetProcessListeners() cuando
     un test lo pide explícitamente.
     ============================================================ */
  if (!globalThis.__hybridCoachProcessListenersRegistered) {
    pool.on("error", (error) => {
      console.error("[db] conexión ociosa perdida:", error.code || error.name, describirErrorDb(error));
    });
    process.on("unhandledRejection", (reason) => {
      console.error("[proceso] promesa rechazada sin capturar:", reason?.code || reason?.name || "", String(reason?.message || reason).slice(0, 300));
    });
    globalThis.__hybridCoachProcessListenersRegistered = true;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const app = express();
  /* Railway y otros proxies ponen X-Forwarded-For. Sin esto, express-rate-limit
     no distingue a los usuarios reales y aplica el límite a la IP del proxy o lo
     rechaza (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR). `1` significa "un proxy de
     confianza por delante" (el de Railway), así el rate-limit usa la IP real. */
  app.set("trust proxy", 1);
  const legacyStravaConfig = readLegacyStravaConfig(env);
  const requireLegacyStravaEnabled = requireLegacyStrava(legacyStravaConfig);

  const {
    APPS_SCRIPT_URL,
    SHEET_ID,
    GOOGLE_SERVICE_ACCOUNT_JSON,
    STRAVA_CLIENT_ID,
    STRAVA_CLIENT_SECRET,
  } = env;

  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET es obligatoria y debe tener al menos 32 caracteres.");
  }
  function crearProveedorOpcional(nombre, factoria) {
    try { return factoria(); } catch (error) {
      console.error(`[arranque] ${nombre} desactivado por configuración incompleta:`, error.message);
      return null;
    }
  }
  const llmProvider = crearProveedorOpcional("IA", () => createLLMProvider(env));
  const embeddingConfig = await resolveEmbeddingConfig({ db: pool, env });
  const toolRouterProvider = crearProveedorOpcional("modelo local de enrutado", () => createToolRouterProvider(env));
  if (readEmbeddingConfig(env).enabled && !env.DATABASE_URL) {
    throw new Error("DATABASE_URL es obligatoria cuando los embeddings están activados.");
  }
  let embeddingsDegradados = null;
  try {
    await validateEmbeddingStartup(embeddingConfig, pool);
  } catch (error) {
    embeddingsDegradados = error.message;
    console.error("[arranque] embeddings degradados, se continúa sin búsqueda vectorial:", error.message);
  }

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
  app.get("/health", async (_req, res) => {
    const status = await checkDatabaseStatus();
    const opcional = (activa) => (activa ? "available" : "unavailable");
    const embeddingsAhora = await resolveEmbeddingConfig({ db: pool, env });
    res.status(status.db ? 200 : 503).json({
      status: status.db ? "ok" : "degraded",
      database: status.db ? "ok" : "error",
      services: {
        pgvector: opcional(status.pgvector),
        ia: opcional(!!llmProvider),
        embeddings: opcional(embeddingsAhora.enabled),
        alimentos: opcional(!!env.FOOD_PROVIDER && env.FOOD_PROVIDER !== "ninguno"),
        ejercicios: opcional(!!env.EXERCISE_PROVIDER),
        extractorPdf: opcional(!!extractorPDF.ok),
      },
    });
  });
  app.get("/api/estado", async (_req, res) => {
    const dbStatus = await checkDatabaseStatus();
    const embeddings = await getEmbeddingStatus(await resolveEmbeddingConfig({ db: pool, env }), pool);
    const localModelHealth = toolRouterProvider ? await toolRouterProvider.health() : { ready: false, version: null };
    res.json({
      ok: true,
      requiereLogin: true,
      ia: !!llmProvider,
      hoja: !!(APPS_SCRIPT_URL || (SHEET_ID && GOOGLE_SERVICE_ACCOUNT_JSON)),
      strava: legacyStravaConfig.enabled,
      db: dbStatus.db,
      pgvector: dbStatus.pgvector,
      embeddings: { ...embeddings, degradados: embeddings.ok ? null : (embeddings.reason || embeddingsDegradados || null) },
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

  /* Ruta heredada /api/entrar: handler 410 explícito. Va ANTES de cualquier
     `app.use("/api", ...)` (sync, api, planning...) porque todos llevan
     requireAuth y capturarían la petición devolviendo 401 en lugar del 410
     que documenta "usa /api/auth/login". Bug detectado al añadir el smoke test
     del binario: el código original registraba este handler DESPUÉS de los
     routers autenticados, así que NUNCA devolvió 410 — siempre 401. */
  app.post("/api/entrar", (_req, res) => res.status(410).json({ ok: false, message: "Usa /api/auth/login" }));

  app.use("/api/auth/login", loginRateLimiter);
  app.use("/api/auth/register", registrationRateLimiter);
  app.use("/api/auth", authRoutes);
  app.use("/auth/login", loginRateLimiter);
  app.use("/auth/register", registrationRateLimiter);
  app.use("/auth", authRoutes);
  app.use("/api", syncRoutes);
  app.use("/api/ai/settings", aiSettingsRoutes);
  app.use("/api/admin/documents/upload", uploadRateLimiter);
  app.use("/api/admin", adminRoutes);
  app.use("/api/planning", planningRoutes);
  app.use("/api/coach", coachRoutes);
  app.use("/api/evidence", evidenceRoutes);
  app.use("/api/exercises", exerciseRoutes);
  app.use("/api/foods", foodRoutes);

  app.use("/api", apiRoutes);

  {
    const wgAssets = path.join(__dirname, "..", "node_modules", "@bryllim", "workout-guide", "assets");
    app.use("/assets/ejercicios", express.static(wgAssets, {
      index: false,
      fallthrough: false,
      maxAge: "7d",
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "public, max-age=604800");
        res.setHeader("X-Content-Type-Options", "nosniff");
      },
    }));
  }

  app.post("/api/ia", requireAuth, aiRateLimiter, async (req, res) => {
    try {
      const provider = await resolveUserLLMProvider(req.auth.userId, { fallbackProvider: llmProvider });
      if (!provider) {
        return res.status(503).json({ ok: false, message: "Configura GPT o Claude en Ajustes para activar la IA." });
      }
      const result = await provider.call({
        system: req.body?.system,
        messages: req.body?.messages || [],
        maxTokens: topeSalidaPeticion(req.body?.max_tokens),
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

  // ===== GOOGLE SHEETS =====
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

  // ===== STRAVA =====
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

  app.use((error, req, res, _next) => {
    const requested = Number(error.status);
    const status = error.code === "23505" ? 409
      : Number.isInteger(requested) && requested >= 400 && requested < 600 ? requested
        : 500;
    if (status >= 400) {
      const ruta = String(req.originalUrl || req.url || "").split("?")[0].slice(0, 120);
      console.error("Error API:", req.method, ruta, status, error?.name, error?.code || "", error?.publicMessage || error?.message || "", "\n", error?.stack || error);
    }
    const postgresError = /^[0-9A-Z]{5}$/.test(String(error.code || ""));
    const safeMessage = error.publicMessage
      || (error.code === "23505" ? "El registro ya existe"
        : status < 500 && error.message && !postgresError ? error.message
          : status === 409 ? "La operación entra en conflicto con el estado actual" : "Error interno");
    res.status(status).json({ ok: false, message: safeMessage, ...(error.publicCode ? { code: error.publicCode } : {}) });
  });

  app.use(express.static(path.join(__dirname, "..", "public"), {
    index: false,
    setHeaders: (res, filePath) => {
      res.setHeader("Cache-Control", filePath.endsWith("app.js") ? "no-cache" : "public, max-age=3600");
    },
  }));
  app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

  return {
    app,
    llmProvider,
    embeddingConfig,
    toolRouterProvider,
    legacyStravaConfig,
    embeddingsDegradados,
    extractorPDF,
    pool,
  };
}