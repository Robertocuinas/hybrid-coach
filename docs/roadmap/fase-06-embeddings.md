# Fase 6 · Embeddings + pgvector

**Dificultad:** media · **Depende de:** Fase 5 · **Bloquea a:** Fase 7

---

## Objetivo

Todos los chunks vectorizados y buscables por similitud semántica.

## Referencias

- [`../04-capa-ia.md`](../04-capa-ia.md) §3.2, §4.2, §5 — contrato y dimensión
- [`../05-rag.md`](../05-rag.md) §4

## Tareas

- [ ] Adaptador `voyage` implementando `EmbeddingProvider`
- [ ] Adaptador `openai` para embeddings, con truncado a 1024 dimensiones vía el parámetro
      `dimensions`
- [ ] Adaptador `openai-compatible` (BGE-M3 servido localmente)
- [ ] Respetar `inputType: 'document' | 'query'` — mejora la calidad en Voyage y Cohere
- [ ] Procesado por lotes (batch) en la ingesta, no un chunk por llamada
- [ ] Escribir en `chunk_embeddings` con `provider`, `model`, `dimensions`
- [ ] Índice HNSW: `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`
- [ ] Script de reindexado completo (para cuando cambies de modelo), reutilizando los chunks
      ya extraídos — **sin volver a procesar los PDFs**
- [ ] Validación al arrancar: si `EMBEDDING_MODEL` difiere del modelo con el que se generaron
      los embeddings almacenados, **fallar con mensaje claro**
- [ ] Consulta de similitud básica y prueba manual con 10-15 preguntas

## Criterio de terminado

- [ ] Todos los chunks con `revisado = true` tienen embedding
- [ ] Una consulta de similitud devuelve chunks razonables para preguntas de prueba manuales
- [ ] El reindexado completo funciona y no requiere volver a extraer los PDFs
- [ ] Arrancar con un modelo distinto del indexado da un error claro, no resultados malos en
      silencio
- [ ] `/api/estado` reporta `embeddings: { provider, dimensions, ok }`

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **Buscar con un modelo distinto del que indexó** — devuelve resultados malos silenciosamente, el fallo más traicionero de todo el sistema | Validación al arrancar comparando contra `chunk_embeddings.model` |
| Elegir mal el modelo y tener que reprocesar | Los campos `provider`/`model`/`dimensions` permiten convivencia de dos generaciones. El script de reindexado no toca los PDFs |
| Coste de la ingesta inicial | Con ~300 papers es del orden de un par de dólares. Voyage regala 200M tokens al abrir cuenta, probablemente cubra toda la ingesta |
| Rate limits del proveedor en la carga inicial | Procesado por lotes con reintento y backoff |

## Notas

**Dimensión 1024 es un contrato del proyecto**, no una preferencia. Los tres proveedores
candidatos pueden cumplirlo (Voyage nativo, OpenAI truncado por Matryoshka, BGE-M3 nativo).
Cambiar de dimensión implica alterar la tabla y reconstruir el índice; el camino correcto si
algún día hace falta es una tabla `chunk_embeddings_v2` en paralelo.
