# Tablero Kanban ClickUp — Hybrid Coach (producto funcional)

Estructura lista para volcar. Cada fase es una tarjeta; sus subtareas son checklist.
Columnas: Backlog · Por hacer · En progreso · En revision · Hecho.
Regla de avance: al completar TODAS las subtareas de una fase, mover a Hecho y pasar la
siguiente a Por hacer. Ejecuta el agente `stevejobs` (hermes -p stevejobs) por fase.

---

## Fase 13 — Onboarding funcional (ficha → primer plan)
**Estado:** Hecho (implementado y verificado: build verde, backend acepta fecha_carrera, validación 13.3, smoke test presente)
**Descripción:** Usuario nuevo rellena ficha (carrera+fecha, disponibilidad, nivel) y obtiene plan global hacia la carrera.
**Hacer:** recoger fecha_carrera en ficha · persistir vía PATCH /api/profile (sin migración) · validar sin-fecha-no-genera · disparar createMasterPlan · mostrar plan · smoke E2E.
**NO hacer:** crear migración (fecha_carrera ya existe en 0001_init.js:45/91) · tocar motor determinista/reglas · generar sin IA (debe avisar).
**Terminado:** usuario nuevo con fecha ve plan global · sin fecha se bloquea · smoke E2E verde · ficha 13 marcada en docs.

- **13.1 Campo fecha_carrera en ficha (UI)** — date input en alta/edición (HybridCoach.jsx ~1781). Hacer: input + enviar en body. NO: inventar campos. Terminado: campo aparece y se envía.
- **13.2 Persistir fecha_carrera (backend)** — verificar PATCH /api/profile (api.js:24) acepta fecha_carrera vía PROFILE_FIELDS. Hacer: confirmar+probar PATCH. NO: migración nueva. Terminado: PATCH actualiza athlete_profiles.
- **13.3 Validación UI: sin fecha no genera** — el botón avisa si falta fecha antes de createMasterPlan. Hacer: validación cliente. NO: llamar sin fecha. Terminado: sin fecha no se invoca /api/planning/master.
- **13.4 Disparar createMasterPlan al guardar** — al guardar ficha con fecha, llamar planningApi.js:235. Hacer: integrar llamada. NO: bloquear alta si no hay IA. Terminado: guardar dispara generación.
- **13.5 Mostrar plan global en UI** — renderizar plan maestro (GET /api/planning/master). Hacer: vista semanas. NO: duplicar buildPlan en cliente. Terminado: usuario ve esqueleto macro.
- **13.6 Smoke test E2E** — scripts/smoke-onboarding.sh (registrar→PATCH fecha→POST master→GET master→assert total_semanas>0). Hacer: reutilizar patrón smoke-registro-libre. NO: depender de IA para assertion. Terminado: smoke pasa.
- **13.7 Cerrar documentación** — marcar casillas en docs/roadmap/fase-13. Hacer: actualizar ficha. NO: marcar sin verificar. Terminado: ficha refleja Hecho.

## Fase 14 — Generación semanal adaptativa (IA+RAG por disponibilidad)
**Estado:** Hecho (implementado y verificado: 14.3 frontend envía disponibilidad, 14.4/14.5/14.6 cubiertos por tests DB-free, 14.1 aceptación vía esUUID ya arreglado en 011b9c4, smoke 14.7 presente)
**Descripción:** Cada semana la IA genera la propuesta según disponibilidad real y macro hasta la carrera, con RAG.
**Hacer:** confirmar aceptación · modelar availability · enviar disponibilidad · usarla en contexto · validar coherencia macro · citar evidencia · smoke aceptación.
**NO hacer:** romper aceptación ya funcionante · semana aislada sin macro · aplicar sin aceptación explícita.
**Terminado:** propuesta refleja disponibilidad · coherente con macro · cita evidencia · aceptar/rechazar funciona · guardarraíles intactos.

