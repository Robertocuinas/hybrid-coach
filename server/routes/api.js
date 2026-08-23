import express from "express";
import { pool } from "../db/repositories/_helpers.js";
import { createProfile, listProfilesByUser, updateProfile, listActiveInjuries, addInjury, getCurrentAvailability, setAvailability } from "../db/repositories/athleteProfiles.js";
import { createPlanVersion, activarPlan, getActivePlan, listWeeksWithSessions } from "../db/repositories/trainingPlans.js";
import { createCompletedSession, addRunningDetail, addStrengthSession, addStrengthSet, findOrCreateExercise, listRoutines, addRoutineEntry } from "../db/repositories/completedSessions.js";
import { upsertRecoveryLog, listRecoveryByProfile, addFeedbackLog, listFeedbackByProfile } from "../db/repositories/recovery.js";
import { setNutritionTarget, listNutritionTargets, addMealOption, listMealCatalog } from "../db/repositories/nutrition.js";
import { requireAuth } from "../middleware/auth.js";
import { requireActiveProfile, ownedProfile, requireAdmin } from "../middleware/authorization.js";
import { assertPlanInput } from "../domain/training/index.js";
import { createDocument, deleteDocument, documentHasChunks, listDocumentsPaginated, updateDocument } from "../db/repositories/documents.js";

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
router.get("/profile/availability", ...active(async (req, res, next) => { try {
  res.json({ ok: true, availability: await getCurrentAvailability(profileId(req)) });
} catch (e) { next(e); } }));
router.put("/profile/availability", ...active(async (req, res, next) => { try {
  const input = req.body || {};
  const days = Array.isArray(input.dias) ? [...new Set(input.dias.map(Number))].sort() : [];
  if (!days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return res.status(400).json({ ok: false, message: "dias debe contener índices entre 0 y 6" });
  }
  const availability = await setAvailability(profileId(req), {
    vigenteDesde: input.vigenteDesde || new Date().toISOString().slice(0, 10),
    dias: days, minGym: input.minGym, minRun: input.minRun, minFinde: input.minFinde,
  });
  res.json({ ok: true, availability });
} catch (e) { next(e); } }));

const readActivePlan = async (req, res, next) => { try { const plan = await getActivePlan(profileId(req)); res.json({ ok: true, plan, weeks: plan ? await listWeeksWithSessions(plan.id) : [] }); } catch (e) { next(e); } };
router.get("/plan", ...active(readActivePlan));
router.get("/plans", ...active(readActivePlan));
router.post("/plan", ...active(async (req, res, next) => { try { assertPlanInput(req.body?.profile || req.body); const plan = await createPlanVersion(profileId(req), req.body || {}); res.status(201).json({ ok: true, plan: await activarPlan(profileId(req), plan.id) }); } catch (e) { next(e); } }));

router.get("/sessions", ...active(async (req, res, next) => { try { const { rows } = await pool.query(`SELECT cs.*, rs.id AS running_id, rs.codigo_sesion AS codigo_sesion_running, rs.distancia_km, rs.duracion_min, rs.rpe, rs.dolor, rs.notas, ss.id AS strength_id, ss.codigo_sesion AS codigo_sesion_fuerza, COALESCE(rs.codigo_sesion, ss.codigo_sesion) AS codigo_sesion FROM completed_sessions cs LEFT JOIN running_sessions rs ON rs.completed_session_id=cs.id LEFT JOIN strength_sessions ss ON ss.completed_session_id=cs.id WHERE cs.athlete_profile_id=$1 AND cs.fecha BETWEEN COALESCE($2::date, '-infinity') AND COALESCE($3::date, 'infinity') ORDER BY cs.fecha DESC`, [profileId(req), req.query.from || null, req.query.to || null]); res.json({ ok: true, sessions: rows }); } catch (e) { next(e); } }));
router.delete("/sessions/:id", ...active(async (req, res, next) => { try { const { rowCount } = await pool.query(`DELETE FROM completed_sessions WHERE id = $1 AND athlete_profile_id = $2`, [req.params.id, profileId(req)]); if (!rowCount) return res.status(404).json({ ok: false, message: "Sesión no encontrada" }); res.json({ ok: true }); } catch (e) { next(e); } }));
router.post("/sessions/running", ...active(async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const d = req.body || {};
    const completed = await createCompletedSession(profileId(req), { fecha: d.fecha, tipo: "running", semana: d.semana }, client);
    const running = await addRunningDetail(completed.id, d, client);
    await client.query("COMMIT");
    res.status(201).json({ ok: true, completed, running });
  } catch (e) { await client.query("ROLLBACK"); next(e); } finally { client.release(); }
}));
router.post("/sessions/strength", ...active(async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const d = req.body || {};
    const completed = await createCompletedSession(profileId(req), { fecha: d.fecha, tipo: "strength", semana: d.semana }, client);
    const strength = await addStrengthSession(completed.id, d.codigoSesion || null, client);
    const sets = [];
    for (const [orden, set] of (d.sets || []).entries()) {
      const exercise = await findOrCreateExercise({ nombre: String(set.exercise || "").trim(), profileId: profileId(req) }, client);
      sets.push(await addStrengthSet(strength.id, exercise.id, { orden: orden + 1, pesoKg: set.pesoKg, reps: set.reps, rir: set.rir, notas: set.notas }, client));
    }
    await client.query("COMMIT");
    res.status(201).json({ ok: true, completed, strength, sets });
  } catch (e) { await client.query("ROLLBACK"); next(e); } finally { client.release(); }
}));

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
      const exercise = await findOrCreateExercise({ nombre: String(entry.nombre || "").trim(), profileId: profileId(req) }, client);
      await addRoutineEntry(profileId(req), { codigoSesion: d.codigoSesion, orden: orden + 1, exerciseId: exercise.id, series: entry.series, reps: entry.reps, rir: entry.rir, prioritario: entry.prioritario, nota: entry.nota, origen: "editada" }, client);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  res.json({ ok: true, routines: await listRoutines(profileId(req)) });
} catch (e) { next(e); } }));

