export const BLOCKED_PLAN_FIELDS = new Set(["techo", "totalSemanas", "semanas", "taper", "deloads", "riesgo", "gymDias", "runDias"]);

export function rejectBlockedPlanFields(changes) {
  const blocked = Object.keys(changes || {}).filter((key) => BLOCKED_PLAN_FIELDS.has(key));
  if (blocked.length) throw new Error(`Campos estructurales no editables: ${blocked.join(", ")}`);
}
