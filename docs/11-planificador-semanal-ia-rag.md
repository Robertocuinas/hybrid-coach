# 11 · Planificador semanal IA + RAG

Este documento describe el flujo operativo que convierte el plan maestro en una propuesta
semanal personalizada y auditable. La IA **no sustituye** al plan maestro ni activa cambios
por sí sola: produce una revisión táctica que solo pasa a ser vigente cuando el atleta la
acepta explícitamente.

## 1. Frontera de decisión

El reparto de responsabilidades es deliberado:

| Capa | Decide o calcula | No puede hacer |
|---|---|---|
| Plan maestro determinista | objetivo, fecha, fases, número de sesiones y límites estructurales | adaptarse libremente a una respuesta del modelo |
| Analítica determinista | adherencia, volumen, monotonía, carga aguda/crónica, tendencias de RPE/dolor/fatiga y estado de seguridad | inferir recomendaciones clínicas |
| RAG | recupera fragmentos científicos aplicables al contexto actual | crear evidencia que no esté en la biblioteca |
| LLM | ordena las sesiones de la semana y explica ajustes tácticos dentro del contrato | activar cambios, saltarse disponibilidad o modificar estructura y límites |
| Guardarraíles de código | valida esquema, fechas, disponibilidad, cargas y señales clínicas | delegar una excepción al prompt |
| Atleta | acepta o rechaza la propuesta | — |

Una revisión aceptada tiene prioridad para esa semana. Si no existe una revisión aceptada,
los consumidores usan las sesiones del plan maestro. Rechazar una propuesta no modifica la
agenda activa.

## 2. Flujo de extremo a extremo

1. El servidor identifica el `athlete_profile_id` desde la sesión autenticada; nunca lo toma
   de la URL ni del cuerpo.
2. Lee de PostgreSQL el perfil, lesiones/molestias actuales, disponibilidad vigente, plan
   maestro y semana, revisión aceptada previa, sesiones completadas, series, recuperación y
   check-ins.
3. Calcula señales reproducibles sobre ventanas recientes. Este paso no llama a un modelo.
4. Construye entre una y cinco consultas RAG según las señales relevantes (distribución,
   interferencia fuerza-carrera, dolor, recuperación o progresión).
5. Ejecuta retrieval, elimina duplicados y relleno, prioriza la jerarquía metodológica,
   limita fragmentos por documento y comprueba cobertura de las consultas obligatorias.
6. Si la evidencia es suficiente, hace una llamada al LLM con salida JSON estricta. Solo si
   la validación falla puede hacer una segunda llamada de reparación.
7. Valida el JSON, los IDs de citas, las fechas y la disponibilidad; después ejecuta los
   guardarraíles deterministas. Dolor en reposo, banderas rojas o una combinación insegura
   detienen el flujo sin depender del texto del prompt.
8. Persiste la ejecución, evidencia usada, resultados de validación y guardarraíles, y crea
   una revisión semanal en estado `draft` con sesiones inmutables.
9. La interfaz muestra sesiones, razones, avisos y citas. Aceptar cambia la revisión a
   `accepted` mediante transacción; rechazarla la deja como `rejected`.
10. Al aceptar una revisión nueva, la aceptada anterior de esa misma semana pasa a
    `superseded`. El índice parcial de PostgreSQL impide dos revisiones aceptadas a la vez.

El flujo de cambios sugeridos desde Coach usa la misma frontera: el mensaje puede originar
una propuesta, pero el usuario debe resolverla en los endpoints de planning antes de que
afecte a la semana.

## 3. Contrato HTTP

Todos los endpoints requieren cookie de sesión y perfil activo. El servidor deriva el
perfil de esa sesión y responde `404` tanto si el recurso no existe como si pertenece a
otra cuenta.

### Disponibilidad

```http
GET /api/profile/availability
PUT /api/profile/availability
Content-Type: application/json

{
  "dias": [0, 2, 5],
  "minGym": 45,
  "minRun": 40,
  "minFinde": 75
}
```

Los días usan `0=lunes` … `6=domingo`. El `PUT` crea una nueva vigencia; no reescribe el
histórico.

### Crear una propuesta

```http
POST /api/planning/weeks/:week/proposals
Content-Type: application/json

{
  "availabilityDays": [0, 2, 4, 6],
  "gym": true,
  "correr": true,
  "dolor": 0,
  "fatiga": 4
}
```

`:week` es un entero positivo del plan maestro activo. Los campos del cuerpo son señales de
la interacción actual; el servidor vuelve a comprobar sus rangos y nunca acepta IDs de
perfil o plan enviados por el cliente.

