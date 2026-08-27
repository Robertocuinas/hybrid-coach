/* Logging de consultas al RAG — Fase 10 (observabilidad, 10.3).

   Recibe del flujo de buildContext/chat el resultado del retrieval y el
   proveedor/modelo usados, y registra una fila en ai_query_logs (definida en
   la migración 0015). No copia datos de salud: solo la consulta tal cual llegó,
   el perfil consultado y el diagnóstico del retrieval.
*/

import { aiQueryLogs } from "../db/repositories/aiQueryLogs.js";

function consultaSegura(consulta) {
  if (!consulta || typeof consulta !== "string") return "";
  return consulta.slice(0, 500);
}

export async function logQuery(db, profileId, consulta, retrieval, provider, model) {
  const registro = {
    athlete_profile_id: profileId,
    tipo: "coach",
    consulta: consultaSegura(consulta),
    latencia_ms: retrieval?.diagnostico?.latenciaMs ?? null,
    hay_evidencia: retrieval?.hayEvidencia ?? null,
    fragmentos_entregados: retrieval?.chunks?.length ?? null,
    provider,
    model,
  };
  await aiQueryLogs.create(registro, db);
}

export async function purgeExpiredQueries(db, olderThanDays = 90) {
  await aiQueryLogs.deleteExpired(db, { olderThanDays });
}