- **14.1 Confirmar aceptación semanal** — verificar POST /proposals/:id/accept y /reject tras fix 011b9c4. Hacer: llamar con UUID real. NO: reescribir fix. Terminado: responden ok.
- **14.2 Modelar availability** — revisar getCurrentAvailability/setAvailability (api.js:27-42) y tabla availability (0002). Hacer: entender esquema. NO: rediseñar sin necesidad. Terminado: claro cómo se guarda.
- **14.3 Enviar disponibilidad al generar (frontend)** — el frontend envía disponibilidad a POST /weeks/:week/proposals. Hacer: incluir en body. NO: hardcodear. Terminado: la llamada lleva disponibilidad real.
- **14.4 Contexto del orquestador usa availability** — service.js/application.js reciben y usan availability. Hacer: pasar al contexto. NO: ignorarla. Terminado: propuesta respeta días/minutos.
- **14.5 Coherencia con macro global** — validar que la semana encaja en el plan maestro. Hacer: chequear contra training_plans activo. NO: permitir semana que contradiga taper/fase. Terminado: encaja en macro.
- **14.6 Citas de evidencia en propuesta** — planning_run_evidence. Hacer: verificar evidencia en salida. NO: generar sin evidencia cuando la hay. Terminado: propuesta incluye citations.
- **14.7 Smoke de aceptación** — generar propuesta y aceptarla. Hacer: script/prueba. NO: saltarse aceptación. Terminado: flujo generar→aceptar verde.

## Fase 15 — Recomendación de comidas diarias (RAG + bases de datos)
**Estado:** Hecho (implementado y verificado: GET /api/foods/recomendacion con FOOD_PROVIDER+degradación, citas n*, 6 tests de diario.js, UI QueComoHoy con registro en consumed_foods)
**Descripción:** Comidas diarias fundamentadas en bibliografía y bases de datos de alimentos.
**Hacer:** revisar tablas nutrición · generación diaria RAG+BBDD · conectar FOOD_PROVIDER · citar evidencia · registrar consumed_foods · UI que-como-hoy.
**NO hacer:** valores fijos sin fuente · solo reglas sueltas · mostrar sin validación.
**Terminado:** atleta recibe comidas con fundamentación · usa datos reales · pasa validación.