router.get("/nutrition/targets", ...active(async (req, res, next) => { try { res.json({ ok: true, targets: await listNutritionTargets(profileId(req)) }); } catch (e) { next(e); } }));
router.post("/nutrition/targets", ...active(async (req, res, next) => { try { res.status(201).json({ ok: true, target: await setNutritionTarget(profileId(req), req.body || {}) }); } catch (e) { next(e); } }));
router.get("/nutrition/meals", ...active(async (req, res, next) => { try { res.json({ ok: true, meals: await listMealCatalog(profileId(req)) }); } catch (e) { next(e); } }));
router.post("/nutrition/meals", ...active(async (req, res, next) => { try { const d = req.body || {}; res.status(201).json({ ok: true, meal: await addMealOption(profileId(req), d.categoria, d.opcion) }); } catch (e) { next(e); } }));

const DOCUMENT_ENUMS = Object.freeze({
  studyType: new Set(["meta_analysis", "systematic_review", "rct", "observational", "position_statement", "narrative_review", "preprint"]),
  evidenceGrade: new Set(["fuerte", "moderada", "debil", "practica"]),
  populationType: new Set(["runners", "strength_athletes", "general_population", "mixed"]),
  origen: new Set(["manual", "pdf"]),
});

const documentFields = (body = {}) => {
  const source = body && typeof body === "object" ? body : {};
  return Object.fromEntries([
  "titulo", "autores", "anio", "fuenteRevista", "doi", "hashArchivo", "studyType",
  "evidenceGrade", "poblacion", "populationType", "sampleSize", "temaPrincipal", "tags",
  "resumen", "limites", "aplicacionPractica", "storageKey", "origen", "revisado",
  ].filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
};

function invalidDocumentInput(data, { requireTitle = false } = {}) {
  if (requireTitle && !String(data.titulo || "").trim()) return "titulo es obligatorio";
  for (const [key, allowed] of Object.entries(DOCUMENT_ENUMS)) {
    if (data[key] !== undefined && data[key] !== null && !allowed.has(data[key])) return `${key} no es válido`;
  }
  if (data.tags !== undefined && !Array.isArray(data.tags)) return "tags debe ser un array";
  return null;
}

router.get("/documents", async (req, res, next) => { try {
  const result = await listDocumentsPaginated({ page: req.query.page, pageSize: req.query.pageSize });
  res.json({ ok: true, ...result });
} catch (e) { next(e); } });

router.post("/documents", requireAdmin, async (req, res, next) => { try {
  const data = documentFields(req.body);
  const invalid = invalidDocumentInput(data, { requireTitle: true });
  if (invalid) return res.status(400).json({ ok: false, message: invalid });
  const document = await createDocument({ ...data, origen: data.origen || "manual", revisado: false, subidoPor: req.auth.userId });
  res.status(201).json({ ok: true, document });
} catch (e) { next(e); } });

router.patch("/documents/:id", requireAdmin, async (req, res, next) => { try {
  const data = documentFields(req.body);
  const invalid = invalidDocumentInput(data);
  if (invalid) return res.status(400).json({ ok: false, message: invalid });
  if (data.revisado === true && !(await documentHasChunks(req.params.id))) {
    return res.status(409).json({
      ok: false,
      message: "Una ficha sin fragmentos del documento original no puede activarse como evidencia.",
    });
  }
  const document = await updateDocument(req.params.id, data);
  if (!document) return res.status(404).json({ ok: false, message: "Documento no encontrado" });
  res.json({ ok: true, document });
} catch (e) { next(e); } });

router.delete("/documents/:id", requireAdmin, async (req, res, next) => { try {
  const document = await deleteDocument(req.params.id);
  if (!document) return res.status(404).json({ ok: false, message: "Documento no encontrado" });
  res.json({ ok: true, document });
} catch (e) { next(e); } });

export default router;
