import { buildCanonicalPlannerContext } from "./server/domain/planning/application.js";

const canonical = {
  masterPlan: { fecha_carrera: "2026-12-01T00:00:00.000Z", total_semanas: 15 },
  masterWeeks: [{ numero_semana: 1, fase: "base", inicio: null }],
  availability: { dias: [0, 1, 2, 3, 4, 5, 6] },
  profile: {},
  feedback: [], recovery: [], injuries: [], acceptedRevision: null,
};

try {
  const ctx = buildCanonicalPlannerContext(canonical, { weekNumber: 1, availabilityDays: [0,1,2,3,4,5,6] });
  console.log("OK weekStart=", ctx.weekStart, "fase=", ctx.fase);
} catch (e) {
  console.log("ERROR", e.code, e.message);
}