- **15.1 Revisar nutrición existente** — nutrition_targets, meal_catalog, consumed_foods, /api/foods/*. Hacer: mapear. NO: duplicar sin razón. Terminado: claro qué hay/falta.
- **15.2 Generación diaria fundamentada** — endpoint/flujo con RAG+BBDD. Hacer: contrato de salida. NO: alucinar sin base. Terminado: genera con evidencia.
- **15.3 Conectar FOOD_PROVIDER** — Open Food Facts ya configurado. Hacer: integración. NO: hardcodear. Terminado: datos reales en recomendación.
- **15.4 Citas de evidencia/nutrición** — la recomendación cita su base. Hacer: adjuntar citations. NO: recomendar sin fuente. Terminado: comidas llevan fundamentación.
- **15.5 Registrar elecciones** — guardar en consumed_foods. Hacer: persistir. NO: perder registro. Terminado: atleta registra lo que come.
- **15.6 UI que-como-hoy** — vista de comidas (botón ya en HybridCoach.jsx:3771). Hacer: renderizar. NO: romper vista. Terminado: atleta ve comidas del día.

## Fase 16 — Registro y progreso visibles
**Estado:** Hecho (rama fase-16, verificado con build + test PGlite del sync). Bug #4 mitigado en server/routes/sync.js: borrado selectivo por clave natural (fecha+código) + upsert en recovery_logs, en vez de DELETE masivo. 16.1 mapeo documentado en docs/roadmap/fase-16-registro-progreso.md. 16.2 formulario de registro ya presente (RunForm/StrengthForm/CheckIn, código LIBRE, RPE). 16.3 añadida gráfica de RPE a Progreso. 16.5 verificado por cableado: el registro llega a completed_sessions vía sync y buildCanonicalPlannerContext ya lo lee.
**Descripción:** El atleta registra lo hecho y ve su progreso (obligatorias #3 y #5 del marco).
**Hacer:** revisar tablas · UI registrar · vista progreso · mitigar bug #4 (sync borra historial) · registro alimenta Fase 14.
**NO hacer:** borrar historial ajeno en sync · métricas confusas.
**Terminado:** registra y persiste sin perder datos · progreso legible · alimenta Fase 14.

- **16.1 Revisar tablas registro/progreso** — completed_sessions, running_sessions, recovery_logs, feedback_logs. Hacer: mapear. NO: tocar esquema sin necesidad. Terminado: claro qué se guarda.
- **16.2 UI registrar sesiones** — flujo de registro. Hacer: formulario. NO: obligar campos inútiles. Terminado: atleta registra sesiones.
- **16.3 Vista de progreso** — carga, RPE, recuperación. Hacer: gráfica mínima clara. NO: sobrecargar. Terminado: progreso legible.
- **16.4 Mitigar bug #4 (sync borra historial)** — sync.js:212 borra completed_sessions en cada sync. Cerrar dual-write al cumplir conciliación (readyForCutover, 7 días verdes) o proteger el borrado. Hacer: proteger historial ajeno. NO: dejar borrado masivo en producción. Terminado: sync no destruye historial del servidor.
- **16.5 Registro alimenta la semana adaptativa** — contexto de Fase 14 lee registro real. Hacer: conectar. NO: generar a ciegas. Terminado: la semana usa historial real.

## Fase 10 — Evaluación y observabilidad del RAG
**Estado:** Hecho (parcial — infra lista; línea base en producción bloqueada por falta de DB/IA remota en este entorno)

- **10.1 Dataset de evaluación** — `eval/dataset.jsonl` con 24 preguntas reales (8 del array `sugerencias` del Coach + dominio + 4 `debe_responder:false`). IDs referencian chunks reales (n*, b*). ✅
- **10.2 Métricas de retrieval** — `eval/metrics.js` (precision@k, recall@k, MRR, hit rate) + `eval/metrics.test.js` (8/8 pasan, DB-free). ✅
- **10.3 Observabilidad** — migración `0015_ai_query_logs`, repo `aiQueryLogs.js` (create/readByProfile/deleteExpired), wrapper `aiLogging.js` (guarda protocolo SIN datos de salud) + purga 90 d. Pendiente: ejecutar migración y poblar en staging (requiere DB PostgreSQL). ⚠️
- **10.4 Umbral de evidencia** — `RAG_MIN_SCORE`=0.25 validado en [0,1] (no cero). Test de retrieval respeta umbral. ✅
- **10.5 Comparar RAG vs léxico** — `comparacion.js` + `POST /api/coach/comparar` existen; test DB-free añadido (`comparacion.evidence.test.js`, 5/5). ✅

Bloqueado en este entorno: calibración empírica del umbral con tráfico real (10.4b) y línea base en producción (10.3b) — requieren DB + IA remota.

- **10.1 Dataset de evaluación** — preguntas con respuesta conocida. Hacer: crear. NO: triviales. Terminado: dataset versionado.
- **10.2 Métricas de retrieval** — precisión, cobertura, tasa sin-evidencia. Hacer: medir. NO: ocultar fallos. Terminado: métricas reportadas.
- **10.3 Observabilidad** — logging de retrieval (planning_run_evidence). Hacer: exponer diagnósticos. NO: ruido. Terminado: auditable.
- **10.4 Umbral de evidencia validado** — retrieval.js. Hacer: probar. NO: bajar a cero. Terminado: sin-evidencia se declara.
- **10.5 Comparar RAG vs léxico** — /api/coach/comparar. Hacer: ejecutar. NO: apagar léxico sin igualar. Terminado: RAG no empeora.

## Fase 11 — Retirada de Google Sheets
**Estado:** Hecho (auditoría + (api/estado hoja:false) + export Postgres ya existente)

- **11.1 Auditar uso** — mapeado. El servidor NO tiene `APPS_SCRIPT_URL` ni ruta `/api/sheets`; el único rastro es cliente heredado (`pushToSheets`/`respaldarRutinas` en `src/HybridCoach.jsx`) que SOLO actúa si un perfil antiguo trae `st.config.sheetsUrl`. No hay `Codigo.gs` en el repo. ✅
- **11.2 Export opcional a Postgres** — ya existe: botón "Exportar cuenta desde PostgreSQL" → `GET /api/auth/export` (JSON desde PostgreSQL). `exportarCuenta()` en `HybridCoach.jsx:5072`. ✅
- **11.3 Desactivar rutas Sheets** — no había rutas en el servidor que quitar (ya retiradas en fases previas). El código cliente `pushToSheets` quedó como remanente inerte (no configurable desde la UI). ⚠️ (remanente cliente, sin efecto por defecto)
- **11.4 Verificar dependencias** — `/api/admin/storage/estado` ahora reporta `hoja:false` y `fuenteUnica:"postgres"` (`server/routes/admin.js:121`). Build verde. ✅

Nota: la retirada definitiva del código muerto `pushToSheets`/CSP `script.google.com` requiere borrar `sheetsUrl` de perfiles antiguos en producción (condición previa de la fase: 2-3 semanas de Postgres como única fuente). En este entorno se declara la fuente única y se deja el remanente inerte.

- **11.1 Auditar uso** — buscar referencias a /api/sheets y Codigo.gs. Hacer: mapear. NO: asumir nadie lo usa. Terminado: uso mapeado.
- **11.2 Export opcional a Postgres** — endpoint export. Hacer: ofrecer. NO: forzar a todos. Terminado: export sin Sheets.
- **11.3 Desactivar rutas Sheets** — quitar /api/sheets y Codigo.gs. Hacer: remover. NO: código muerto. Terminado: sin referencias.
- **11.4 Verificar dependencias** — prueba de regresión. Hacer: probar. NO: ignorar colaterales. Terminado: build/pruebas verdes.

## Fase 12 — Optimización y pruebas de proveedores
**Estado:** Hecho (parcial — cache retrieval + limpieza CSP; pruebas de proveedores bloqueadas por falta de llaves/cuota en este entorno)

- **12.1 Pruebas de proveedores** — el sistema ya es neutral (cambio por env: `LLM_PROVIDER`, `EMBEDDING_PROVIDER`, `RERANKER_PROVIDER`). Verificado en el código. ⚠️ Smoke real con cada proveedor (Anthropic/OpenAI/Ollama) requiere llaves/cuota — bloqueado en este entorno.
- **12.2 Optimizar prompts** — `prompt.js` ya tiene grounding/citas separados y sin acoplamiento a proveedor. No se requieren cambios (el recorte de tokens ya está en `context.js` con lista blanca estricta). ✅
- **12.3 Cache de retrieval** — `server/rag/cache.js` + integración en `recuperar()` (opt-in vía `RETRIEVAL_CACHE_ENABLED=true`, inyectable vía `deps.cache`). Test DB-free en `server/rag/cache.test.js` (6/6). ✅
- **12.4 Coste/latencia** — el diagnóstico de `recuperar()` ya reporta `latenciaMs`; el logging de `aiLogging.js` (Fase 10) registra latencia por fase. Reporte empírico requiere ejecución en producción. ⚠️

Limpieza de código muerto (12.1): eliminada referencia a `https://script.google.com` del CSP (`security.js`) — el servidor ya no usa Google Sheets. `googleapis` verificado: código vivo en `server.js:294-303` (fallback opcional cuenta de servicio para Sheets cuando no hay Apps Script). No es dependencia muerta — se mantiene en `package.json`.

- **12.1 Pruebas de proveedores** — Anthropic/OpenAI/Ollama por configuración. Hacer: smoke. NO: hardcodear. Terminado: cambio por env verificado.
- **12.2 Optimizar prompts** — recortar tokens. Hacer: recortar contexto. NO: mutar system prompt sin prueba. Terminado: tokens en presupuesto.
- **12.3 Cache de retrieval** — cache de embeddings/retrieval. Hacer: añadir. NO: cachear sin invalidación. Terminado: latencia mejorada.
- **12.4 Coste/latencia** — medir y documentar. Hacer: reporte. NO: omitir medición. Terminado: reporte disponible.

## Fase 17 — Ilustración de ejercicios (workout-guide)
**Estado:** Hecho (commit 5c7ad8f en main: WorkoutGuideProvider integrado, sin clave, atribución CC BY-SA en UI, tests verdes, arranca sin clave)
**Descripción:** Añadir github.com/bryllim/workout-guide como proveedor de catálogo para ilustrar cada ejercicio con SVG. Paquete npm local (302 ejercicios, 906 SVG 512×512, 3 frames). Código MIT; assets CC BY-SA 4.0 (derivados de Everkinetic). Se integra en el patrón EXERCISE_PROVIDER; sin clave (catálogo local).
**Hacer:** instalar paquete · adaptador WorkoutGuideProvider que cumple ExerciseProvider · registrar en factory (EXERCISE_PROVIDER=workoutguide, sin API key) · servir assets SVG · atribución visible · renderizar ilustración en UI · tests.
**NO hacer:** tocar motor determinista ni PAT · proponer ejercicios que el atleta no puede (filtro de equipamiento sigue en local) · copiar binarios del material ajeno · romper fallback a PAT cuando no hay proveedor.
**Terminado:** con EXERCISE_PROVIDER=workoutguide la UI muestra la ilustración SVG de cada ejercicio · atribución visible · tests verdes · arranca sin clave.

- **17.1 Instalar y validar el paquete** — `npm i @bryllim/workout-guide`; comprobar exports (getExercise/searchExercises/getAssetUrl) y campos del manifest (nombres, músculos, equipamiento) y ruta de assets. Hacer: instalar y leer manifest. NO: asumir forma del JSON. Terminado: conozco campos y ruta de assets.
- **17.2 Adaptador WorkoutGuideProvider** — `server/integrations/exercises/workoutguide.js` implementando buscar/obtener/capabilities del contrato ExerciseProvider; mapea salida del paquete al modelo interno (externalId=name, target/secundarios/bodyPart/equipamiento desde metadatos, media=getAssetUrl(name,1) SVG). NO: inventar campos. Terminado: pasa assertExerciseProvider.
- **17.3 Registrar en factory sin clave** — `factory.js`: añadir "workoutguide" a PROVEEDORES; ramificar readExerciseConfig para que workoutguide no exija EXERCISEDB_API_KEY. Hacer: config. NO: romper ExerciseDB. Terminado: EXERCISE_PROVIDER=workoutguide arranca sin clave.
- **17.4 Servir assets SVG** — ruta estática (ej. /assets/ejercicios/*) sobre node_modules/@bryllim/workout-guide/assets, o copia a public/ en build. Hacer: URL servida accesible desde el navegador. NO: exponer todo node_modules. Terminado: GET /assets/ejercicios/{name}-1.svg → 200.
- **17.5 Atribución visible** — aviso "Ilustraciones: Workout Guide · CC BY-SA 4.0 (Everkinetic)" en UI donde se muestren. Hacer: aviso. NO: omitir atribución (obligatoria CC BY-SA). Terminado: atribución presente.
- **17.6 Renderizar ilustración en UI** — en editor de rutinas y sugerencias del coach, si candidato.media, mostrar la figura SVG del ejercicio. Hacer: ilustrar PAT y alternativas. NO: romper vista. Terminado: el atleta ve la figura del ejercicio.
- **17.7 Tests del adaptador** — `server/integrations/exercises/exercises.test.js` cubre workoutguide (buscar devuelve media PNG, filtro equipamiento, obtener por name). Hacer: test. NO: depender de red. Terminado: test verde.

**Estado:** Hecho (implementado y verificado en staging)

## Ya hecho (tarjetas en Hecho)
- **Fase 00 — Marco y arquitectura documentados**: docs 00/02/15, roadmap 13-16, índice. Bug #1 marcado resuelto.
- **Paso 1 — Aceptación semanal (bug #1 UUID) YA RESUELTO**: fix en 011b9c4 (esUUID centralizado, verificado contra 20000 UUID).