Una respuesta válida contiene, como mínimo, estos cuatro bloques (pueden llegar dentro de
un envoltorio `proposal`):

```json
{
  "ok": true,
  "proposal": {
    "id": "uuid",
    "revisionNumber": 2,
    "status": "draft",
    "weekNumber": 5,
    "weekStart": "2026-09-07",
    "weekEnd": "2026-09-13",
    "summary": "Distribución ajustada a la disponibilidad",
    "evidenceState": "sufficient",
    "confidence": 0.82,
    "sessions": [],
    "evidence": [],
    "guardrails": []
  }
}
```

Una sesión incluye una clave estable, fecha/día, orden, modalidad, tipo, código compatible
con el plan maestro, duración, intensidad estructurada, prescripción, objetivo y razón
pública. Cada cita expuesta conserva el UUID real de `document_chunks`; no se aceptan IDs
inventados por el modelo.

### Consultar y resolver una propuesta

```http
GET  /api/planning/weeks/:week/accepted
GET  /api/planning/proposals/:id
POST /api/planning/proposals/:id/accept
POST /api/planning/proposals/:id/reject
Content-Type: application/json

{ "expectedRevision": 2 }
```

El primer endpoint devuelve la revisión aceptada de la semana del plan activo, o `null`, y
permite que PostgreSQL vuelva a hidratar la agenda en otro navegador. `expectedRevision`
implementa concurrencia optimista. Una revisión obsoleta, perteneciente a un plan maestro
sustituido o generada antes de un cambio clínico/ejecución responde `409`; una repetición de
la misma decisión es idempotente. Aceptar es la única operación que cambia cuál es la agenda
semanal vigente.

Errores públicos usan `{ "code": "...", "message": "..." }` sin prompts, datos de otros
usuarios ni mensajes internos del proveedor.

## 4. Persistencia y trazabilidad

Las migraciones `0010_weekly_planning.js` y `0011_planning_and_evidence_integrity.js` añaden:

| Entidad | Propósito |
|---|---|
| `planning_runs` | snapshot mínimo, hash estable, versiones de prompt/esquema/reglas, proveedor/modelo, analítica, consultas, diagnósticos, salida validada, fallos y latencia |
| `planning_run_evidence` | chunks recuperados por consulta, ranking/scores y si llegaron al modelo o fueron citados |
| `guardrail_results` | regla/version, resultado, severidad y detalle reproducible |
| `weekly_plan_revisions` | cabecera versionada de una propuesta y su decisión humana |
| `weekly_plan_sessions` | copia inmutable de las sesiones pertenecientes a una revisión |
| `plan_change_proposals` | cambio puntual originado por Coach y su ciclo de aceptación |

También añade `training_plans.structure_hash`, `training_weeks.inicio`,
`athlete_profiles.current_complaints`, restricciones de rango y una clave única estable para
las sesiones maestras.

`0011` incorpora `planning_context_version`, que cambia con perfil, lesiones,
disponibilidad, sesiones realizadas, molestias, recuperación y series. Crear y aceptar una
propuesta compara esa versión y el `structure_hash`; así un borrador no sobrevive en silencio
a datos nuevos. La lectura canónica usa una transacción `REPEATABLE READ READ ONLY`.

La trazabilidad de una propuesta se recorre así:

```text
weekly_plan_revision
  ├─ planning_run ── planning_run_evidence ── document_chunk ── document
  │                └─ guardrail_results
  └─ weekly_plan_sessions
```

Se guarda la versión del prompt y de las reglas, no el prompt completo. Los logs de
aplicación no deben imprimir `input_snapshot`, dolor, lesiones, claves ni contenido del
proveedor. La exportación de cuenta incluye estas entidades, filtrando primero las raíces
por `athlete_profile_id` y recorriendo después únicamente sus IDs hijos.

## 5. Degradación segura

| Situación | Resultado | ¿Se llama al LLM? | Agenda vigente |
|---|---|---:|---|
| contexto o semana inválidos | error validado | no | no cambia |
| dolor en reposo o banderas rojas | fallback clínico conservador | no | no cambia |
| retrieval caído | `retrieval_failed` | no | no cambia |
| evidencia vacía o sin cobertura | `no_evidence` | no | no cambia |
| proveedor LLM no configurado/caído | `llm_failed` | intento fallido | no cambia |
| JSON inválido | una reparación; después fallback | hasta 2 llamadas | no cambia |
| guardarraíl duro incumplido | propuesta descartada | 1 o 2 | no cambia |
| interfaz o red no disponibles | puede ofrecer semana determinista local señalada como fallback | no desde cliente | solo cambia tras aceptación explícita |

