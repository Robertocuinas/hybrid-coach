import express from "express";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import crypto from "node:crypto";
import { createUser, findUserByEmail } from "../db/repositories/users.js";
import { createProfile, listProfilesByUser } from "../db/repositories/athleteProfiles.js";
import { createSession, revokeSession, selectProfile } from "../db/repositories/sessions.js";
import { packSessionCookie, requireAuth, readSessionToken, sessionCookieName, sessionTokenHash } from "../middleware/auth.js";

const router = express.Router();
const minPasswordLength = Number(process.env.PASSWORD_MIN_LENGTH || 12);
const ttlDays = Number(process.env.SESSION_TTL_DAYS || 30);
const registrationEnabled = process.env.REGISTRATION_ENABLED !== "false";
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: ttlDays * 86400_000 });
const argon2Options = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

async function startSession(res, user, profileId = null) {
  const token = crypto.randomBytes(32).toString("base64url");
  await createSession({ userId: user.id, tokenHash: sessionTokenHash(token), activeProfileId: profileId, expiresAt: new Date(Date.now() + ttlDays * 86400_000) });
  res.cookie(sessionCookieName, packSessionCookie(token), cookieOptions());
}

router.post("/register", async (req, res, next) => {
  try {
    if (!registrationEnabled) return res.status(403).json({ ok: false, message: "El registro de nuevas cuentas está cerrado" });
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, message: "Email no válido" });
    if (password.length < minPasswordLength) return res.status(400).json({ ok: false, message: `La contraseña debe tener al menos ${minPasswordLength} caracteres` });
    if (await findUserByEmail(email)) return res.status(409).json({ ok: false, message: "No se pudo crear la cuenta" });
    const role = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() === email ? "admin" : "athlete";
    const user = await createUser({ email, passwordHash: await hash(password, argon2Options), role });
    const profile = await createProfile(user.id, { nombre: String(req.body?.nombre || "").trim() || null });
    await startSession(res, user, profile.id);
    res.status(201).json({ ok: true, user: { id: user.id, email: user.email, role: user.role }, profile });
  } catch (error) { next(error); }
});

router.get("/registration-status", (_req, res) => {
  res.json({ ok: true, enabled: registrationEnabled });
});

router.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const user = await findUserByEmail(email);
    if (!user || !user.password_hash || !(await verify(user.password_hash, password, argon2Options))) return res.status(401).json({ ok: false, message: "Credenciales inválidas" });
    const profiles = await listProfilesByUser(user.id);
    await startSession(res, user, profiles[0]?.id || null);
    res.json({ ok: true, user: { id: user.id, email: user.email, role: user.role }, profiles });
  } catch (error) { next(error); }
});

router.post("/logout", async (req, res, next) => {
  try {
    const token = readSessionToken(req);
    if (token) await revokeSession(sessionTokenHash(token));
    res.clearCookie(sessionCookieName, cookieOptions());
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try { res.json({ ok: true, user: { id: req.auth.userId, role: req.auth.role }, profiles: await listProfilesByUser(req.auth.userId), activeProfileId: req.auth.athleteProfileId }); } catch (error) { next(error); }
});

router.post("/select-profile", requireAuth, async (req, res, next) => {
  try {
    const session = await selectProfile(req.auth.sessionId, req.auth.userId, req.body?.profileId);
    if (!session) return res.status(404).json({ ok: false, message: "Perfil no encontrado" });
    res.json({ ok: true, activeProfileId: session.active_profile_id });
  } catch (error) { next(error); }
});

export default router;
