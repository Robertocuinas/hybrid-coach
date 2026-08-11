import express from "express";
import { pool } from "../db/repositories/_helpers.js";
import { createProfile, listProfilesByUser, updateProfile, listActiveInjuries, addInjury } from "../db/repositories/athleteProfiles.js";
import { createPlanVersion, activarPlan, getActivePlan, listWeeksWithSessions } from "../db/repositories/trainingPlans.js";
import { createCompletedSession, addRunningDetail, addStrengthSession, addStrengthSet, findOrCreateExercise, listRoutines, addRoutineEntry } from "../db/repositories/completedSessions.js";
import { upsertRecoveryLog, listRecoveryByProfile, addFeedbackLog, listFeedbackByProfile } from "../db/repositories/recovery.js";
import { setNutritionTarget, listNutritionTargets, addMealOption, listMealCatalog } from "../db/repositories/nutrition.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireActiveProfile, ownedProfile, requireAdmin } from "../middleware/authorization.js";

const router = express.Router();
router.use(requireAuth);

const active = (handler) => [requireActiveProfile, handler];
const profileId = (req) => req.auth.athleteProfileId;

router.get("/profiles", async (req, res, next) => { try { res.json({ ok: true, profiles: await listProfilesByUser(req.auth.userId) }); } catch (e) { next(e); } });
router.post("/profiles", async (req, res, next) => { try { res.status(201).json({ ok: true, profile: await createProfile(req.auth.userId, req.body || {}) }); } catch (e) { next(e); } });
router.get("/profiles/:id", ownedProfile, (req, res) => res.json({ ok: true, profile: req.profile }));

router.get("/profile", ...active(async (req, res, next) => { try { const { rows } = await pool.query(`SELECT * FROM athlete_profiles WHERE id = $1 AND user_id = $2`, [profileId(req), req.auth.userId]); res.json({ ok: true, profile: rows[0] }); } catch (e) { next(e); } }));
router.patch("/profile", ...active(async (req, res, next) => { try { res.json({ ok: true, profile: await updateProfile(profileId(req), req.body || {}) }); } catch (e) { next(e); } }));
router.get("/profile/injuries", ...active(async (req, res, next) => { try { res.json({ ok: true, injuries: await listActiveInjuries(profileId(req)) }); } catch (e) { next(e); } }));
router.post("/profile/injuries", ...active(async (req, res, next) => { try { res.status(201).json({ ok: true, injury: await addInjury(profileId(req), req.body || {}) }); } catch (e) { next(e); } }));

router.get("/plan", ...active(async (req, res, next) => { try { const plan = await getActivePlan(profileId(req)); res.json({ ok: true, plan, weeks: plan ? await listWeeksWithSessions(plan.id) : [] }); } catch (e) { next(e); } }));
router.post("/plan", ...active(async (req, res, next) => { try { const plan = await createPlanVersion(profileId(req), req.body || {}); res.status(201).json({ ok: true, plan: await activarPlan(profileId(req), plan.id) }); } catch (e) { next(e); } }));

router.get("/sessions", ...active(async (req, res, next) => { try { const { rows } = await pool.query(`SELECT cs.*, rs.id AS running_id, rs.distancia_km, rs.duracion_min, rs.rpe, rs.dolor, rs.notas, ss.id AS strength_id, ss.codigo_sesion FROM completed_sessions cs LEFT JOIN running_sessions rs ON rs.completed_session_id=cs.id LEFT JOIN strength_sessions ss ON ss.completed_session_id=cs.id WHERE cs.athlete_profile_id=$1 AND cs.fecha BETWEEN COALESCE($2::date, '-infinity') AND COALESCE($3::date, 'infinity') ORDER BY cs.fecha DESC`, [profileId(req), req.query.from || null, req.query.to || null]); res.json({ ok: true, sessions: rows }); } catch (e) { next(e); } }));
router.delete("/sessions/:id", ...active(async (req, res, next) => { try { const { rowCount } = await pool.query(`DELETE FROM completed_sessions WHERE id = $1 AND athlete_profile_id = $2`, [req.params.id, profileId(req)]); if (!rowCount) return res.status(404).json({ ok: false, message: "Sesión no encontrada" }); res.json({ ok: true }); } catch (e) { next(e); } }));
router.post("/sessions/running", ...active(async (req, res, next) => { try { const d = req.body || {}; const completed = await createCompletedSession(profileId(req), { fecha: d.fecha, tipo: "running", semana: d.semana }); const running = await addRunningDetail(completed.id, d); res.status(201).json({ ok: true, completed, running }); } catch (e) { next(e); } }));
router.post("/sessions/strength", ...active(async (req, res, next) => { try { const d = req.body || {}; const completed = await createCompletedSession(profileId(req), { fecha: d.fecha, tipo: "strength", semana: d.semana }); const strength = await addStrengthSession(completed.id, d.codigoSesion || null); const sets = []; for (const [orden, set] of (d.sets || []).entries()) { const exercise = await findOrCreateExercise({ nombre: String(set.exercise || "").trim(), profileId: profileId(req) }); sets.push(await addStrengthSet(strength.id, exercise.id, { orden: orden + 1, pesoKg: set.pesoKg, reps: set.reps, rir: set.rir, notas: set.notas })); } res.status(201).json({ ok: true, completed, strength, sets }); } catch (e) { next(e); } }));