El fallback determinista conserva continuidad del producto, pero nunca se presenta como una
recomendación respaldada por RAG. Se oculta ante dolor alto, dolor en reposo, banderas rojas
o un fallo de guardarraíl, y tampoco puede aceptarse si conserva violaciones. No hay
evidencia suficiente significa exactamente eso; no autoriza al modelo a completar desde
memoria.

## 6. Despliegue de la migración

La migración es aditiva, pero la aplicación nueva consulta sus tablas. Orden recomendado:

1. Crear y verificar un backup lógico (`npm run backup:db`).
2. Desplegar una revisión de mantenimiento o ejecutar `npm run migrate` contra el entorno
   correcto antes de enrutar tráfico a la aplicación nueva.
3. Confirmar que `0010_weekly_planning.js` y `0011_planning_and_evidence_integrity.js`
   figuran aplicadas.
4. Verificar tablas e índice de exclusividad:

   ```sql
   SELECT to_regclass('public.planning_runs'),
          to_regclass('public.weekly_plan_revisions'),
          to_regclass('public.weekly_plan_sessions'),
          to_regclass('public.idx_weekly_plan_one_accepted');
   ```

5. Ejecutar una propuesta de prueba, comprobar que queda `draft`, rechazarla y confirmar que
   el plan maestro sigue siendo el leído por la agenda.
6. Crear otra propuesta, aceptarla y comprobar que existe una sola `accepted` para la
   semana y que sus citas apuntan a chunks existentes.
7. Vigilar errores `409`, fallos de retrieval/LLM, guardarraíles fallidos y latencia p95.

### Rollback

La primera opción es **rollback de aplicación**: volver al artefacto anterior y conservar
las tablas aditivas. El código anterior las ignora y así no se pierde el historial generado.

Solo ejecutar `npm run migrate:down` si se ha confirmado que ninguna instancia nueva sigue
activa y se ha hecho un backup/export de las propuestas. El `down` de 0010 elimina todas las
revisiones, sesiones propuestas, evidencia y resultados de guardarraíles; esa información
no se recupera sin restaurar el backup. Después del `down`, desplegar una versión que no
consulte esas tablas y comprobar `/health/ready`.

## 7. Sistema anterior frente al nuevo

| Aspecto | Sistema anterior | Planificador semanal IA + RAG |
|---|---|---|
| Fuente operativa | estado semanal principalmente en `localStorage` | contexto y revisiones en PostgreSQL; compatibilidad local durante el corte |
| Planificación | distribución heurística predeterminada | plan maestro determinista + ajuste semanal contextual |
| Historial usado | estado disponible en el navegador | sesiones, series, recuperación, check-ins y disponibilidad canónicos |
| Evidencia | justificación posterior o bibliografía general | retrieval previo, cobertura obligatoria y cita a chunk exacto |
| Salida del modelo | texto/JSON con validación limitada al caso | esquema semanal cerrado, reparación única y rechazo si sigue inválido |
| Seguridad | reglas deterministas del motor | mismas reglas más guardarraíles sobre cada propuesta y bloqueo clínico temprano |
| Activación | actualización local inmediata | `draft` hasta aceptación explícita y transaccional |
| Versionado | snapshot mutable por semana | revisiones inmutables, una aceptada y anteriores `superseded` |
| Concurrencia | última escritura local gana | `expectedRevision` y `409` para propuestas obsoletas |
| Auditoría | decisiones y logs parciales | ejecución, entradas hasheadas, consultas, evidencia, validaciones, reglas y decisión |
| Fallo de IA/RAG | experiencia irregular según el punto de llamada | fallback explícito; el plan vigente nunca se modifica |
| Aislamiento | condicionado al estado local | consultas en servidor filtradas por perfil derivado de la sesión |
| Coste | variable según flujo | una llamada principal y, solo si hace falta, una reparación |

## 8. Criterios mínimos antes de producción

- migración y rollback probados sobre una restauración temporal;
- aislamiento entre dos cuentas probado para crear, leer, aceptar, rechazar y exportar;
- ninguna revisión se activa sin aceptación;
- cero citas a chunks inexistentes;
- dolor alto, dolor en reposo y banderas rojas cubiertos por pruebas deterministas;
- fallback ejercitado con retrieval y LLM desconectados;
- métricas de `citation_correctness`, `refusal_accuracy`, fallo JSON, guardarraíles, coste y
  latencia comparadas con el baseline;
- `npm test` y `npm run build` verdes.
