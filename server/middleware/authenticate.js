import crypto from "node:crypto";
import { findActiveSession, touchSession } from "../db/repositories/sessions.js";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "hc_session";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const sign = (value) => crypto.createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("base64url");

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
    req.auth = { userId: session.user_id, role: session.role, sessionId: session.id, athleteProfileId: session.active_profile_id, token };
    void touchSession(session.id);
    next();
  } catch (error) { next(error); }
}

export const sessionTokenHash = hash;
export const sessionCookieName = COOKIE_NAME;
