# 10 · Decisiones técnicas

Registro de decisiones con su alternativa, su motivo y su fecha. Si alguien (tú dentro de
seis meses, o Claude Code) se pregunta "¿por qué no usamos X?", la respuesta está aquí.

Formato: problema → alternativas → decisión → por qué → cuándo reconsiderarla.

---

## D1 · PostgreSQL como base de datos

**Problema.** No hay persistencia de servidor. Hay que elegir motor.

**Alternativas.** PostgreSQL, MongoDB, SQLite, Supabase, Neon.

**Decisión: PostgreSQL gestionado en Railway.**

**Por qué.**
- El dominio es **inherentemente relacional**: perfil → plan → semana → sesión → ejercicio →
  serie, con claves foráneas naturales en todas direcciones. MongoDB obligaría a
  desnormalizar o a simular joins en la aplicación.
- Las consultas que necesitas son analíticas (volumen semanal, tendencia de RPE, adherencia):
  SQL con funciones de ventana es el terreno natural.
- `pgvector` te da RAG sin una segunda base de datos (ver D2).
- Railway tiene plantilla de un clic, red privada y backups gestionados. MongoDB no tiene
  equivalente de primera clase ahí; Mongo Atlas Vector Search implicaría salir de Railway y
  añadir otra factura.
- SQLite vive en el filesystem del contenedor: **se borra en cada redeploy** salvo volumen
  persistente, y no está pensado para escritura concurrente multiusuario.
- Supabase y Neon **son PostgreSQL**. Añadirlos aquí sería sumar un proveedor y una factura
  sin ganar nada que Railway Postgres no dé ya.

**Reconsiderar si.** Necesitas auth gestionada, storage y realtime como producto integrado
(entonces Supabase gana), o llegas a una escala donde el branching de Neon aporte al flujo
de desarrollo.

---

## D2 · pgvector en vez de base de datos vectorial dedicada

**Problema.** Almacenar y buscar embeddings de fragmentos de papers.

**Alternativas.** pgvector, Pinecone, Qdrant, Weaviate, MongoDB Atlas Vector Search.

**Decisión: `pgvector` sobre el mismo PostgreSQL.**

**Por qué.**
- **Evita el problema número uno de las arquitecturas RAG mal dimensionadas: dos fuentes de
  verdad que se desincronizan.** Si borras un documento en Postgres y no en Pinecone,
  seguirás citando un paper que ya no existe.
- Un chunk y su embedding viven en la misma fila. Puedes hacer en **una sola consulta SQL**:
  "los 8 fragmentos más similares a este vector, que además sean de estudios sobre corredores,
  de tipo revisión sistemática, posteriores a 2015, ordenados por similitud". Con un vector
  store externo eso son dos sistemas y un cruce en aplicación.
- Un backup, un servicio, una conexión, un modelo mental.
- A tu escala (miles de chunks, no millones) el rendimiento con índice HNSW es de sobra
  suficiente. Pinecone aquí es un Ferrari para ir a la panadería.

**Reconsiderar si.** La biblioteca supera decenas de miles de chunks **y** mides latencia de
retrieval inaceptable. Migrar entonces a Qdrant es un proyecto acotado, no una reescritura,
porque los datos ya están bien modelados.

---

## D3 · Sin LangChain ni LlamaIndex

**Problema.** Orquestar el pipeline RAG.

**Alternativas.** LangChain, LlamaIndex, código propio.

**Decisión: código propio.**

**Por qué.**
- Estos frameworks aportan cuando necesitas orquestar **muchas fuentes heterogéneas**,
  agentes con múltiples herramientas, o cambiar de vector store constantemente.
- Aquí hay: **un** tipo de documento (papers en PDF), **un** vector store (Postgres), **un**
  flujo de recuperación bien definido. El pipeline completo son 200-300 líneas de código
  directo: extraer, trocear, embeber, insertar.
- Añaden dependencias, abstracción y prompts internos que no controlas del todo — justo lo
  que no quieres en un sistema donde el grounding y las citas verificables son el requisito
  principal.
- **Coherencia con el resto del proyecto**: el frontend no usa Redux ni Zustand para 2900
  líneas; usa `useState` y una función `update()`. El backend no usa un ORM pesado. Mismo
  criterio.

**Reconsiderar si.** El sistema evoluciona hacia agentes con muchas herramientas y
planificación multi-paso. No es la dirección actual.

---

## D4 · Un solo servicio, sin microservicios

