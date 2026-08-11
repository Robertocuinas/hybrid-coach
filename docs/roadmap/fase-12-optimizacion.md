# Fase 12 · Optimización y pruebas de proveedores

**Dificultad:** baja-media · **Depende de:** Fase 10

Sin la Fase 10 (evaluación) esta fase es a ciegas. No la adelantes.

---

## Objetivo

Ajustar coste, latencia y calidad con datos. Y responder a la pregunta que motivó la
neutralidad de proveedor: **¿funciona un modelo local para esto?**

## Referencias

- [`../04-capa-ia.md`](../04-capa-ia.md) §11 — cómo comparar proveedores
- [`../09-evaluacion-observabilidad.md`](../09-evaluacion-observabilidad.md) §4

## Tareas

### Comparación de proveedores
- [ ] Ejecutar el dataset completo con cada configuración y rellenar la tabla comparativa:

| Config | precision@8 | recall@8 | groundedness | refusal acc. | json fail | p95 | $/consulta |
|---|---|---|---|---|---|---|---|
| Anthropic + Voyage + Cohere | | | | | | | |
| OpenAI + OpenAI-emb + noop | | | | | | | |
| Local (Ollama) + BGE-M3 + noop | | | | | | | |
| Mixto: local LLM + Voyage + Cohere | | | | | | | |

- [ ] Documentar la decisión resultante en `docs/10-decisiones-tecnicas.md`
- [ ] Evaluar si conviene **proveedor distinto por tipo de tarea** (`LLM_PROVIDER_COACH` vs.
      `LLM_PROVIDER_REASONING`) — un modelo local puede bastar para el chat y no para el
      razonamiento con citas. **No lo construyas hasta que los datos lo justifiquen**

### Coste
- [ ] Revisar el coste real por consulta en `ai_query_logs`
- [ ] Activar prompt caching donde el proveedor lo soporte (el bloque perfil+plan es estable
      entre mensajes de la misma sesión: es el candidato ideal)
- [ ] Modelo más barato para tareas secundarias (resumen de conversación, clasificación)
- [ ] Revisar el tamaño del contexto: ¿se están enviando datos que no se usan?

### Retrieval
- [ ] Ajustar `RAG_TOP_K_RETRIEVAL` y `RAG_TOP_K_FINAL` midiendo, no a ojo
- [ ] Probar tamaños de chunk alternativos (400 vs. 600 tokens) y medir
- [ ] Recalibrar `RAG_MIN_SCORE` con datos de producción reales

### Rendimiento
- [ ] Revisar consultas lentas (`pg_stat_statements`)
- [ ] Verificar que los índices se están usando (`EXPLAIN ANALYZE` sobre las consultas
      frecuentes)
- [ ] Latencia del retrieval con la biblioteca ya crecida

### Limpieza
- [ ] Borrar el código muerto del puente a Sheets
- [ ] Borrar `legacy_id_map` si sigue existiendo
- [ ] Revisar dependencias sin usar

## Criterio de terminado

- [ ] La tabla comparativa está rellena con datos reales, no estimaciones
- [ ] La configuración elegida está documentada con su justificación
- [ ] El coste mensual está dentro de lo estimado en `07-railway-despliegue.md` §6
- [ ] Sabes, con números, si un modelo local es viable para tu caso

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Optimizar sin medir | Por eso esta fase depende de la 10 |
| Elegir un proveedor por coste sacrificando `citation_correctness` | La regla de decisión de la Fase 10: ninguna mejora de coste o latencia justifica empeorar citación o rechazo |
| Micro-optimizar cosas irrelevantes | El coste dominante a escala es el LLM, no la base de datos. Empieza por ahí |

## Nota final

Si al llegar aquí el sistema funciona, cuesta poco y no inventa citas, el proyecto está
terminado en lo esencial. Todo lo demás es producto, no infraestructura.
