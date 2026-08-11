# Fase 4 · Modelo de documentos

**Dificultad:** baja · **Depende de:** Fase 1 · **Bloquea a:** Fase 5

Se puede hacer en paralelo a las fases 2 y 3.

---

## Objetivo

La bibliografía actual (40 referencias semilla + las que hayas añadido) vive en PostgreSQL,
en la tabla `documents`. **Sin chunks todavía** — son fichas resumen, no texto completo.

El chat sigue funcionando exactamente igual que hoy, leyendo esas fichas.

## Referencias

- [`../03-modelo-datos.md`](../03-modelo-datos.md) §6 — tablas `documents`,
  `document_chunks`, `chunk_embeddings`
- [`../05-rag.md`](../05-rag.md) §11 — `study_type` vs. `evidence_grade`

## Tareas

- [ ] Migración con las tablas `documents`, `document_chunks`, `chunk_embeddings`,
      `plan_decision_citations` (si no se crearon ya en la Fase 1)
- [ ] Definir los enums: `study_type`, `evidence_grade`, `population_type`, `origen`
- [ ] Migrar `BIBLIO_SEED` (40 referencias) a `documents`
- [ ] **Rellenar `study_type` a partir del campo `fuente` existente**, que ya contiene la
      información ("meta-análisis", "revisión sistemática", "ECA", "preprint",
      "posicionamiento") — revisión manual de los casos ambiguos
- [ ] Rellenar `population_type` a partir del campo `poblacion` en texto libre
- [ ] Rellenar `evidence_grade` desde el campo `grado` actual (mapeo directo)
- [ ] Endpoint de lectura de la biblioteca desde la base de datos
- [ ] Adaptar el componente `Biblioteca` para leer del endpoint
- [ ] Adaptar `refsRelevantes()` para operar sobre los registros de la base de datos
      (misma lógica léxica por ahora — se sustituye en la Fase 7)
- [ ] Índices GIN sobre `tags`, únicos sobre `doi` y `hash_archivo`

## Criterio de terminado

- [ ] Las 40 referencias están en `documents` con `study_type` y `evidence_grade` poblados
- [ ] La pantalla de bibliografía muestra lo mismo que antes, leyendo de PostgreSQL
- [ ] El coach sigue citando referencias correctamente
- [ ] Añadir una referencia a mano desde la UI la persiste en la base de datos

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Perder matices al mapear `grado` → dos campos | Revisar las 40 a mano; son pocas y solo se hace una vez |
| Las referencias semilla no tienen DOI | El índice único sobre `doi` debe permitir `NULL`. Ya está previsto en el modelo |

## Notas

Las referencias semilla no tienen DOI y su autoría no está verificada (lo advierte la propia
UI hoy). Al migrarlas, mantener ese aviso visible: sirven para justificar decisiones de
entrenamiento, no como cita académica verificada.

Esta fase es barata y desbloquea todo el bloque RAG. Si tienes poco tiempo, es la que mejor
relación esfuerzo/valor tiene después del bloque 1.
