# 14 — Backlog priorizado

Auditoría del repositorio con fecha de la rama actual (`f91b5d2`). Todo lo que aparece
aquí está respaldado por `fichero:línea` o por la salida real de un comando ejecutado
sobre este árbol de trabajo. Lo que no se ha podido verificar no está en el documento.

## Estado verificado de la base

Comandos ejecutados, sin modificar ningún fichero:

| Comando | Resultado real |
|---|---|
| `npm test` | `tests 364 / pass 364 / fail 0`, `duration_ms 93888` |
| `npm run lint` | Sin salida y código 0. ESLint limpio |
| `npm run build` | `public\app.js 822.7kb`, `Done in 106ms` |
| `grep -rn "TODO\|FIXME\|HACK\|XXX"` | 12 coincidencias, **todas** son la palabra "TODO" o "TODOS" en castellano dentro de prompts y comentarios. Cero marcadores de deuda reales |
| `git status --porcelain` | Árbol limpio |

La base está sana en lo que la suite mira. El problema es **qué no mira**: 364 pruebas
en verde conviven con un endpoint del planificador roto al 100 % (T-01). Ese contraste
es el eje de este backlog.

---

## Tabla resumen

| ID | Tarea | Prioridad | Esfuerzo | Área |
|---|---|---|---|---|
| T-01 | El regex de UUID de `planning.js` rechaza todos los UUID reales: aceptar/rechazar propuesta está roto | **P0** | S | Planificador |
| T-02 | `NODE_ENV` decide el flag `Secure` de la cookie de sesión y no está declarado en ninguna parte | **P0** | S | Seguridad |
| T-03 | Ninguna ruta HTTP tiene prueba: `routes/` entero fuera del alcance de la suite | **P1** | L | Pruebas |
| T-04 | Ocho variables de entorno se leen en código y no están en `.env.example` | **P1** | S | Configuración |
| T-05 | Cuatro tablas consultadas por `athlete_profile_id` sin ningún índice | **P1** | S | Base de datos |
| T-06 | `/api/coach/chat` acepta una consulta de longitud ilimitada | **P1** | S | API / coste |
| T-07 | `HybridCoach.jsx`: 5162 líneas. Extraer los cortes no-React ya identificados | **P1** | L | Frontend |
| T-08 | El presupuesto de tokens tiene dos copias sueltas fuera de `server/ai/limits.js` | **P2** | S | Capa IA |
| T-09 | El regex de UUID está duplicado y divergente entre `planning.js` y `evidence.js` | **P2** | S | API |
| T-10 | `server/domain/planning/service.js` (294 l) y `analytics.js` sin prueba directa | **P2** | M | Pruebas |
| T-11 | La lista de ficheros de `npm test` es un literal de 49 rutas en `package.json` | **P2** | S | Tooling |
| T-12 | Migraciones `0001`–`0013` sin prueba de reversibilidad real (`down`) | **P3** | M | Base de datos |

Prioridades: **P0** = roto o riesgo real hoy. **P1** = alto. **P2** = medio. **P3** = bajo.
Esfuerzo: **S** ≤ media jornada, **M** 1–2 jornadas, **L** > 2 jornadas.

---

# P0 — Roto hoy

## T-01 · El regex de UUID de `planning.js` rechaza todos los UUID reales

**Prioridad P0 · Esfuerzo S · Área: Planificador**

### El problema

`server/routes/planning.js:27`:

```js
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

El patrón tiene **seis** grupos. Un UUID tiene cinco: `8-4-4-4-12`. El grupo
`[0-9a-f]{4}-` sobra, así que el regex exige 40 dígitos hexadecimales y 5 guiones
cuando un UUID real tiene 32 y 4.

Comprobado ejecutando el propio regex del fichero contra UUID generados por
`crypto.randomUUID()` (el mismo formato que devuelve `gen_random_uuid()`, que es el
`DEFAULT` de todas las PK del esquema — `server/db/migrations/0001_init.js:28`):

```
gen_random_uuid()/v4 aceptados por planning.js de 20000: 0
```

Cero de veinte mil. No es un caso límite: **no existe ningún id de propuesta que este
regex acepte.**

`proposalId()` (`server/routes/planning.js:33-37`) lanza `PlanningRequestError` con
`status: 400` en cuanto falla, y esa función es la que alimenta:

- `router.get("/proposals/:id")` — `planning.js:105`
- `router.post("/proposals/:id/accept")` — `planning.js:125`
- `router.post("/proposals/:id/reject")` — `planning.js:126`

Las tres rutas devuelven **400 `INVALID_PROPOSAL_ID`** siempre.

### Por qué importa

Aceptar una propuesta del planificador semanal es la operación central del producto:
es el paso que convierte una recomendación de la IA en la semana del atleta. Ahora
mismo la generación funciona (`POST /weeks/:week/proposals` no pasa por `proposalId()`)
pero **la propuesta no se puede aceptar ni rechazar nunca**. El usuario ve la semana
propuesta y ninguno de los dos botones responde.

El frontend lo llama desde cuatro sitios, todos muertos:

- `src/HybridCoach.jsx:2162` — `acceptPlanningProposal(draft.proposal.id, ...)`
- `src/HybridCoach.jsx:2187` — `rejectPlanningProposal(...)`
- `src/HybridCoach.jsx:3080-3081` — aceptar/rechazar desde el Coach
- `src/HybridCoach.jsx:3187-3200` — aceptar/rechazar desde Mi semana

`server/routes/evidence.js:13` tiene el mismo regex **bien escrito** (cinco grupos), lo
que confirma que el de `planning.js` es un error de edición, no una decisión.

Nada de esto toca el motor determinista ni los guardarraíles clínicos: es validación de
formato en el borde HTTP.

### Subtareas

1. Corregir `server/routes/planning.js:27` eliminando el grupo `[0-9a-f]{4}-` sobrante,
   dejando el patrón alineado con el de `server/routes/evidence.js:13`.
2. Escribir una prueba de regresión que ejercite `proposalId()` con el resultado de
   `crypto.randomUUID()` y afirme que no lanza. Debe fallar con el regex actual.
3. Añadir la prueba de las tres rutas afectadas (`GET /proposals/:id`,
   `POST /proposals/:id/accept`, `POST /proposals/:id/reject`) contra un id válido,
   comprobando que ya no responden 400 `INVALID_PROPOSAL_ID`.
4. Registrar el nuevo fichero de prueba en el literal `scripts.test` de `package.json`
   (ver T-11: hoy no se recoge solo).
5. Verificar a mano el ciclo completo generar → aceptar → leer semana aceptada con
   `scripts/smoke-registro-libre.js` o equivalente, comprobando que la semana aceptada
   se hidrata en `Mi semana`.
6. Revisar si existen propuestas en estado `draft` en producción que quedaron sin
   aceptar por este fallo y decidir si se notifican o se dejan caducar.

---

## T-02 · `NODE_ENV` decide el flag `Secure` de la cookie y no está declarado

**Prioridad P0 · Esfuerzo S · Área: Seguridad**

### El problema

`server/routes/auth.js:23`:

```js
const cookieSecurityOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
```

El flag `Secure` de la cookie de sesión depende enteramente de que `NODE_ENV` valga
exactamente `"production"`. Búsqueda de `NODE_ENV` en toda la configuración del
repositorio:

```
$ grep -rn "NODE_ENV" nixpacks.toml railway.json railway.cron.json .env.example package.json
(sin resultados)
$ grep -rn "NODE_ENV" .env.local
.env.local:6:NODE_ENV=development
```

Es decir: la única aparición de `NODE_ENV` en configuración versionada la fija a
`development`, y **`.env.example` no la documenta** (216 líneas, 74 variables
declaradas, ninguna es `NODE_ENV`). Nadie que despliegue siguiendo `.env.example` sabe
que tiene que ponerla.

### Por qué importa

Si `NODE_ENV` no vale `production` en Railway, la cookie de sesión viaja **sin el
atributo `Secure`**. `CLAUDE.md` §2 dice que hay cuentas y sesiones reales y que la
cookie lleva un token revocable: ese token es la credencial de sesión completa.

El resto de la postura de seguridad está bien montada —`httpOnly`, `sameSite: "lax"`,
HSTS y CSP en `server/middleware/security.js`, comprobación de origen en
`requireTrustedOrigin`— lo que hace que este sea precisamente el eslabón que no debería
depender de una variable no documentada.

No es "buena práctica genérica": es una condición de una sola línea cuyo valor de
entrada no aparece en ningún fichero de configuración del despliegue.

### Subtareas

1. Comprobar en el panel de Railway el valor efectivo de `NODE_ENV` en el servicio, y
   registrar el hallazgo (es lo que decide si esto es un fallo activo o solo latente).
2. Declarar `NODE_ENV` en `.env.example` con su efecto explicado: en `production`
   activa `Secure` en la cookie de sesión.
3. Dejar de depender de una variable implícita: derivar el flag de una variable propia
   y explícita, o invertir el valor por defecto para que `Secure` esté activo salvo
   opt-out declarado para desarrollo local.
4. Añadir prueba en `server/routes/auth.registration.test.js` (o fichero nuevo) que
   afirme el valor de `secure` en las cabeceras `Set-Cookie` para ambos entornos.
5. Documentar la variable en `docs/07-railway-despliegue.md` y en
   `docs/08-seguridad.md`.

---

# P1 — Alto

## T-03 · Ninguna ruta HTTP tiene prueba

**Prioridad P1 · Esfuerzo L · Área: Pruebas**

### El problema

Análisis del alcance **transitivo** de la suite: partiendo de los 49 ficheros
`.test.js` y siguiendo todos sus `import` relativos en cascada, 37 ficheros fuente de
127 (8808 líneas) nunca se cargan al ejecutar `npm test`. Entre ellos, **todos** los
routers salvo los que se prueban de forma indirecta:

| Fichero | Líneas | ¿Alcanzado por la suite? |
|---|---|---|
| `server/routes/admin.js` | 396 | No |
| `server/routes/coach.js` | 196 | No |
| `server/routes/api.js` | 164 | No |
| `server/routes/foods.js` | 145 | No |
| `server/routes/planning.js` | 129 | No |
| `server/routes/exercises.js` | 56 | No |
| `server/routes/ai-settings.js` | 100 | No |
| `src/index.jsx` | 105 | No |
| `src/HybridCoach.jsx` | 5163 | No |

Los ficheros `server/routes/evidence.test.js` (21 l),
`server/routes/auth.registration.test.js` (20 l) y `server/routes/sync.persistence.test.js`
(146 l) existen, pero los dos primeros son unitarios sobre funciones auxiliares
exportadas, no sobre las rutas montadas.

### Por qué importa

T-01 es la demostración: un endpoint del planificador que devuelve 400 en el 100 % de
las peticiones convive con `pass 364 / fail 0`. La suite es sólida en dominio
(planificación, guardarraíles, validación, retrieval, agenda) y **ciega en el borde
HTTP**, que es exactamente donde vive la validación de entrada y donde se rompió.

Mientras esta capa no se pruebe, cualquier corrección de T-01 puede volver a romperse
sin que nada avise.

### Subtareas

1. Montar un arranque de prueba de la app Express reutilizando PGlite
   (`@electric-sql/pglite`, ya en `devDependencies` y usado por
   `server/db/pool.test.js`), con las migraciones aplicadas.
2. Extraer un ayudante compartido de autenticación de prueba: crear usuario, iniciar
   sesión, obtener cookie, seleccionar perfil activo.
3. `server/routes/planning.test.js`: ciclo generar → leer → aceptar → rechazar, con
   `expectedRevision` correcto e incorrecto (control optimista), e id inválido → 400.
4. `server/routes/api.test.js`: `POST /sessions/running` y `POST /sessions/strength`
   con transacción y `ROLLBACK`, `PUT /profile/availability` con días fuera de rango,
   `PUT /routines` con `entries` no-array, y `DELETE /sessions/:id` de otro perfil → 404.
5. `server/routes/coach.test.js`: `/chat` sin consulta → 400, sin proveedor → 503,
   `/conversations/:id/messages` de otro perfil → 404.
6. `server/routes/foods.test.js`: `/consumo` con gramos 0, negativo y > 5000 → 400;
   `/dia` sin objetivo del día devuelve `objetivo: null` sin inventarlo.
7. `server/routes/admin.test.js`: cada ruta sin rol admin → 403 (`requireAdmin`,
   `server/middleware/authorization.js:17`).
8. Una prueba transversal que recorra los routers montados y afirme que toda ruta
   mutadora (`POST`/`PUT`/`PATCH`/`DELETE`) rechaza el cuerpo vacío con 4xx y no con
   500. Es la red que habría cazado T-01.
9. Registrar los ficheros nuevos en `package.json` (o resolver T-11 antes).

**Restricción de producto:** las pruebas del registro de entrenamientos deben afirmar
explícitamente que registrar **siempre** es posible, incluso fuera del plan o en día de
descanso — el plan recomienda, nunca excluye. Ya hay cobertura de esa regla en
`src/agenda.test.js` ("registrar fuera del plan o sin semana generada deja de ser un
agujero negro"); la capa HTTP debe afirmar lo mismo.

---

## T-04 · Ocho variables de entorno leídas en código y no declaradas

**Prioridad P1 · Esfuerzo S · Área: Configuración**

### El problema

Comparando `grep -rhoE "process\.env\.[A-Z0-9_]+"` sobre `server/`, `src/`, `scripts/`,
`migration/`, `server.js` y `build.mjs` contra lo declarado en `.env.example`:

| Variable | Se lee en | Efecto si falta |
|---|---|---|
| `NODE_ENV` | `server/routes/auth.js:23` | Ver **T-02** |
| `POSTGRES_POOL_MAX` | `server/db/pool.js:26` | Pool queda en 10 conexiones |
| `MASTER_EVIDENCE_CHARS` | `server/domain/planning/masterEvidence.js:4` | 1200 caracteres por fragmento |
| `PORT` | `server.js:68` | 3000 (Railway la inyecta) |
| `MIGRATION_USER_EMAIL` | `migration/scripts/04-load.js:12` | `atleta@hybridcoach.local` |
| `NEEDLE_PYTHON_BIN` | `scripts/needle-python.js:7` | Autodetección del intérprete |
| `SMOKE_EMAIL` | `scripts/smoke-registro-libre.js:14` | `audit@local.test` |
| `SMOKE_PASSWORD` | `scripts/smoke-registro-libre.js:15` | `AuditoriaLocal2026` |

Las dos últimas tienen **credenciales por defecto escritas en el código**. No son
secretos de producción (es un script de humo local), pero están versionadas.

### Por qué importa

`.env.example` es el contrato de despliegue: 216 líneas y 74 variables documentadas con
cuidado. Estas ocho quedan fuera, y dos de ellas cambian comportamiento que importa
—`NODE_ENV` la seguridad de la cookie, `POSTGRES_POOL_MAX` la capacidad del pool bajo
carga—. Quien despliegue leyendo `.env.example` no sabe que existen.

### Subtareas

1. Añadir a `.env.example` las seis variables de servidor y migración
   (`NODE_ENV`, `PORT`, `POSTGRES_POOL_MAX`, `MASTER_EVIDENCE_CHARS`,
   `MIGRATION_USER_EMAIL`, `NEEDLE_PYTHON_BIN`) con su valor por defecto real y una
   línea de qué hacen.
2. Documentar `SMOKE_EMAIL` y `SMOKE_PASSWORD` en una sección aparte de variables de
   scripts de desarrollo, dejando claro que no son de producción.
3. Hacer que `scripts/smoke-registro-libre.js` falle con mensaje explícito si esas dos
   variables no están puestas, en vez de recurrir a credenciales literales.
4. Añadir una prueba (o un script de `npm run`) que compare el conjunto de
   `process.env.X` leídos en el árbol contra lo declarado en `.env.example` y falle si
   aparece una nueva sin documentar. Es una comprobación barata que impide la recaída.
5. `MASTER_EVIDENCE_CHARS` es presupuesto de **entrada** de la capa IA: dejar
   documentado en `.env.example` que su fuente conceptual es `server/ai/limits.js`
   aunque su lectura viva en `masterEvidence.js` (ver T-08).

---

## T-05 · Cuatro tablas consultadas sin ningún índice

**Prioridad P1 · Esfuerzo S · Área: Base de datos**

### El problema

Extrayendo todos los `CREATE INDEX` de `server/db/migrations/*.js` y cruzándolos con
las tablas que las consultas filtran:

| Tabla | Índices existentes | Consulta que la filtra |
|---|---|---|
| `routines` | **ninguno** | `WHERE r.athlete_profile_id = $1 ORDER BY r.codigo_sesion, r.orden` — `server/db/repositories/completedSessions.js:134-137`; y `DELETE FROM routines WHERE athlete_profile_id = $1 AND codigo_sesion = $2` — `server/routes/api.js:89` |
| `meal_catalog` | **ninguno** | `WHERE athlete_profile_id = $1 ORDER BY categoria` — `server/db/repositories/nutrition.js:55` |
| `strength_sessions` | **ninguno** | `WHERE completed_session_id=ANY($1::uuid[])` — `server/domain/account/export.js:67` |
| `plan_decisions` | **ninguno** | `WHERE training_plan_id = $1` — `server/db/repositories/trainingPlans.js:153,183`; y subconsulta en `server/db/repositories/coachContext.js:107` |

El comentario de `server/db/migrations/0001_init.js:382-386` declara la política
explícitamente: *"toda tabla que cuelga de `athlete_profile_id` lleva un índice
compuesto"*. `routines` y `meal_catalog` cuelgan de `athlete_profile_id`
(`0001_init.js:218` y `0001_init.js:366`) y son las dos excepciones a esa regla.

Nótese que sí están indexadas `injuries`, `availability`, `completed_sessions`,
`recovery_logs`, `feedback_logs`, `nutrition_targets`, `conversations`, `messages`,
`strength_sets` y `training_plans`. El hueco es concreto y acotado.

### Por qué importa

`plan_decisions` es la más relevante: `coachContext.js:107` la consulta dentro de una
subconsulta que se ejecuta en **cada mensaje del Coach**, y `trainingPlans.js:183` hace
un `DELETE ... WHERE training_plan_id = $1` en cada regeneración de plan. Sin índice,
ambas son escaneo secuencial completo, y la tabla crece de forma monótona con cada plan
generado.

`routines` se lee al abrir el editor de rutinas y se borra por perfil y código de sesión
en cada guardado (`api.js:89`).

No es un problema de corrección: hoy funciona. Es coste que crece con el uso y que se
arregla con cuatro sentencias.

### Subtareas

1. Nueva migración `0014_indices_faltantes.js`.
2. `CREATE INDEX IF NOT EXISTS idx_routines_profile_codigo ON routines(athlete_profile_id, codigo_sesion, orden);` — cubre a la vez el `SELECT ... ORDER BY` y el `DELETE` por `(perfil, código)`.
3. `CREATE INDEX IF NOT EXISTS idx_meal_catalog_profile_categoria ON meal_catalog(athlete_profile_id, categoria);`
4. `CREATE INDEX IF NOT EXISTS idx_strength_sessions_completed ON strength_sessions(completed_session_id);` — es además la FK del `ON DELETE CASCADE` de `0001_init.js:191`.
5. `CREATE INDEX IF NOT EXISTS idx_plan_decisions_plan ON plan_decisions(training_plan_id);`
6. Escribir el `down` correspondiente con los cuatro `DROP INDEX IF EXISTS`, y
   comprobar que `server/db/migrations-chain.test.js` sigue en verde.
7. Verificar con `EXPLAIN ANALYZE` sobre las cuatro consultas citadas que pasan de
   `Seq Scan` a `Index Scan`, y anotar el resultado en `docs/03-modelo-datos.md §10`.

---

## T-06 · `/api/coach/chat` acepta una consulta de longitud ilimitada

**Prioridad P1 · Esfuerzo S · Área: API / coste**

### El problema

`server/routes/coach.js:77`:

```js
const consulta = String(req.body?.consulta || "").trim();
if (!consulta) return res.status(400).json({ ok: false, message: "Falta la consulta" });
```

Sin `.slice()`. Los otros dos endpoints del mismo router que reciben texto libre **sí**
lo recortan:

- `server/routes/coach.js:66` — `/route`: `.trim().slice(0, 1000)`
- `server/routes/coach.js:189` — `/comparar`: `.map((p) => String(p).slice(0, 300))`

El único tope efectivo es `express.json({ limit: "2mb" })` (`server.js:146`). Es decir,
se puede enviar una consulta de casi dos megabytes y llega entera a `responder()`
(`server/domain/coach/chat.js:53`) y de ahí a `buildContext()` y al prompt del modelo
(`chat.js:102`).

Además, esa misma consulta sin recortar se usa como **título de conversación**
(`chat.js:66,81,96` — `titulo: consulta`) y se persiste como mensaje
(`chat.js:68,83,152`).

Curiosamente, dentro del propio flujo sí se recorta al reenviarla al planificador:
`server/routes/coach.js:87` hace `consulta.slice(0, 1000)`. El tope existe, pero se
aplica una capa demasiado tarde.

### Por qué importa

Tres efectos, todos reales:

1. **Coste.** El presupuesto de tokens de entrada tiene una sola fuente,
   `server/ai/limits.js`, precisamente para que nadie meta texto sin medir. Esta ruta
   se salta esa contabilidad: 2 MB de consulta son cientos de miles de tokens de
   entrada facturados. `aiRateLimiter` limita peticiones por minuto, no tamaño por
   petición.
2. **Base de datos.** El título de la conversación y el mensaje se guardan sin tope en
   `conversations.titulo` y `messages.contenido`, ambos `text` sin restricción
   (`0001_init.js:330,340`).
3. **Interfaz.** Un título de conversación de dos megabytes rompe el listado de
   `/api/coach/conversations`.

### Subtareas

1. Aplicar `.slice(0, 1000)` en `server/routes/coach.js:77`, alineándolo con `/route`
   en la línea 66 del mismo fichero.
2. Extraer el tope a una constante compartida en `server/ai/limits.js` como presupuesto
   de entrada, en vez de repetir el literal `1000` en tres sitios del router. Es la
   regla de una sola fuente para el presupuesto de tokens.
3. Recortar además el título al persistir la conversación en
   `server/domain/coach/conversacion.js`, a una longitud razonable de listado
   (la función de título ya existe y está probada:
   `"el título de una conversación es la primera pregunta del usuario"`).
4. Prueba: `/chat` con una consulta de 100 000 caracteres responde 200 y el mensaje
   persistido está recortado, o responde 400 con mensaje claro. Elegir una de las dos
   y afirmarla.
5. Revisar el mismo patrón en `server/routes/admin.js:174` (`/retrieval`), que también
   hace `String(cuerpo.consulta || "").trim()` sin tope.

---

## T-07 · `HybridCoach.jsx`: 5162 líneas, cortes concretos ya identificados

**Prioridad P1 · Esfuerzo L · Área: Frontend**

### El problema

`wc -l src/HybridCoach.jsx` → **5162**. Es, con diferencia, el fichero más grande del
repositorio (el siguiente es `server/db/migrations/0001_init.js` con 457). No está
cubierto por ninguna prueba, ni directa ni transitiva.

`CLAUDE.md` §3 lo describe como "~2900 líneas" y da un mapa de secciones cuyos rangos
ya no coinciden con la realidad. El fichero ha crecido un 78 % sobre lo documentado.

Lo importante: **el fichero ya está seccionado con banderas de comentario**
(`/* ===== ... */`), así que los cortes no hay que inventarlos, están escritos. Mapa
real medido:

| Rango | Líneas | Zona | ¿React? |
|---|---|---|---|
| L18–264 | 247 | Cabecera + `CSS` | No |
| L265–325 | 61 | Catálogo `PAT`, `PLANTILLAS`, `catalogoEj`, `exName` | No |
| L326–415 | 90 | Biblioteca v2: `normRef`, `refsRelevantes`, `tokens` | No |
| L416–487 | 72 | `WIZARD`, `ZONAS`, `allQuestions`, `completeness` | No |
| L488–628 | 141 | Motor: `riskScore`, `splitDays`, `buildPlan`, `decisiones` | No |
| L629–889 | 261 | Motor: `sessionDetail`, `generateWeek`, `suggestLoad`, `e1rm` | Casi |
| L890–1157 | 268 | Nutrición determinista: `objetivosDia`, `cronogramaDia` | No |
| L1158–1218 | 61 | Capa IA cliente: `llamarIA`, `extraerJSON` | No |
| L1219–1292 | 74 | Importación PDF: `cargarPdfJs`, `extraerTextoPDF`, `SYS_PDF` | No |
| L1293–1398 | 106 | Almacenamiento: `store`, `loadState`, `saveState` | No |
| L1399–1645 | 247 | Componente `HybridCoach` | Sí |
| L1646–5162 | 3517 | Todos los componentes de UI | Sí |

**Las diez primeras zonas (L18–1398, 1381 líneas) no contienen ni un solo hook de
React.** Verificado buscando `useState|useEffect|useMemo|useCallback|useRef` en cada
rango: cero coincidencias en las nueve zonas entre L265 y L1398. Son lógica pura
atrapada dentro de un `.jsx`.

Ese es exactamente el criterio que ya se aplicó a `src/agenda.js`, que
`CLAUDE.md` §3 justifica así: *"vive fuera del JSX para poder probarse con
`node --test`"*. La misma razón sirve para 1381 líneas más.

Dentro de la UI, los tres componentes más voluminosos son cortes naturales por sí
mismos: `EDITOR RUTINAS` L4180–4889 (710 l), `ENTRENAR` L2440–2949 (510 l) y
`COACH` L2950–3418 (469 l).

### Por qué importa

No es estética. El motor determinista y los guardarraíles clínicos son las dos cosas que
`CLAUDE.md` §4 marca como intocables sin permiso, y **viven dentro del monolito sin
prueba** (L488–889). Mientras estén ahí, cualquier cambio en la UI del mismo fichero
puede rozarlos sin que ninguna prueba lo detecte. Sacarlos a módulos propios no cambia
su comportamiento: los hace verificables.

**Restricción:** esta tarea es *movimiento de código*, no reescritura. El motor
(`buildPlan`, `generateWeek`, `progresionSugerida`, reglas R1–R9) y los `if` duros de
seguridad clínica se extraen **sin tocar una línea de su lógica**. Si algún corte exige
cambiar comportamiento, ese corte se detiene y se pregunta.

### Subtareas

Ordenadas de menor a mayor riesgo. Cada una termina con la suite en verde y el bundle
compilando.

1. Extraer L1293–1398 → `src/storage.js` (`store`, `emptyProfile`, `loadState`,
   `saveState`, `cargarBibliografiaAPI`, `pushToSheets`). Es la zona con menos aristas:
   no depende de nada del fichero salvo `uid()` y `BIBLIO_SEED`.
2. Extraer L326–415 → `src/biblioteca.js` (`normRef`, `refsRelevantes`, `tokens`,
   `norm`, `STOP`, `PESO_GRADO`, `GRADOS`). Ya tiene un consumidor claro y ninguna
   dependencia de UI.
3. Extraer L1219–1292 → `src/pdfImport.js` (`cargarPdfJs`, `extraerTextoPDF`,
   `analizarPDF`, `SYS_PDF`, constantes `PDFJS_*`).
4. Extraer L1158–1218 → `src/iaCliente.js` (`llamarIA`, `extraerJSON`,
   `decisionesActivas`, `adaptacionesActivas`). Al hacerlo, resolver T-08: el
   `max_tokens = 1400` de la línea 1165 deja de ser un literal.
5. Extraer L890–1157 → `src/nutricion.js` (`metabolismoBasal`, `gastoSesion`,
   `objetivosDia`, `cronogramaDia`, `avisosNutricion`, `nutricionDia`). **Cuidado: el
   suelo calórico de disponibilidad energética es un guardarraíl clínico duro** — se
   mueve literal, sin tocar el `if`.
6. Extraer L265–325 y L416–487 → `src/catalogo.js` y `src/wizard.js` (datos y
   ayudantes puros: `PAT`, `PLANTILLAS`, `WIZARD`, `completeness`).
7. Extraer L488–889 → `src/motor.js`. **El corte de mayor valor y mayor cuidado.**
   Mover `riskScore`, `splitDays`, `buildPlan`, `generateWeek`, `sessionDetail`,
   `gymSession`, `scoreAssignment`, `suggestLoad`, `baseLoad`, `e1rm` sin alterar su
   lógica. `NavFecha` (L652) es un componente y se queda en el JSX.
8. Escribir `src/motor.test.js` sobre el módulo recién extraído, congelando el
   comportamiento actual: reparto de sesiones, techo de tirada larga, deload y taper,
   y `progresionSugerida` por RIR/reps. Estas pruebas son la red que hoy no existe.
9. Escribir `src/nutricion.test.js` afirmando que el suelo calórico recorta y marca
   `recortado_por_suelo`, y que el módulo no consulta a ningún modelo.
10. Actualizar el mapa de secciones de `CLAUDE.md` §3 con los rangos reales y los
    módulos nuevos: hoy dice "~2900 líneas" y los rangos están desfasados.
11. Solo después, y como tarea aparte, evaluar extraer los tres componentes grandes
    (`EditorRutinas` L4180–4889, `Entrenar` L2440–2949, `Coach` L2950–3418) a ficheros
    propios. Es refactor de UI y no bloquea nada de lo anterior.

---

# P2 — Medio

## T-08 · El presupuesto de tokens tiene dos copias fuera de `limits.js`

**Prioridad P2 · Esfuerzo S · Área: Capa IA**

### El problema

`server/ai/limits.js` es, por diseño declarado en su propia cabecera, la fuente única
del presupuesto de tokens: *"Estaba repartido en números literales por media docena de
ficheros —1400 aquí, 1000 en el chat, 400 en el resumen…"*. La consolidación se hizo y
funciona. Quedan dos literales `1400` fuera:

1. `src/HybridCoach.jsx:1165` — `async function llamarIA({ system, messages, max_tokens = 1400 })`.
   Mitigado en el servidor: `server.js:255` aplica `topeSalidaPeticion(req.body?.max_tokens)`
   y `limits.js:105-110` recorta al tope real. Pero el cliente sigue **pidiendo** 1400
   por defecto, y `topeSalidaPeticion` respeta un valor solicitado menor que el tope
   (`Math.min(tope, Math.max(128, n))`). O sea: el literal del cliente sí manda a la baja.
   La única llamada que lo sobreescribe es `HybridCoach.jsx:1287` (`max_tokens: 1600`).

2. `server/ai/providers/ollama.js:4` — `maxTokens = 1400` como valor por defecto del
   constructor. `server/ai/factory.js:75` construye el proveedor con `...config`, que sí
   trae `maxTokens: topeSalida(env)` (`factory.js:49`), así que el defecto no se usa en
   el camino normal. Pero está ahí, y es el mismo número que la cabecera de `limits.js`
   documenta como el problema que se vino a resolver. `anthropic.js:37` y
   `openai-compatible.js:37` ya usan `?? 8000` en lugar de 1400 — Ollama es el único que
   se quedó atrás.

`server/ai/limits.test.js:7` documenta la propiedad que se quiere mantener: *"que subir
`LLM_MAX_TOKENS` sube TODO a la vez"*. Estos dos literales son las dos excepciones.

### Por qué importa

Riesgo bajo hoy (ambos están cubiertos aguas abajo), pero es exactamente el patrón que
`CLAUDE.md` §4.2 marca como prohibido para las listas de campos: una copia sobrante que
diverge en silencio. El coste de cerrarlo es mínimo y evita que el siguiente cambio de
presupuesto vuelva a dejar un camino con la ventana vieja.

### Subtareas

1. En `src/HybridCoach.jsx:1165`, quitar el valor por defecto `1400` y no enviar
   `max_tokens` cuando el llamante no lo especifique: dejar que el servidor aplique
   `topeSalidaPeticion` con su propio defecto (`limits.js:108`).
2. Revisar `HybridCoach.jsx:1287` (`max_tokens: 1600` en `analizarPDF`) y decidir si ese
   tope debe salir de `limits.js` como presupuesto de tarea, igual que el planificador.
3. En `server/ai/providers/ollama.js:4`, alinear el defecto con `anthropic.js:37` y
   `openai-compatible.js:37`, o eliminarlo para que el proveedor exija `maxTokens`.
4. Añadir a `server/ai/limits.test.js` una comprobación que recorra `server/ai/providers/`
   y falle si aparece un literal de tokens que no venga de `limits.js`.
5. Ejecutar la tarea 4 de T-07 (extraer `src/iaCliente.js`) en el mismo cambio: el
   literal del cliente desaparece al mover la función.

---

## T-09 · El regex de UUID está duplicado y divergente

**Prioridad P2 · Esfuerzo S · Área: API**

### El problema

Dos definiciones independientes del mismo concepto:

- `server/routes/evidence.js:13` — `/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` — **correcta**, verificada aceptando UUID reales.
- `server/routes/planning.js:27` — seis grupos, **rota** (T-01).

Divergen además en la versión aceptada: `[1-8]` en `evidence.js` frente a `[1-5]` en
`planning.js`. Aunque se arregle el número de grupos, seguirían siendo dos reglas
distintas para validar la misma clase de identificador generado por el mismo
`gen_random_uuid()`.

### Por qué importa

T-01 existe porque hay dos copias y una se editó mal. Arreglar T-01 sin unificar deja el
mismo terreno preparado para la próxima divergencia. Es la misma lección que
`CLAUDE.md` §4.2 saca de las listas de campos duplicadas: *"la copia sobrante estaba
desactualizada"*.

### Subtareas

1. Crear un único ayudante exportado, p. ej. `esUUID(valor)` en
   `server/middleware/authorization.js` o en un `server/routes/_validacion.js` nuevo.
2. Fijar la clase aceptada en `[1-8]` (la de `evidence.js`), que cubre v4 —lo que
   genera `gen_random_uuid()`— sin rechazar otras versiones válidas.
3. Sustituir las dos definiciones locales por importaciones del ayudante.
4. Prueba unitaria del ayudante con: UUID de `crypto.randomUUID()` (acepta), cadena
   vacía, `"null"`, `undefined`, un UUID con un guion de más y uno con un carácter
   no hexadecimal (todos rechazan).
5. Buscar en `server/routes/` cualquier `:id` que llegue a una consulta SQL sin pasar
   por esta validación y decidir caso por caso si debe usarla —`coach.js:154` y
   `coach.js:175` reciben `req.params.id` y lo pasan directo a la consulta; van
   parametrizados, así que no hay inyección, pero devuelven 500 en vez de 400 ante un id
   con formato inválido.

---

## T-10 · `service.js` y `analytics.js` sin prueba directa

**Prioridad P2 · Esfuerzo M · Área: Pruebas**

### El problema

`server/domain/planning/service.js` (294 líneas) exporta `planificarSemana`,
`seleccionarEvidencia`, `crearTrainingPlannerService` y `planWeeklyTraining`. Se
importa desde `server/domain/planning/application.js:16` y se reexporta en
`server/domain/planning/index.js:7`, pero **no existe `service.test.js`**. Lo que se
prueba de él es lo que atraviesa `application.test.js` y `planning.test.js`.

Igual con `server/domain/planning/analytics.js` (262 líneas): `planning.test.js:81-103`
ejercita `calcularAnaliticaEntrenamiento` (ventanas de 7 y 28 días, adherencia, rachas,
reparto temporal), lo cual es cobertura real, pero indirecta y parcial sobre un fichero
de 262 líneas.

En total, 34 ficheros de `server/` y `src/` no tienen un `.test.js` hermano, aunque 49
sí lo tienen y los 49 se ejecutan (verificado: la lista de `package.json` y los ficheros
en disco coinciden exactamente, sin huérfanos ni rutas muertas).

### Por qué importa

`seleccionarEvidencia` decide **qué evidencia se le enseña al modelo** y con qué tope
por documento (`maxEvidence = 12, maxPerDocument = 2`). Es la pieza que sostiene la
regla dura de `CLAUDE.md` §4.4: nunca se cita evidencia que no exista. Que solo se
pruebe de refilón, a través de otra capa, es cobertura frágil para algo de ese peso.

Prioridad P2 y no P1 porque, a diferencia de `routes/`, aquí **sí** hay cobertura
efectiva atravesando `application.test.js`, `planning.test.js` y `masterPlan.test.js`.
Es una carencia de precisión, no un agujero.

### Subtareas

1. `server/domain/planning/service.test.js`: `seleccionarEvidencia` con más de 12
   resultados (recorta), con 5 fragmentos del mismo documento (aplica
   `maxPerDocument: 2`), y con lista vacía (devuelve vacío sin inventar).
2. En el mismo fichero, `planificarSemana` con proveedor simulado que devuelve JSON
   inválido, y con uno que corta la respuesta (`stopReason: "max_tokens"`): afirmar que
   el resultado se rechaza y no se aplica nada. Es el fallo que motivó `limits.js`.
3. `server/domain/planning/analytics.test.js` como fichero propio, ampliando lo que hoy
   vive en `planning.test.js:81-103`: ventana sin sesiones, semana entera omitida,
   sesiones fuera de la ventana de 28 días.
4. Registrar ambos en `package.json` (o resolver T-11 antes).
5. No ampliar cobertura sobre el comportamiento del motor determinista en esta tarea:
   congelar el actual, no cambiarlo.

---

## T-11 · La lista de pruebas es un literal de 49 rutas en `package.json`

**Prioridad P2 · Esfuerzo S · Área: Tooling**

### El problema

`package.json`, campo `scripts.test`: una sola línea con las 49 rutas `.test.js`
enumeradas a mano tras `node --test --test-concurrency=1`.

Estado actual verificado: **49 listadas, 49 en disco, coincidencia exacta**. Ni
huérfanos ni rutas muertas. La lista está bien mantenida hoy.

El problema es el mecanismo: un fichero de prueba nuevo **no se ejecuta hasta que
alguien lo añade al literal**, y su ausencia no produce ningún error — la suite pasa en
verde ignorándolo. Cada una de las tareas T-03, T-07, T-09 y T-10 de este backlog crea
ficheros de prueba nuevos.

### Por qué importa

Es el multiplicador de riesgo de todo lo demás. Una prueba de regresión para T-01 que se
escriba y no se registre da la peor señal posible: la sensación de estar cubierto sin
estarlo.

`--test-concurrency=1` sí tiene motivo (hay pruebas con PGlite que comparten estado) y
se conserva.

### Subtareas

1. Sustituir el literal por descubrimiento por patrón:
   `node --test --test-concurrency=1 "server/**/*.test.js" "src/**/*.test.js" "scripts/**/*.test.js" "migration/**/*.test.js"`.
   Node 20.11+ (`engines` lo exige) admite globs en `--test`.
2. Ejecutar y comparar: deben salir los mismos 364 tests y 0 fallos. Si aparece alguno
   nuevo, es una prueba que llevaba tiempo sin ejecutarse y hay que mirarla antes de
   seguir.
3. Confirmar que el orden y la concurrencia siguen siendo estables ejecutando tres
   veces seguidas.
4. Si el glob da problemas en el runner de Node de la versión desplegada, alternativa:
   un `scripts/run-tests.js` que recorra el árbol y pase la lista al runner, más una
   comprobación que falle si encuentra un `.test.js` no ejecutado.
5. Dejar anotado en `CLAUDE.md` que añadir una prueba ya no requiere tocar
   `package.json`.

---

# P3 — Bajo

## T-12 · Migraciones sin prueba de reversibilidad

**Prioridad P3 · Esfuerzo M · Área: Base de datos**

### El problema

Trece migraciones (`0001`–`0013`, 1268 líneas en total). Existe
`server/db/migrations-chain.test.js` y está en la suite, y `package.json` expone
`npm run migrate:down`. `0001_init.js:423-457` tiene un `down` completo y cuidado, con
los `DROP TABLE` en orden inverso de dependencias y el borrado de los siete `ENUM`.

Lo que no está verificado es que el ciclo **`up` → `down` → `up` deje el esquema en el
mismo estado** para cada migración, en particular las que hacen `ALTER TABLE ... ADD
CONSTRAINT ... NOT VALID` (`0007_integrity_hardening.js:9-32`,
`0011_planning_and_evidence_integrity.js:22-63`) y las que crean índices únicos
parciales (`0007:36-38`, `0010:143-147`, `0012:41`).

### Por qué importa

Es la red de seguridad de un despliegue fallido en Railway. Nunca se ha ejercitado, así
que hoy no se sabe si funciona. Prioridad baja porque no hay ningún indicio de que esté
rota y porque el `down` de `0001` está claramente escrito con intención.

### Subtareas

1. Ampliar `server/db/migrations-chain.test.js` para, sobre PGlite, aplicar todas las
   migraciones, revertir hasta cero y volver a aplicarlas.
2. Comparar el esquema resultante (tablas, columnas, índices, restricciones, tipos
   `ENUM`) entre la primera y la segunda pasada, y fallar ante cualquier diferencia.
3. Revisar específicamente los `ENUM` de `0001_init.js:452-454`: el `down` los borra,
   así que una reversión parcial que deje una tabla usándolos fallará. Documentar el
   orden seguro.
4. Comprobar que `pgvector` (`0001_init.js:19`, `DROP EXTENSION` en `0001:456`) se
   maneja bien en el ciclo, dado que `0005` y `0009` crean índices HNSW sobre él.
5. Documentar en `docs/runbook-operacion.md` el procedimiento verificado de reversión,
   con los comandos exactos.

---

# Descartado y por qué

Cosas que parecían deuda y que se han comprobado y **no** lo son. Se listan para que no
vuelvan a auditarse.

### `catch` vacíos que se tragan errores — **no existen**

`grep -rn -E "catch\s*\([^)]*\)\s*\{\s*\}"` sobre `server/`, `src/`, `scripts/` y
`server.js`: **cero coincidencias**. Los 12 `catch` de una línea que aparecen llevan
todos un comentario que explica la decisión y son degradaciones deliberadas, no
descuidos. Ejemplos verificados:

- `src/HybridCoach.jsx:1323` — copia local corrupta: se intenta la del servidor.
- `src/HybridCoach.jsx:1342` — sin red o sin sesión: se arranca con perfil vacío,
  *"nunca se bloquea la entrada"*. Coherente con la regla de que registrar siempre debe
  ser posible.
- `server/integrations/foods/factory.js:18` — origen mal formado: se usa tal cual.
- `server/integrations/pdf-extractor.js:43` — `stderr` no era JSON.

No hay tarea aquí.

### Promesas sin `catch` — **todas las que importan lo tienen**

Las 13 cadenas `.then()` encontradas en `src/` se revisaron una por una. Las que hacen
E/S de red terminan en `.catch`:

- `src/index.jsx:28` y `src/index.jsx:90` — ambas con `.catch`.
- `src/HybridCoach.jsx:1527-1530` — `.catch` con comentario: *"Una lectura fallida nunca
  borra la copia utilizable"*.
- `src/HybridCoach.jsx:3562` — `.catch(() => setEsAdmin(false))`, con el comentario que
  aclara que la puerta real es `requireAdmin` en el servidor, no la pestaña oculta.
- `src/HybridCoach.jsx:4639-4640` — dentro de un `try/catch` con `await Promise.all`.

`server/db/repositories/documents.js:264` (`.then((r) => r.rows[0])`) es una
transformación síncrona sobre una promesa que el llamante espera con `await`: el error
se propaga correctamente.

### Variables de `.env.example` declaradas y nunca usadas — **falso positivo**

La primera comparación señaló 52 variables declaradas y aparentemente no leídas
(`LLM_API_KEY`, `RAG_TOP_K_FINAL`, `R2_BUCKET`, `EMBEDDING_*`, `RERANK_*`…). Es un
artefacto del `grep`: `server/ai/factory.js` no usa `process.env.X` sino que recibe un
objeto `env` como parámetro y lee `env.LLM_API_KEY` (`factory.js:50`), patrón que además
es lo que permite probar la factoría sin tocar el entorno real
(`server/ai/providers/providers.test.js:9`).

Verificado por segunda vía, buscando cada nombre de variable como cadena en todo el
árbol de fuentes y configuración:

```
DECLARADAS EN .env.example Y NUNCA MENCIONADAS EN NINGUN FICHERO: 0
```

`.env.example` no tiene ni una variable muerta. El único hueco real es el inverso
(T-04).

### Endpoints sin validación de entrada — **la mayoría sí validan**

Se revisaron los 47 endpoints de `server/routes/`. La validación existe y en varios
sitios es notablemente cuidadosa:

- `api.js:33-35` — `dias` debe ser entero entre 0 y 6.
- `api.js:85` — `entries` debe ser array.
- `api.js:104-127` — `DOCUMENT_ENUMS` con conjuntos cerrados y `invalidDocumentInput()`.
- `api.js:146-151` — una ficha sin fragmentos no puede marcarse como revisada (409).
- `foods.js:79-81` — gramos entre 1 y 5000.
- `foods.js:30` — fecha por expresión regular `^\d{4}-\d{2}-\d{2}$`.
- `foods.js:86` — `momento` contra lista blanca.
- `planning.js:39-45` — `expectedRevision` entero ≥ 1 obligatorio (control optimista).
- `planning.js:96-99` — semana entera ≥ 1.
- `sync.js:296-303` — `operationId` no vacío y ≤ 100 caracteres, `capturedAt` fecha
  válida y no adelantada más de 5 minutos.
- `application.js:128-130` — `weekNumber` entre 1 y 104.

Los huecos concretos que sí quedan están recogidos en T-06 (consulta sin tope) y T-09
(`:id` sin validar en `coach.js:154,175`). No hay una carencia sistémica de validación.

### Riesgo de inyección SQL — **no lo hay**

`server/db/repositories/_helpers.js:6-15` construye `INSERT` interpolando **nombres de
columna**, lo que parece un riesgo. No lo es, y el propio fichero lo razona en
`_helpers.js:3-5`: `data` siempre lo construye el repositorio, nunca lleva claves que
vengan de una petición, y los valores van parametrizados con `$1..$n`. Se verificó en
los llamantes (`completedSessions.js:23-38,117`, `athleteProfiles.js`): todos pasan
objetos con claves literales escritas en el código.

El resto de consultas del árbol usan parámetros posicionales sin excepción.

### Cabeceras de seguridad y CSRF — **cubiertos**

`server/middleware/security.js` fija `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy`, HSTS y una CSP con `default-src 'self'`,
`object-src 'none'` y `frame-ancestors 'none'`. `requireTrustedOrigin` comprueba el
`Origin` en toda mutación y rechaza mutaciones con cookie y sin `Origin`
(`security.js:28-30`). Hay pruebas: `server/middleware/security.test.js`.

La única observación es la dependencia de `NODE_ENV`, ya recogida en T-02.

### Manejador de errores de la API — **correcto**

`server.js:436-455` mapea `23505` a 409, respeta `error.status` en el rango 400–599,
registra método y ruta en los 500 recortando la query *"donde viajan los términos de
búsqueda de alimentos"*, y filtra los mensajes crudos de PostgreSQL con
`/^[0-9A-Z]{5}$/` antes de exponerlos. Coherente con `CLAUDE.md` §8 sobre datos de
salud en logs. No hay tarea.

### Marcadores TODO/FIXME/HACK/XXX — **ninguno real**

12 coincidencias, todas la palabra castellana "TODO"/"TODOS" dentro de prompts
(`server/domain/planning/prompt.js:59` *"CUANDO NO CABE TODO"*), comentarios
(`server/integrations/pdf-extractor.js:64`) o aserciones de prueba
(`server/domain/planning/planning.test.js:580`). Cero marcadores de deuda.

### `express.json({ limit: "2mb" })` — **adecuado**

Parecía bajo para el `POST /api/sync`, que envía el estado completo del perfil. Se
revisó `server/routes/sync.js:294-333` y `src/sync.test.js`: el snapshot es JSON de
perfil, no lleva binarios, y las subidas de PDF van por
`/api/admin/documents/upload` con su propio parseo de cuerpo binario, montado
**antes** que los manejadores JSON genéricos a propósito (`server.js:223-226`). El
límite no afecta a la ruta de PDF.

### Fuente única del presupuesto de tokens — **respetada en el camino principal**

`server/ai/limits.js` gobierna de verdad: `factory.js:49` (`topeSalida`),
`server.js:255` (`topeSalidaPeticion`), `masterEvidence.js:4` y los tres proveedores.
`server/ai/limits.test.js` cubre la propiedad de que subir `LLM_MAX_TOKENS` sube todo a
la vez. Las dos copias residuales están en T-08 y ninguna de las dos altera el
comportamiento efectivo hoy.

### Guardarraíles clínicos delegados al modelo — **no ocurre**

`server/domain/coach/chat.js:26-45` implementa `bloqueoClinico()` como `if` de código
antes de llamar a ningún modelo, incluido el corte por dolor en reposo
(`chat.js:45`). Está probado en `server/domain/coach/validacion.test.js` y
`server/domain/coach/coach.integration.test.js`. Cumple `CLAUDE.md` §4.5. Ninguna tarea
de este backlog toca esa lógica.

### Cobertura de la agenda y el reparto de sesiones — **buena**

`src/agenda.test.js` cubre los casos difíciles y con nombres explícitos: cruce de mes y
de horario de verano, semana sin generar frente a semana de descanso, "omitida solo
existe en el pasado", entrenamiento libre en día de descanso, y *"registrar fuera del
plan o sin semana generada deja de ser un agujero negro"*. Esto último es la regla de
producto de que el plan recomienda y nunca excluye, y está afirmada en prueba. No hay
deuda aquí; lo que falta es la misma afirmación en la capa HTTP (subtarea de T-03).

---

## Orden de ataque sugerido

1. **T-01** — es una línea y desbloquea la función central del producto.
2. **T-02** — es una línea y cierra una exposición de la cookie de sesión.
3. **T-11** — barato, y sin él las pruebas de todo lo demás pueden no ejecutarse.
4. **T-03**, tareas 1–3 — la infraestructura de pruebas HTTP y la regresión de T-01.
5. **T-04** y **T-05** — dos cambios pequeños y acotados, sin riesgo.
6. **T-06**, **T-09**, **T-08** — endurecimiento del borde y limpieza de copias.
7. **T-07** — el corte del monolito, por fases, empezando por `storage.js`.
8. **T-10**, **T-12** — precisión de cobertura.
