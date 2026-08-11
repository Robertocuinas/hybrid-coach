# Fase 7 · Retrieval híbrido y reranking

**Dificultad:** media · **Depende de:** Fase 6 · **Bloquea a:** Fases 8, 10

---

## Objetivo

Un servicio de retrieval que, dada una consulta, devuelve los 6-8 fragmentos más relevantes
combinando búsqueda semántica, léxica y filtros de metadatos.

## Referencias

- [`../05-rag.md`](../05-rag.md) §5, §6, §7

## Tareas

### Ampliación de consulta
- [ ] Enriquecer la consulta con contexto del atleta (distancia, fase, lesiones, molestias,
      prioridad) — mismo patrón que `consultaAmpliada` en `buildContext()`
- [ ] Diccionario ES→EN de ~50 términos del dominio (concurrente → *concurrent training*,
      sóleo → *soleus*, tirada larga → *long run*…). Determinista y suficiente; no gastar una
      llamada al LLM en traducir

### Búsqueda
- [ ] Componente vectorial: `embedding <=> $query` sobre `chunk_embeddings`
- [ ] Componente léxico: `tsv @@ plainto_tsquery('english', $q)` sobre `document_chunks`
- [ ] Filtros duros aplicados **antes** de rankear: `revisado = true`, `study_type`, `anio`,
      `population_type`, `evidence_grade`
- [ ] Fusión con **Reciprocal Rank Fusion** (`Σ 1/(k + rank)`, k ≈ 60)
- [ ] Ponderación opcional por `evidence_grade` — reutilizar los pesos actuales de
      `PESO_GRADO` (fuerte 1.6, moderada 1.25, débil 0.85, práctica 0.6)
- [ ] Marcado `_relleno` cuando no hay nada realmente relevante — conservar el patrón actual

### Reranking
- [ ] Contrato `RerankProvider` con adaptadores `cohere`, `openai-compatible`, `noop`
- [ ] Flujo: 20-30 candidatos → rerank → 6-8 finales
- [ ] `RAG_TOP_K_RETRIEVAL` y `RAG_TOP_K_FINAL` configurables

### Umbral
- [ ] `RAG_MIN_SCORE`: si ningún chunk lo supera tras el reranking, devolver
      "sin evidencia suficiente" **sin llamar al LLM**

### API
- [ ] Endpoint interno de retrieval que devuelve chunks + metadatos + scores desglosados
      (vectorial, léxico, RRF, rerank) — necesario para depurar y para la Fase 10

## Criterio de terminado

- [ ] La consulta "¿cuánto separar fuerza pesada de intervalos?" recupera chunks sobre
      entrenamiento concurrente e interferencia
- [ ] Un filtro por `study_type = 'systematic_review'` devuelve solo revisiones sistemáticas
- [ ] Un filtro por `anio > 2015` funciona
- [ ] Una consulta sin evidencia en la biblioteca devuelve el mensaje de "sin evidencia" y
      **no** llama al LLM (verificable en los logs)
- [ ] `RERANK_PROVIDER=noop` funciona sin ramas `if` en el código de retrieval
- [ ] Los scores desglosados son visibles en el endpoint de depuración

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El umbral mal calibrado: o rechaza demasiado o no rechaza nunca | Calibrarlo con el dataset de la Fase 10, no a ojo. Empezar permisivo y endurecer |
| El componente léxico no encuentra nada porque la consulta va en español y el corpus en inglés | El diccionario ES→EN. Verificar con consultas reales antes de dar la fase por hecha |
| RRF mal implementado (mezclar scores incomparables en vez de rangos) | RRF usa **rangos**, no scores. Es el punto donde más fácil es equivocarse |

## Notas

Esta fase **sustituye** a `refsRelevantes()`. Mantén la función antigua funcionando en
paralelo hasta la Fase 8, para poder comparar resultados con las mismas preguntas y detectar
regresiones.
