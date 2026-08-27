/* Métricas de evaluación del retrieval — cálculo puro, sin dependencias ni DB.

   Operan sobre listas de resultados (chunkIds o documentIds, en orden de score).
   No requieren DB ni LLM, así que se pueden ejecutar en cada cambio sin coste.
   Ver `docs/roadmap/fase-10-evaluacion.md` y `eval/metrics.md` para la definición
   de cada métrica. */

/** Precision@k: de los k primeros recuperados, cuántos son esperados.
 *  `recuperados` es un array en orden de score (mejor primero).
 *  `esperados` es un Set de ids que se consideran relevantes. */
export function precision(k, recuperados, esperados) {
  if (!esperados || esperados.size === 0) return 0;
  const top = recuperados.slice(0, k);
  if (top.length === 0) return 0;
  const relevantes = top.filter((id) => esperados.has(id));
  return relevantes.length / top.length;
}

/** Recall@k: de los esperados, cuántos se recuperaron en los k primeros. */
export function recall(k, recuperados, esperados) {
  if (!esperados || esperados.size === 0) return 0;
  const top = recuperados.slice(0, k);
  if (esperados.size === 0) return 1;
  const recuperadosEsperados = top.filter((id) => esperados.has(id));
  return recuperadosEsperados.length / esperados.size;
}

/** MRR (Mean Reciprocal Rank): posición del primer esperado dentro de los k primeros.
 *  0 si ninguno de los k primeros es esperado. */
export function mrr(k, recuperados, esperados) {
  if (!esperados || esperados.size === 0) return 0;
  const top = recuperados.slice(0, k);
  for (let i = 0; i < top.length; i++) {
    if (esperados.has(top[i])) return 1 / (i + 1);
  }
  return 0;
}

/** Hit rate a nivel documento: ¿aparece al menos un documento esperado entre los
 *  recuperados? Más indulgente que precision/recall a nivel chunk; útil cuando el
 *  chunking cambia y los IDs de chunk dejan de ser válidos, pero los documentos sí. */
export function hitRateDocumento(recuperados, esperados) {
  if (!esperados || esperados.size === 0) return 0;
  return recuperados.some((id) => esperados.has(id)) ? 1 : 0;
}

/** Agrega métricas de retrieval sobre un conjunto de preguntas evaluadas.
 *  Cada pregunta en `evaluadas` tiene { pregunta, recuperados: [...], esperados: Set, ... }
 *  Devuelve métricas agregadas (promedios) más el porcentaje de preguntas sin evidencia. */
export function agregarMetricasDeEvaluacion(evaluadas, k = 10) {
  if (!evaluadas || evaluadas.length === 0) {
    return { precision: 0, recall: 0, mrr: 0, hitRateDocumento: 0, preguntas: 0, sinEvidencia: 0 };
  }
  let precisionSum = 0, recallSum = 0, mrrSum = 0, hitDocumentoSum = 0;
  let sinEvidenciaCount = 0;
  for (const q of evaluadas) {
    const esperados = q.documentos_esperados ?? q.chunks_esperados;
    if (!esperados || esperados.size === 0) {
      if (q.debe_responder === false) {
        continue;
      }
      sinEvidenciaCount++;
      continue;
    }
    precisionSum += precision(k, q.recuperados, esperados);
    recallSum += recall(k, q.recuperados, esperados);
    mrrSum += mrr(k, q.recuperados, esperados);
    hitDocumentoSum += hitRateDocumento(q.recuperados, esperados);
  }
  const n = Math.max(1, evaluadas.filter((q) => {
    const e = q.documentos_esperados ?? q.chunks_esperados;
    return e && e.size > 0;
  }).length);
  return {
    precision: precisionSum / n,
    recall: recallSum / n,
    mrr: mrrSum / n,
    hitRateDocumento: hitDocumentoSum / n,
    preguntas: evaluadas.length,
    sinEvidencia: sinEvidenciaCount,
    conEvidencia: n,
  };
}
