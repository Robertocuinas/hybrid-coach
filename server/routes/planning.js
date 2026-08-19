/* API del planificador semanal IA + RAG. Una propuesta nunca se activa al
   generarla: aceptar y rechazar son transiciones explícitas, con ownership y
   control optimista de revisión en el repositorio. */
import express from "express";
import { resolveRAGRuntime } from "../ai/runtime.js";
import {
  acceptWeeklyPlanRevision,
  getAcceptedWeeklyPlanRevision,
  getWeeklyPlanRevision,
  rejectWeeklyPlanRevision,
} from "../db/repositories/weeklyPlanning.js";
import {
  generateWeeklyPlanningProposal,
  PlanningRequestError,
  publicWeeklyProposal,
} from "../domain/planning/application.js";
import { aiRateLimiter, requireAuth } from "../middleware/auth.js";
import { requireActiveProfile } from "../middleware/authorization.js";

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.use(requireAuth, requireActiveProfile);

const profileId = (req) => req.auth.athleteProfileId;

const proposalId = (req) => {
  const value = String(req.params.id || "");
  if (!UUID.test(value)) throw new PlanningRequestError("Identificador de propuesta no válido.", { code: "INVALID_PROPOSAL_ID" });
  return value;
};

const expectedRevision = (req) => {
  const value = Number(req.body?.expectedRevision);
  if (!Number.isInteger(value) || value < 1) {
    throw new PlanningRequestError("expectedRevision es obligatorio para aceptar o rechazar.", { code: "EXPECTED_REVISION_REQUIRED" });
  }
  return value;
};

/* El límite va SOLO aquí, que es lo único de este router que gasta una llamada
   al modelo. Estaba montado sobre el router entero, así que leer la semana
   aceptada —algo que Mi semana hace en cada cambio de semana— consumía cuota de
   IA sin invocar a nadie: pulsar diez veces las flechas dejaba el planificador
   bloqueado con "Límite temporal de IA alcanzado". Aceptar y rechazar tampoco
   llaman a ningún modelo y quedan libres. */
router.post("/weeks/:week/proposals", aiRateLimiter, async (req, res, next) => {
  try {
    const runtime = await resolveRAGRuntime(req.auth.userId);
    if (!runtime.llmProvider) {
      return res.status(503).json({ ok: false, code: "PLANNING_LLM_UNAVAILABLE", message: "Este servidor no tiene proveedor de IA configurado. Se mantiene el plan previamente aceptado." });
    }
    const proposal = await generateWeeklyPlanningProposal(profileId(req), {
      ...(req.body || {}),
      weekNumber: Number(req.params.week),
    }, { ...runtime, requireAvailability: true });
    res.status(201).json(publicWeeklyProposal(proposal));
  } catch (error) { next(error); }
});

router.get("/weeks/:week/accepted", async (req, res, next) => {
  try {
    const week = Number(req.params.week);
    if (!Number.isInteger(week) || week < 1) {
      throw new PlanningRequestError("La semana solicitada no es valida.", { code: "INVALID_WEEK_NUMBER" });
    }
    const accepted = await getAcceptedWeeklyPlanRevision(profileId(req), week);
    res.json(accepted ? publicWeeklyProposal(accepted) : { ok: true, proposal: null });
  } catch (error) { next(error); }
});

router.get("/proposals/:id", async (req, res, next) => {
  try {
    res.json(publicWeeklyProposal(await getWeeklyPlanRevision(proposalId(req), profileId(req))));
  } catch (error) { next(error); }
});

async function decide(req, res, next, decision) {
  try {
    const args = {
      revisionId: proposalId(req),
      profileId: profileId(req),
      expectedRevision: expectedRevision(req),
    };
    const result = decision === "accept"
      ? await acceptWeeklyPlanRevision(args)
      : await rejectWeeklyPlanRevision(args);
    res.json(publicWeeklyProposal(result));
  } catch (error) { next(error); }
}

router.post("/proposals/:id/accept", (req, res, next) => decide(req, res, next, "accept"));
router.post("/proposals/:id/reject", (req, res, next) => decide(req, res, next, "reject"));

export default router;
