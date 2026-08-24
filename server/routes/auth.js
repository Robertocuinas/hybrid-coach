import express from "express";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import crypto from "node:crypto";
import pool from "../db/pool.js";
import { exportUserData } from "../domain/account/export.js";
import { createUser, findUserByEmail } from "../db/repositories/users.js";
import { createProfile, listProfilesByUser } from "../db/repositories/athleteProfiles.js";
import { createSession, revokeSession, selectProfile } from "../db/repositories/sessions.js";
import { packSessionCookie, requireAuth, readSessionToken, sessionCookieName, sessionTokenHash } from "../middleware/auth.js";

const router = express.Router();
const minPasswordLength = Number(process.env.PASSWORD_MIN_LENGTH || 12);
const ttlDays = Number(process.env.SESSION_TTL_DAYS || 30);
/* La aplicación es multiusuario: si Railway no define la variable, una persona
   nueva debe poder crear su cuenta. El operador puede cerrar las altas de
   forma explícita; un valor desconocido se trata como cerrado para que un typo
   de configuración no abra el registro accidentalmente. */
export function isPublicRegistrationEnabled(value) {
  if (value == null || String(value).trim() === "") return true;
  return String(value).trim().toLowerCase() === "true";
}
const registrationEnabled = isPublicRegistrationEnabled(process.env.REGISTRATION_ENABLED);
/* El flag `Secure` de la cookie de sesión no depende de NODE_ENV: antes
   valía `process.env.NODE_ENV === "production"`, y como esa variable no
   estaba documentada en ningún despliegue, quien seguía .env.example tenía
   la cookie viajando sin `Secure`. Ahora `Secure` está activo salvo opt-out
   explícito en desarrollo local (COOKIE_SECURE=false), de modo que producción
   siempre cifra la cookie por transporte. */
const cookieSecure = String(process.env.COOKIE_SECURE ?? "true").toLowerCase() !== "false";
const cookieSecurityOptions = () => ({ httpOnly: true, secure: cookieSecure, sameSite: "lax", path: "/" });
const cookieOptions = () => ({ ...cookieSecurityOptions(), maxAge: ttlDays * 86400_000 });
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
    // La elevación a administrador es una operación explícita en la base de datos.
    // Nunca se concede desde datos aportados durante el registro.
    const role = "athlete";
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
    res.clearCookie(sessionCookieName, cookieSecurityOptions());
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

router.post("/change-password", requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    if (newPassword.length < minPasswordLength) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, message: `La contraseña debe tener al menos ${minPasswordLength} caracteres` });
    }
    const { rows } = await client.query(`SELECT password_hash FROM users WHERE id=$1 FOR UPDATE`, [req.auth.userId]);
    if (!rows[0]?.password_hash || !(await verify(rows[0].password_hash, currentPassword, argon2Options))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ ok: false, message: "La contraseña actual no es correcta" });
    }
    const passwordHash = await hash(newPassword, argon2Options);
    await client.query(`UPDATE users SET password_hash=$2 WHERE id=$1`, [req.auth.userId, passwordHash]);
    await client.query(`UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL`, [req.auth.userId, req.auth.sessionId]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); next(error); } finally { client.release(); }
});

router.get("/export", requireAuth, async (req, res, next) => {
  try {
    const exported = await exportUserData(req.auth.userId, pool);
    res.set("Content-Disposition", `attachment; filename="hybridcoach-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ ok: true, data: exported });
  } catch (error) { next(error); }
});

router.delete("/account", requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const password = String(req.body?.password || "");
    const user = await client.query(`SELECT password_hash FROM users WHERE id=$1 FOR UPDATE`, [req.auth.userId]);
    if (!user.rows[0]?.password_hash || !(await verify(user.rows[0].password_hash, password, argon2Options))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ ok: false, message: "La contraseña no es correcta" });
    }
    await client.query(`DELETE FROM users WHERE id=$1`, [req.auth.userId]);
    await client.query("COMMIT");
    res.clearCookie(sessionCookieName, cookieSecurityOptions());
    res.json({ ok: true, deleted: true });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); next(error); } finally { client.release(); }
});

export default router;
