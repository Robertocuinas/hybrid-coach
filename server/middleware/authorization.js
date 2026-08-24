import { findOwnedProfile } from "../db/repositories/athleteProfiles.js";

/* Validación de identificadores UUID válidos en el borde HTTP. Había dos
   copias divergentes de este patrón (evidence.js y planning.js) y una de ellas
   tenía un grupo de más, lo que rechazaba el 100% de los ids reales (T-01).
   Una sola fuente: [1-8] cubre v4 generado por gen_random_uuid() sin descartar
   otras versiones válidas. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const esUUID = (valor) => UUID.test(String(valor ?? ""));

export function requireActiveProfile(req, res, next) {
  if (!req.auth?.athleteProfileId) return res.status(409).json({ ok: false, message: "Selecciona un perfil activo" });
  next();
}

export async function ownedProfile(req, res, next) {
  try {
    const profile = await findOwnedProfile(req.params.id, req.auth.userId);
    if (!profile) return res.status(404).json({ ok: false, message: "Perfil no encontrado" });
    req.profile = profile;
    next();
  } catch (error) { next(error); }
}

export const requireAdmin = (req, res, next) => req.auth?.role === "admin"
  ? next() : res.status(403).json({ ok: false, message: "Se requiere rol admin" });
