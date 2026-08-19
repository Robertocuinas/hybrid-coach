import crypto from "node:crypto";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { findActiveSession, touchSession } from "../db/repositories/sessions.js";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "hc_session";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const sign = (value) => crypto.createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("base64url");

export const sessionCookieName = COOKIE_NAME;
export const sessionTokenHash = hash;
export const packSessionCookie = (token) => `${token}.${sign(token)}`;

export function readSessionToken(req) {
  const cookies = Object.fromEntries((req.headers.cookie || "").split(";").map((entry) => {
    const i = entry.indexOf("=");
    return i < 0 ? ["", ""] : [entry.slice(0, i).trim(), decodeURIComponent(entry.slice(i + 1))];
  }));
  const packed = cookies[COOKIE_NAME];
  if (!packed) return null;
  const dot = packed.lastIndexOf(".");
  if (dot < 1) return null;
  const token = packed.slice(0, dot);
  const signature = packed.slice(dot + 1);
  const expected = sign(token);
  if (signature.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? token : null;
}

export async function requireAuth(req, res, next) {
  try {
    const token = readSessionToken(req);
    if (!token) return res.status(401).json({ ok: false, message: "Autenticación requerida" });
    const session = await findActiveSession(hash(token));
    if (!session) return res.status(401).json({ ok: false, message: "Sesión no válida o caducada" });
    req.auth = { userId: session.user_id, role: session.role, sessionId: session.id, athleteProfileId: session.active_profile_id };
    void touchSession(session.id);
    next();
  } catch (error) { next(error); }
}

export const loginRateLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_LOGIN_WINDOW_MINUTES || 15) * 60_000,
  limit: Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 5),
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { ok: false, message: "Demasiados intentos. Inténtalo más tarde." },
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || "").trim().toLowerCase()}`,
});

const accountKey = (req) => req.auth?.userId || ipKeyGenerator(req.ip);
export const registrationRateLimiter = rateLimit({
  windowMs: 60 * 60_000, limit: 5, standardHeaders: "draft-7", legacyHeaders: false,
  message: { ok: false, message: "Demasiadas altas desde esta red. Inténtalo más tarde." },
});
/* Protege el bolsillo del dueño de la clave y evita que un bucle del cliente
   dispare llamadas de pago en cadena; no es una restricción de producto. Por eso
   se puede subir, y APAGAR del todo con AI_RATE_LIMIT_PER_MINUTE=0, que es lo
   razonable en una instancia de un solo usuario con su propia clave.

   Sube de 10 a 30: 10 por minuto se quedaba corto en cuanto reintentabas una
   generación un par de veces seguidas. */
export function leerLimiteIA(env = process.env) {
  const bruto = Number(env.AI_RATE_LIMIT_PER_MINUTE ?? 30);
  /* Se desactiva con `skip` y NO poniendo limit a 0: desde express-rate-limit v7
     un límite de 0 no significa "sin límite" sino "bloquea todo", y el proyecto
     va por la v8. Ponerlo a 0 para abrir la mano habría cerrado la IA entera. */
  const desactivado = !Number.isFinite(bruto) || bruto <= 0;
  return { desactivado, limite: desactivado ? 1000 : Math.floor(bruto) };
}

const limiteIA = leerLimiteIA();
export const aiRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: limiteIA.limite,
  skip: () => limiteIA.desactivado,
  standardHeaders: "draft-7", legacyHeaders: false, keyGenerator: accountKey,
  message: { ok: false, message: "Has hecho muchas peticiones de IA seguidas. Espera un minuto o sube AI_RATE_LIMIT_PER_MINUTE." },
});
/* 60/hora y no 10: la subida es solo para admins, así que no protege de un
   abuso externo sino del propio servidor, y con 10 no cabía ni una tanda
   pequeña de bibliografía. Para lotes de verdad está `npm run biblio:ingest`,
   que no pasa por HTTP y por tanto tampoco por aquí. */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60_000, limit: Number(process.env.UPLOAD_RATE_LIMIT_PER_HOUR || 60),
  standardHeaders: "draft-7", legacyHeaders: false, keyGenerator: accountKey,
  message: { ok: false, message: "Límite temporal de subidas alcanzado." },
});