**Problema.** Organizar backend, RAG, ingesta y orquestación de IA.

**Alternativas.** Microservicios por dominio, monolito modular.

**Decisión: monolito modular. Un proceso Express con carpetas por responsabilidad.**

**Por qué.**
- A esta escala, la latencia de red entre servicios y la coordinación (versionado de
  contratos, despliegues coordinados) cuesta más de lo que aporta.
- La separación en módulos da el mismo beneficio de organización sin el coste operativo.
- Kafka y Kubernetes resuelven problemas de throughput y orquestación que **no tienes**.

**Cuándo separar el worker de ingesta.** Cuando procesar PDFs bloquee peticiones normales, o
cuando quieras reindexar toda la biblioteca sin afectar a la app. Ni antes.

---

## D5 · Neutralidad de proveedor de IA

**Problema.** `llamarIA()` está acoplado al formato de la API de Anthropic.

**Alternativas.** Mantener Anthropic, cambiar a OpenAI, abstraer.

**Decisión: capa de abstracción con tres contratos (LLM, embeddings, reranking) y ningún
proveedor privilegiado por defecto.**

**Por qué.**
- Permite probar OpenAI, un modelo local o una combinación mixta **cambiando variables de
  entorno**, no refactorizando.
- Un modelo local elimina el coste por token y la dependencia de red — relevante si el uso
  crece o si quieres privacidad total de los datos de salud.
- La abstracción cuesta poco: los tres contratos son pequeños y bien delimitados.

**Detalle que simplifica mucho.** Ollama, llama.cpp, LM Studio y vLLM exponen un endpoint
compatible con `/v1/chat/completions` de OpenAI. Un solo adaptador `openai-compatible` con
`baseURL` configurable cubre **todo el caso local**. No hace falta un adaptador por motor.

Ver [`04-capa-ia.md`](04-capa-ia.md).

---

## D6 · Herramienta de migraciones para PostgreSQL

**Problema.** Elegir la herramienta de migraciones adecuada para crear el esquema de
PostgreSQL y mantenerlo versionado sin añadir un ORM pesado.

**Alternativas.** `node-pg-migrate`, `Drizzle`, `Prisma`, `knex`.

**Decisión: `node-pg-migrate`.**

**Por qué.**
- Es ligera y se integra bien en un proyecto Node.js con `express` y `esbuild`.
- Permite escribir migraciones versionadas en JavaScript/SQL sin ocultar la definición
  del esquema.
- Encaja con la filosofía del proyecto: pocas dependencias, control explícito y un
  backend simple.
- Funciona bien con Railway y el uso de `DATABASE_URL` en producción.

**Reconsiderar si.** El proyecto evoluciona hacia un query builder tipado o necesita un
esquema fuertemente tipado en TypeScript, en cuyo caso `Drizzle` podría ser una opción.

---

## D7 · Dimensión de embeddings fija a 1024

**Problema.** Cada modelo de embeddings tiene su dimensión nativa; la columna
`vector(N)` de Postgres es fija.

**Decisión: 1024 como contrato del proyecto.**

**Por qué.** Voyage lo produce nativo; OpenAI `text-embedding-3-large` se trunca a 1024 con
el parámetro `dimensions` (fue entrenado con Matryoshka precisamente para esto y pierde muy
poca precisión); BGE-M3 local es 1024 nativo. Así cambiar de proveedor no implica alterar la
tabla ni reconstruir el índice.

**Cómo cambiarla si algún día hace falta.** Tabla nueva `chunk_embeddings_v2`, reindexado en
paralelo, comparación con el dataset de evaluación, y solo entonces el corte. Los campos
`provider` / `model` / `dimensions` existen para permitir esa convivencia.

---

## D7 · Chunking por sección, no por tamaño fijo

**Problema.** Cómo trocear papers para retrieval.

**Alternativas.** N caracteres fijos, párrafos, secciones, semantic chunking.

**Decisión: por sección del paper, con límite de 400-600 tokens y 15% de solape dentro de
cada sección.**

**Por qué.** Cortar cada N caracteres parte frases y mezcla métodos con resultados. Los
papers de ciencias del deporte tienen estructura muy estandarizada (Abstract, Methods,
Results, Discussion), y esa estructura **es información**: una pregunta aplicada se responde
en Discussion, la magnitud del efecto en Results, la aplicabilidad en Methods.

Semantic chunking descartado: añade una llamada de embeddings por documento en ingesta para
descubrir a ciegas una estructura que ya conoces.

