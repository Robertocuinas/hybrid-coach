import { findProfileById } from "../db/repositories/athleteProfiles.js";

export function requireActiveProfile(req, res, next) {
  if (!req.auth?.athleteProfileId) return res.status(409).json({ ok: false, message: "Selecciona un perfil activo" });
  next();
}

export async function ownedProfile(req, res, next) {
  try {
    const profile = await findProfileById(req.params.id);
    if (!profile || profile.user_id !== req.auth.userId) return res.status(404).json({ ok: false, message: "Perfil no encontrado" });
    req.profile = profile;
    next();
  } catch (error) { next(error); }
}

export const requireAdmin = (req, res, next) => req.auth?.role === "admin"
  ? next() : res.status(403).json({ ok: false, message: "Se requiere rol admin" });
