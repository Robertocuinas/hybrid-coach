# Métricas de evaluación del retrieval — cálculo puro, sin dependencias ni DB

Este módulo implementa las métricas de retrieval definidas en
`docs/roadmap/fase-10-evaluacion.md` y `docs/09-evaluacion-observabilidad.md`:

- `precision(k, recuperados, esperados)`: de los k primeros recuperados, cuántos son esperados.
- `recall(k, recuperados, esperados)`: de los esperados, cuántos se recuperaron en los k primeros.
- `mrr(k, recuperados, esperados)`: posición del primer esperado dentro de los k primeros (1-based;
  0 si ninguno).
- `hit_rate_documento(recuperados, esperados)`: ¿al menos un documento esperado aparece en
  los recuperados? (más indulgente; sobrevive a un cambio de chunking).

Todas las métricas operan sobre listas de resultados (chunk o documento). No requieren DB ni
LLM, así que se pueden ejecutar en cada cambio sin coste (ver `test/metrics.test.js`).

Uso típico (ver `eval/run.js` y `eval/compare.js`):

  import { precision, recall, mrr, hitRateDocumento } from "./metrics.js";
  const recuperados = [...]; // chunkIds o documentIds, en orden de score
  const esperados = new Set([...]); // ids esperados
  const k = 10;
  const result = { precision: precision(k, recuperados, esperados), ... };

Criterio de aceptación (de fase-10-evaluacion.md): ningún cambio entra en producción si
empeora `citation_correctness` o `refusal_accuracy`. En este módulo solo medimos retrieval,
que es lo deterministico y medible sin LLM. Las métricas de generación (groundedness,
faithfulness, citation correctness) requieren LLM juez y se evalúan aparte.