router.get("/checkins", ...active(async (req, res, next) => { try { res.json({ ok: true, checkins: await listFeedbackByProfile(profileId(req)) }); } catch (e) { next(e); } }));
router.post("/checkins", ...active(async (req, res, next) => { try { res.status(201).json({ ok: true, checkin: await addFeedbackLog(profileId(req), req.body || {}) }); } catch (e) { next(e); } }));
router.get("/recovery", ...active(async (req, res, next) => { try { res.json({ ok: true, recovery: await listRecoveryByProfile(profileId(req)) }); } catch (e) { next(e); } }));
router.put("/recovery/:fecha", ...active(async (req, res, next) => { try { res.json({ ok: true, recovery: await upsertRecoveryLog(profileId(req), req.params.fecha, req.body || {}) }); } catch (e) { next(e); } }));

router.get("/routines", ...active(async (req, res, next) => { try { res.json({ ok: true, routines: await listRoutines(profileId(req)) }); } catch (e) { next(e); } }));
router.put("/routines", ...active(async (req, res, next) => { try {
  const d = req.body || {}; if (!Array.isArray(d.entries)) return res.status(400).json({ ok: false, message: "entries debe ser un array" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM routines WHERE athlete_profile_id = $1 AND codigo_sesion = $2`, [profileId(req), d.codigoSesion]);
    for (const [orden, entry] of d.entries.entries()) {
      const exercise = await findOrCreateExercise({ nombre: String(entry.nombre || "").trim(), profileId: profileId(req) });
      await addRoutineEntry(profileId(req), { codigoSesion: d.codigoSesion, orden: orden + 1, exerciseId: exercise.id, series: entry.series, reps: entry.reps, rir: entry.rir, prioritario: entry.prioritario, nota: entry.nota, origen: "editada" });
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  res.json({ ok: true, routines: await listRoutines(profileId(req)) });
} catch (e) { next(e); } }));

router.get("/nutrition/targets", ...active(async (req, res, next) => { try { res.json({ ok: true, targets: await listNutritionTargets(profileId(req)) }); } catch (e) { next(e); } }));
router.post("/nutrition/targets", ...active(async (req, res, next) => { try { res.status(201).json({ ok: true, target: await setNutritionTarget(profileId(req), req.body || {}) }); } catch (e) { next(e); } }));
router.get("/nutrition/meals", ...active(async (req, res, next) => { try { res.json({ ok: true, meals: await listMealCatalog(profileId(req)) }); } catch (e) { next(e); } }));
router.post("/nutrition/meals", ...active(async (req, res, next) => { try { const d = req.body || {}; res.status(201).json({ ok: true, meal: await addMealOption(profileId(req), d.categoria, d.opcion) }); } catch (e) { next(e); } }));

router.get("/documents", async (_req, res, next) => { try { const { rows } = await pool.query(`SELECT id, titulo, autores, anio, fuente_revista, doi, tema_principal, tags, resumen, limites, aplicacion_practica, revisado FROM documents ORDER BY anio DESC NULLS LAST`); res.json({ ok: true, documents: rows }); } catch (e) { next(e); } });
router.post("/documents", requireAdmin, async (req, res, next) => { try { const d = req.body || {}; const { rows } = await pool.query(`INSERT INTO documents (titulo, autores, anio, doi, tema_principal, tags, resumen, origen, revisado, subido_por) VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',false,$8) RETURNING *`, [d.titulo || null, d.autores || null, d.anio || null, d.doi || null, d.temaPrincipal || null, d.tags || [], d.resumen || null, req.auth.userId]); res.status(201).json({ ok: true, document: rows[0] }); } catch (e) { next(e); } });

export default router;
