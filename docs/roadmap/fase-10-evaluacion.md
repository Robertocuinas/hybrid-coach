# Fase 10 · Evaluación formal y observabilidad

**Dificultad:** media · **Depende de:** Fases 7, 8 · **Bloquea a:** Fase 12

**Empieza el dataset en la Fase 5, no aquí.** Si esperas a tenerlo todo construido,
descubrirás tarde que el chunking no sirve para tus preguntas reales.

---

## Objetivo

Poder responder **con datos, no con intuición**, a: ¿el sistema mejoró o empeoró con este
cambio?

## Referencias

- [`../09-evaluacion-observabilidad.md`](../09-evaluacion-observabilidad.md) — completa

## Tareas

### Dataset
- [ ] 50-100 preguntas en `eval/dataset.jsonl`, cubriendo todas las categorías
- [ ] **8-10 preguntas sin respuesta en la biblioteca** (`debe_responder: false`) —
      imprescindibles, miden si el sistema sabe decir "no lo sé"
- [ ] Marcar `chunks_esperados` **y** `documentos_esperados` (el segundo sobrevive a un
      cambio de chunking, el primero no)
- [ ] Semilla: las 8 preguntas del array `sugerencias` del componente `Coach`

### Métricas de retrieval (sin LLM)
- [ ] precision@k, recall@k, MRR, hit rate a nivel documento
- [ ] Ejecutables con y sin reranking, para medir si el reranker aporta

### Métricas de generación (con LLM juez)
- [ ] groundedness / faithfulness
- [ ] context relevance
- [ ] citation correctness (sale gratis de `validarPropuesta()`)
- [ ] refusal accuracy sobre las preguntas `debe_responder: false`
- [ ] json parse failure rate
- [ ] Validar a mano el 10-20% de los juicios del LLM juez las primeras veces

### Herramientas
- [ ] `npm run eval` (completo) y `npm run eval -- --quick` (20 preguntas, smoke test)
- [ ] `eval/compare.js` — tabla comparativa entre ejecuciones
- [ ] Commitear los resultados en `eval/results/`: son el historial de calidad del sistema

### Observabilidad
- [ ] Tabla `ai_query_logs` poblada en cada consulta
- [ ] Latencia desglosada: embedding / retrieval / rerank / llm
- [ ] Purga automática a 90 días
- [ ] **No duplicar datos de salud en los logs** — referenciar, no copiar

## Criterio de terminado

- [ ] `npm run eval` ejecuta el dataset completo y produce métricas en un comando
- [ ] Hay una línea base registrada en `eval/results/` contra la que comparar
- [ ] Se ha calibrado `RAG_MIN_SCORE` usando las preguntas `debe_responder: false`
- [ ] `ai_query_logs` registra consultas reales en producción
- [ ] Un cambio de configuración se puede evaluar y comparar en menos de 10 minutos

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El dataset es trabajo tedioso y se pospone indefinidamente | Empezarlo en la Fase 5, 10 preguntas por sesión. No hace falta terminarlo de una vez |
| El LLM juez no es fiable en este dominio | Validar a mano una muestra; usar un modelo distinto del evaluado |
| `chunks_esperados` se invalidan al cambiar el chunking | Por eso se guardan también `documentos_esperados` |

## Regla de decisión

**Ningún cambio entra en producción si empeora `citation_correctness` o `refusal_accuracy`**,
por mucho que mejore latencia o coste. Son las dos métricas que protegen al usuario de una
recomendación inventada.

## Efecto secundario valioso

Las preguntas que el sistema no puede responder son **la mejor lista de qué bibliografía
añadir a continuación**. Vigilar la tasa de "sin evidencia suficiente" en producción no es
solo depuración: es la hoja de ruta de la biblioteca.
