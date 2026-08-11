# Fase 8 · Integración con el motor de decisiones

**Dificultad:** alta · **Depende de:** Fases 3, 7 · **Bloquea a:** Fases 9, 10

---

## Objetivo

El coach y el razonamiento del plan usan el RAG real en vez de las fichas resumen. Las
recomendaciones citan **fragmentos concretos con página**, no papers en general.

## Referencias

- [`../02-arquitectura-objetivo.md`](../02-arquitectura-objetivo.md) §4, §5, §6
- [`../04-capa-ia.md`](../04-capa-ia.md) §9 — bloques del system prompt
- [`../05-rag.md`](../05-rag.md) §8 — grounding

## Tareas

- [ ] Reescribir `buildContext()` para leer de PostgreSQL:
      perfil, plan vigente, decisiones activas, últimos 7-14 días, últimas cargas por
      ejercicio, check-ins recientes, nutrición del día
- [ ] Sustituir la sección "BASE DE EVIDENCIA" del prompt: chunks reales con
      `id`, `titulo`, `autores`, `anio`, `seccion`, `pagina`, `study_type`, `evidence_grade`
- [ ] Mantener los bloques del prompt **separados por encabezados explícitos**
      (datos ≠ evidencia ≠ reglas)
- [ ] Adaptar `decisionesIA()` al nuevo retrieval
- [ ] Adaptar `validarPropuesta()` para validar contra `document_chunk_id` en vez de IDs de
      ficha — **la lógica no cambia, cambia contra qué valida**
- [ ] Persistir citas en `plan_decision_citations` con `similarity_score` y `rank`
- [ ] Añadir campo `evidencia_mixta: []` al JSON de salida, para conflictos entre estudios
- [ ] Aplicar el umbral de "sin evidencia suficiente" también en el chat
- [ ] Persistir conversaciones en `conversations` / `messages`
- [ ] Resumen automático de turnos antiguos al superar ~30-40 mensajes
- [ ] Correr el sistema nuevo **en paralelo** al antiguo durante un tiempo, comparando
      respuestas a las mismas preguntas

## Criterio de terminado

- [ ] El coach cita fragmentos con página, no solo títulos de paper
- [ ] `validarPropuesta()` sigue descartando citas inventadas (probado con un caso forzado)
- [ ] Las preguntas de prueba **no empeoran** respecto al sistema léxico anterior
- [ ] Una pregunta sin evidencia en la biblioteca obtiene "no hay evidencia suficiente"
- [ ] Los guardarraíles siguen intactos: la IA no puede tocar `CAMPOS_BLOQUEADOS`
- [ ] Una conversación larga no explota el contexto (se resume)
- [ ] `ai_recommendations` registra `provider` y `model` de cada propuesta

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **Regresión de calidad**: el retrieval nuevo peor que el léxico en algún caso | Ejecución en paralelo + comparación con las mismas preguntas antes de apagar el antiguo. Es el riesgo principal de esta fase |
| Prompt demasiado largo con chunks completos | Los chunks son de 400-600 tokens y son 6-8: cabe. Vigilar con `maxContextTokens` del proveedor, sobre todo en local |
| Perder los guardarraíles al reescribir | Son las reglas duras de `CLAUDE.md` §4. Revisar explícitamente antes de cerrar la fase |
| El resumen de conversación pierde contexto importante | Mantener siempre los últimos ~12 turnos literales además del resumen |

## Notas

**Lo que NO cambia en esta fase:** el flujo de decisión, los guardarraíles, la validación,
el hecho de que nada se aplique automáticamente y que el usuario acepte o rechace cada
propuesta. Todo eso ya está bien diseñado.

Lo único que cambia es **de dónde sale la evidencia** y **con qué precisión se puede citar**.

Si al terminar esta fase el flujo de decisión es distinto del que había, algo se ha desviado.