---

## D8 · Cloudflare R2 para los PDFs

**Problema.** Dónde guardar los PDF originales (hoy no se guardan en ningún sitio).

**Alternativas.** R2, S3, volumen de Railway, Supabase Storage, PostgreSQL.

**Decisión: Cloudflare R2.**

**Por qué.** Egress a coste cero (relevante si el visor sirve PDFs al navegador), $0,015/GB-mes,
API compatible con S3, 10 GB gratis. El volumen de Railway acopla el almacenamiento al ciclo
de vida del servicio. S3 cuesta más en egress sin ventaja aquí.

**Nunca en PostgreSQL:** infla los backups y degrada el motor relacional sin aportar nada.

---

## D9 · `study_type` separado de `evidence_grade`

**Problema.** El campo `grado` actual mezcla el tipo de estudio con la confianza que merece.

**Decisión: dos campos independientes.**

**Por qué.** Permite filtrar sin ambigüedad ("prioriza revisiones sistemáticas" es un `WHERE`
sobre `study_type`) y ponderar la calidad por separado. Un metaanálisis con muestra pequeña y
alta heterogeneidad puede merecer menos confianza que un ECA grande y bien ejecutado.

---

## D10 · Conservar el reparto reglas / IA / RAG

**Problema.** Cuánto delegar en el LLM.

**Decisión: mantener y ampliar el diseño actual.** La estructura del plan, la progresión de
cargas y los avisos clínicos son código determinista. El LLM justifica y personaliza dentro
de una lista blanca (`AJUSTES_PERMITIDOS`). Lo que dice la ciencia sale siempre del RAG,
nunca de la memoria del modelo.

**Por qué.** Es el diseño correcto y ya funciona. Un error del motor determinista es un bug
reproducible; un error del LLM en la estructura del plan puede ser una lesión. Además reduce
el coste por usuario: cuanta más decisión se resuelve sin llamar al modelo, menor es el
coste marginal.

**Regla para lo nuevo.** Si un error puede causar daño físico o es objetivamente calculable →
código. Si es síntesis o justificación matizada → LLM. Si es "qué dice la ciencia" → RAG
obligatorio.

---

## D11 · Multiusuario en el esquema desde el día uno

**Problema.** Hoy solo lo usa una persona.

**Decisión: `users` + `athlete_profiles` con `user_id` en todo, aunque solo haya una cuenta.**

**Por qué.** Rehacer el esquema y migrar datos reales más tarde cuesta mucho más que
diseñarlo bien ahora. El coste de incluirlo desde el principio es prácticamente cero.

---

## D12 · Revisiones tácticas semanales con aceptación humana

**Problema.** El reparto semanal determinista no aprovecha todo el historial ejecutado,
recuperación, disponibilidad y evidencia recuperada. A la vez, permitir que un LLM
reescriba el plan maestro o active cambios crea un riesgo físico y operativo.

**Alternativas.** Mantener una agenda totalmente heurística; dejar al modelo reescribir el
plan; o separar plan maestro y revisión semanal versionada.

**Decisión: separar plan maestro y adaptación táctica.** El motor conserva objetivo, fecha,
fases, número/tipos de sesiones y límites. El planificador IA+RAG puede proponer la
distribución y prescripción de una semana dentro de esos límites, con JSON cerrado,
evidencia verificable y guardarraíles deterministas. Toda salida nace `draft`; solo una
aceptación explícita la convierte en agenda vigente.

**Por qué.** Permite personalizar con datos reales sin convertir el modelo en fuente de
verdad ni perder reproducibilidad. Las revisiones inmutables conservan qué información,
evidencia, modelo y reglas produjeron cada propuesta. El plan maestro ofrece además un
fallback seguro si fallan retrieval, proveedor o validación.

**Reconsiderar si.** Evaluaciones controladas demuestran que una parte estructural puede
delegarse sin empeorar `citation_correctness`, `refusal_accuracy` ni las reglas clínicas;
aun así requeriría una nueva decisión de producto y migración, no solo un cambio de prompt.

**Fecha.** 2026-08-14.

Contrato operativo: [`11-planificador-semanal-ia-rag.md`](11-planificador-semanal-ia-rag.md).

---

## Plantilla para decisiones futuras

```markdown
## DXX · Título

**Problema.**
**Alternativas.**
**Decisión.**
**Por qué.**
**Reconsiderar si.**
**Fecha.**
```
