# Documentación — evolución de Hybrid Coach

Plan completo para llevar el proyecto de `localStorage` + Google Sheets a
**PostgreSQL + pgvector + RAG científico**, con una capa de IA neutra respecto al proveedor
(Anthropic, OpenAI o modelo local).

> **Estado:** PostgreSQL/pgvector, autenticación, dual write, ingesta, RAG, embeddings y
> citas ya están implementados. Staging está operativo; el corte definitivo de
> `localStorage` sigue pendiente del periodo de conciliación.

---

## Por dónde empezar

| Si eres… | Lee en este orden |
|---|---|
| Claude Code arrancando una sesión | `../CLAUDE.md` → este índice → la ficha de la fase que toque |
| Yo, retomando el proyecto tras un tiempo | `01-estado-actual.md` → `02-arquitectura-objetivo.md` → `roadmap/README.md` |
| Alguien evaluando decisiones técnicas | `10-decisiones-tecnicas.md` |

---

## Índice

### Contexto y diseño

| Doc | Contenido |
|---|---|
| [`01-estado-actual.md`](01-estado-actual.md) | Cómo funciona el proyecto **hoy**, verificado sobre el código. Qué existe y qué no. |
| [`02-arquitectura-objetivo.md`](02-arquitectura-objetivo.md) | Arquitectura destino, diagramas, qué cambia y qué se conserva. |
| [`03-modelo-datos.md`](03-modelo-datos.md) | Todas las tablas, relaciones, índices. Multiusuario desde el día uno. |
| [`10-decisiones-tecnicas.md`](10-decisiones-tecnicas.md) | Por qué PostgreSQL y no Mongo, por qué pgvector y no Pinecone, por qué no LangChain. |

### Capa de IA

| Doc | Contenido |
|---|---|
| [`04-capa-ia.md`](04-capa-ia.md) | **Abstracción de proveedores.** Interfaces LLM / embeddings / reranking, adaptadores para Anthropic, OpenAI y modelos locales (Ollama), selección por variables de entorno, degradación por capacidades. |
| [`05-rag.md`](05-rag.md) | Pipeline completo: ingesta de PDF, chunking, embeddings, retrieval híbrido, reranking, grounding, citas. |
| [`09-evaluacion-observabilidad.md`](09-evaluacion-observabilidad.md) | Cómo comprobar que el RAG funciona de verdad. Métricas, dataset de evaluación, logging. |

### Operación

| Doc | Contenido |
|---|---|
| [`06-migracion.md`](06-migracion.md) | Migración de `localStorage` + Sheets a PostgreSQL, por fases, con verificación. |
| [`07-railway-despliegue.md`](07-railway-despliegue.md) | Servicios en Railway, variables de entorno, backups, costes. |
| [`08-seguridad.md`](08-seguridad.md) | Autenticación real, aislamiento entre usuarios, secretos, datos de salud. |
| [`runbook-operacion.md`](runbook-operacion.md) | Despliegue, rollback, conciliación, backup y restauración. |
| [`politica-datos.md`](politica-datos.md) | Retención, exportación, borrado y respuesta a incidentes. |

### Ejecución

| Doc | Contenido |
|---|---|
| [`roadmap/README.md`](roadmap/README.md) | Las 13 fases, dependencias entre ellas, orden recomendado. |
| `roadmap/fase-XX-*.md` | Una ficha por fase: objetivo, tareas, criterio de terminado, riesgos. |

### Documento largo original

[`../HybridCoach-Arquitectura-BD-RAG.md`](../HybridCoach-Arquitectura-BD-RAG.md) — la
investigación completa de la que sale todo lo demás (38 secciones, comparativas de
tecnologías, costes). Estos documentos son su versión operativa y troceada.

---

## Principios que rigen todo el diseño

1. **La simplicidad es un requisito, no una preferencia.**
   Un backend, una base de datos, un bucket de objetos. Sin microservicios, sin colas,
   sin base de datos vectorial separada. Si PostgreSQL basta, se usa PostgreSQL.

2. **El código decide lo que puede hacer daño; el LLM decide lo que necesita matiz.**
   La estructura del plan, la progresión de cargas y los avisos clínicos son
   deterministas. El LLM justifica, personaliza y conversa — dentro de una lista blanca.

3. **Nada se cita sin poder comprobarse.**
   Cada afirmación con respaldo científico apunta a un fragmento concreto de un paper
   concreto, con página y DOI. Si no hay evidencia suficiente, el sistema lo dice en vez
   de inventarla.

4. **Neutralidad de proveedor.**
   Ningún archivo del dominio conoce a Anthropic ni a OpenAI. Todo pasa por interfaces.
   Cambiar de proveedor —o pasar a un modelo local— debe ser un cambio de configuración,
   no una refactorización.

5. **Multiusuario desde el esquema, aunque solo lo use una persona.**
   Rehacer la base de datos más tarde cuesta mucho más que diseñarla bien ahora.
