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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const {
  ANTHROPIC_API_KEY,
  APPS_SCRIPT_URL,
  SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_JSON,
  APP_PASSWORD,
  STRAVA_CLIENT_ID,
  STRAVA_CLIENT_SECRET,
  MODELO_IA = "claude-sonnet-4-6",
} = process.env;

app.use(express.json({ limit: "2mb" }));
app.disable("x-powered-by");

/* ============================================================
   CONTRASEÑA COMPARTIDA (opcional)
   Sin ella, cualquiera con la dirección entra y escribe en tu hoja.
   Con ella, el navegador guarda el pase y no vuelve a pedirlo.
   No es un sistema de cuentas: es una puerta, no una cerradura seria.
   ============================================================ */
function autorizado(req) {
  if (!APP_PASSWORD) return true;
  const c = (req.headers.cookie || "").match(/hc_pase=([^;]+)/);
  return (c && c[1] === APP_PASSWORD) || req.headers["x-hc-pase"] === APP_PASSWORD;
}

app.post("/api/entrar", (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true });
  if (req.body?.pase !== APP_PASSWORD) return res.status(401).json({ ok: false, message: "Contraseña incorrecta" });
  res.setHeader("Set-Cookie", `hc_pase=${APP_PASSWORD}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
  res.json({ ok: true });
});

app.get("/api/estado", async (req, res) => {
  const dbStatus = await checkDatabaseStatus();
  res.json({
    ok: true,
    requierePase: !!APP_PASSWORD,
    dentro: autorizado(req),
    ia: !!ANTHROPIC_API_KEY,
    hoja: !!(APPS_SCRIPT_URL || (SHEET_ID && GOOGLE_SERVICE_ACCOUNT_JSON)),
    strava: !!(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET),
    db: dbStatus.db,
    pgvector: dbStatus.pgvector,
  });
});

const puerta = (req, res, next) => autorizado(req)
  ? next()
  : res.status(401).json({ ok: false, message: "Necesitas la contraseña de acceso" });

/* ============================================================
   IA — la clave se queda aquí
   ============================================================ */
app.post("/api/ia", puerta, async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ ok: false, message: "Este servidor no tiene clave de IA. La aplicación sigue funcionando sin ella." });
  }
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.body?.model || MODELO_IA,
        max_tokens: Math.min(+req.body?.max_tokens || 1400, 4000),
        system: req.body?.system,
        messages: req.body?.messages || [],
      }),
    });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(502).json({ ok: false, message: "No se pudo hablar con la API: " + e.message });
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

app.post("/api/sheets", puerta, async (req, res) => {
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

app.get("/api/sheets", puerta, async (req, res) => {
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

app.get("/api/strava/entrar", puerta, (req, res) => {
  if (!STRAVA_CLIENT_ID) return res.status(503).send("Strava no está configurado en este servidor.");
  const vuelta = `${req.protocol}://${req.get("host")}/api/strava/vuelta`;
  res.redirect("https://www.strava.com/oauth/authorize"
    + `?client_id=${STRAVA_CLIENT_ID}&response_type=code`
    + `&redirect_uri=${encodeURIComponent(vuelta)}`
    + "&approval_prompt=auto&scope=activity:read_all");
});

app.get("/api/strava/vuelta", async (req, res) => {
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

app.get("/api/strava/actividades", puerta, async (req, res) => {
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
  console.log(`  IA:     ${ANTHROPIC_API_KEY ? "configurada" : "sin clave (la app funciona igual)"}`);
  console.log(`  Hoja:   ${APPS_SCRIPT_URL ? "vía Apps Script" : SHEET_ID && GOOGLE_SERVICE_ACCOUNT_JSON ? "vía cuenta de servicio" : "sin configurar"}`);
  console.log(`  Strava: ${STRAVA_CLIENT_ID ? "configurado" : "sin configurar"}`);
  console.log(`  Acceso: ${APP_PASSWORD ? "con contraseña" : "ABIERTO — cualquiera con la dirección entra"}`);
});
