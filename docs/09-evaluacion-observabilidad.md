# 09 · Evaluación y observabilidad

**Premisa:** que una respuesta suene bien no significa que el RAG funcione. Sin medición, no
puedes saber si un cambio de chunking, de modelo de embeddings o de proveedor mejoró o
empeoró el sistema.

---

## 1. Dataset de evaluación

50-100 preguntas construidas a mano. Es trabajo tedioso y es el que más valor aporta.

### Formato

```
migration/../eval/dataset.jsonl
{
  "id": "q001",
  "pregunta": "¿Cuánto tiempo debería separar fuerza pesada de una sesión de intervalos?",
  "categoria": "concurrente",
  "chunks_esperados": ["<uuid>", "<uuid>"],
  "documentos_esperados": ["<uuid>"],
  "respuesta_esperada_resumen": "Separación de al menos 6-24h; el efecto de interferencia es dosis-dependiente y mayor con carrera que con ciclismo",
  "debe_responder": true
}
```

### Categorías a cubrir

| Categoría | Nº orientativo |
|---|---|
| Volumen y progresión | 10-15 |
| Interferencia fuerza-resistencia (concurrente) | 10 |
| Taper y descarga | 5-8 |
| Lesiones, dolor y gestión de carga | 10-15 |
| Nutrición deportiva | 10-15 |
| RPE / RIR / monitorización | 5-8 |
| Economía de carrera, VO₂máx, umbrales | 5-8 |
| **Preguntas sin respuesta en la biblioteca** (`debe_responder: false`) | **8-10** |

> Las preguntas del último grupo son **imprescindibles**. Miden si el sistema sabe decir
> "no tengo evidencia para esto" en vez de inventar. Es el fallo más peligroso de este
> proyecto y el que menos se detecta si no lo mides a propósito.

### Semilla rápida

El array `sugerencias` del componente `Coach` ya contiene 8 preguntas reales de uso
("Tengo los gemelos cargados desde ayer", "¿Qué dice mi bibliografía sobre el sóleo?"…).
Úsalas de punto de partida y genera variantes.

---

## 2. Métricas de retrieval (sin LLM, baratas, automáticas)

Se calculan comparando lo recuperado con `chunks_esperados`. No requieren llamar a ningún
modelo generativo, así que puedes ejecutarlas en cada cambio sin coste.

| Métrica | Definición | Qué detecta |
|---|---|---|
| **precision@k** | de los k chunks recuperados, cuántos son esperados | ruido en el retrieval |
| **recall@k** | de los chunks esperados, cuántos se recuperaron | evidencia que el sistema no encuentra |
| **MRR** | posición del primer chunk correcto | si lo bueno queda enterrado |
| **hit rate a nivel documento** | ¿aparece al menos un chunk del documento correcto? | más indulgente; útil cuando el chunking cambia y los IDs de chunk se invalidan |

**Ejecutar con y sin reranking** para saber si el reranker aporta de verdad en tu corpus.

> Al cambiar la estrategia de chunking, los `chunks_esperados` dejan de ser válidos (los IDs
> cambian). Por eso conviene mantener también `documentos_esperados`: sobrevive al
> rechunking y permite comparar entre versiones.

---

## 3. Métricas de generación (requieren LLM como juez)

| Métrica | Cómo se mide |
|---|---|
| **Groundedness / faithfulness** | Por cada afirmación citada de la respuesta: "¿se sigue esta afirmación de este chunk? sí/no". Llamadas cortas y baratas |
| **Context relevance** | Por cada chunk entregado: "¿es relevante para esta pregunta? sí/no". Detecta retrieval temáticamente cercano pero inútil |
| **Citation correctness** | ¿Los IDs citados existen y corresponden a lo que dicen citar? **Sale gratis**: `validarPropuesta()` ya lo comprueba |
| **Refusal accuracy** | En las preguntas con `debe_responder: false`, ¿el sistema respondió "sin evidencia suficiente"? Métrica binaria, crítica |
| **JSON parse failure rate** | ¿Cuántas respuestas no se pudieron parsear? Crítica al probar modelos locales pequeños |

### Sobre usar un LLM como juez

Es aceptable y estándar, pero con dos cautelas:
- usa un modelo distinto (o al menos otra configuración) del que generó la respuesta;
- valida a mano una muestra del 10-20% de los juicios del LLM las primeras veces, para
  comprobar que el juez es fiable en tu dominio.

