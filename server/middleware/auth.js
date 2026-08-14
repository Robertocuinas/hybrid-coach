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
export const aiRateLimiter = rateLimit({
  windowMs: 60_000, limit: Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 10),
  standardHeaders: "draft-7", legacyHeaders: false, keyGenerator: accountKey,
  message: { ok: false, message: "Límite temporal de IA alcanzado." },
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