---

## 4. Comparar configuraciones

El objetivo principal de todo esto es poder responder con datos, no con intuición, a:

- ¿Voyage o OpenAI para embeddings?
- ¿Merece la pena el reranking?
- ¿Chunks de 400 o de 600 tokens?
- ¿Funciona un modelo local para el coach?
- ¿Empeoró algo con el último cambio de prompt?

Formato de salida sugerido, una fila por configuración:

| Config | precision@8 | recall@8 | groundedness | refusal acc. | json fail | latencia p95 | $/consulta |
|---|---|---|---|---|---|---|---|
| voyage + cohere + claude | | | | | | | |
| openai + noop + gpt | | | | | | | |
| bge-m3 local + noop + llama local | | | | | | | |

**Regla de decisión:** ningún cambio entra en producción si empeora `citation_correctness` o
`refusal_accuracy`, por mucho que mejore latencia o coste. Son las dos métricas que protegen
al usuario de una recomendación inventada.

---

## 5. Cuándo ejecutar la evaluación

| Evento | Qué correr |
|---|---|
| Cambio de modelo de embeddings | Todo (requiere reindexar) |
| Cambio de estrategia de chunking | Todo |
| Cambio de proveedor de LLM | Métricas de generación |
| Cambio de prompt | Métricas de generación |
| Añadir un lote grande de papers | Métricas de retrieval (verifica que lo nuevo se encuentra) |
| Antes de cada despliegue relevante | Subconjunto rápido (20 preguntas) como *smoke test* |

Un comando: `npm run eval` o `npm run eval -- --quick`.

---

## 6. Observabilidad en producción

Tabla `ai_query_logs` (ver [`03-modelo-datos.md`](03-modelo-datos.md) §9).

### Qué registrar

```
athlete_profile_id       (referencia, no datos)
tipo                     coach | razonamiento | ingesta
consulta_original
consulta_ampliada
chunks_recuperados       [{ chunk_id, score_vectorial, score_lexico, score_rrf }]
chunks_finales           [{ chunk_id, score_rerank }]
provider, model
tokens_in, tokens_out
coste_estimado
latencia_ms              desglosada: embedding / retrieval / rerank / llm
citas_descartadas        las que validarPropuesta() rechazó
respuesta_truncada       bool (stopReason == max_tokens)
```

### Qué NO registrar

- Datos de salud duplicados (peso, dolor, lesiones) — están en las tablas relacionales;
  guarda la referencia.
- El prompt completo por defecto. Si lo necesitas para depurar un caso, actívalo
  puntualmente y trátalo como dato de salud.
- Claves ni tokens, ni siquiera parcialmente.

### Purga

Retención de 90 días con borrado automático. Estos logs son para depurar, no para negocio.

---

## 7. Señales de alarma a vigilar

| Señal | Qué suele significar |
|---|---|
| Sube la tasa de citas descartadas | El modelo está inventando IDs: prompt degradado o modelo cambiado |
| Sube la tasa de "sin evidencia suficiente" | El umbral está mal calibrado, o la biblioteca no cubre lo que la gente pregunta (útil: dice qué papers te faltan) |
| Baja la similitud media del top-1 | Posible desajuste entre el modelo que indexó y el que consulta — **comprobar `chunk_embeddings.model`** |
| Sube `json_parse_failure_rate` | Modelo o configuración de proveedor cambiada sin querer |
| Latencia de retrieval creciendo | El índice HNSW necesita mantenimiento o la biblioteca creció mucho |

El segundo caso tiene un uso positivo: **las preguntas que el sistema no puede responder son
la mejor lista de qué bibliografía añadir a continuación.**

---

## 8. Estructura de trabajo

```
eval/
├── dataset.jsonl           las 50-100 preguntas
├── run.js                  ejecuta el dataset contra la config actual
├── metrics/
│   ├── retrieval.js        precision, recall, MRR — sin LLM
│   └── generation.js       groundedness, refusal — con LLM juez
├── results/                un JSON por ejecución, con fecha y config
└── compare.js              tabla comparativa entre ejecuciones
```

Los resultados **sí se commitean**: son el historial de calidad del sistema y permiten ver
si una decisión de hace tres meses fue buena.
