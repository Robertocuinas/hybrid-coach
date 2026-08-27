# Fase 16 — Registro y progreso visibles

**Estado:** Hecho (rama `fase-16`, verificado con build + test).

Obligatorias del marco: #3 (registrar lo hecho) y #5 (ver progreso). El trabajo
gira en torno a dos ejes: que el atleta **pueda registrar siempre** (regla dura 10
de CLAUDE.md: el plan recomienda, el registro es un hecho) y que el **historial
no se pierda** en la sincronización (mitigación del bug #4).

---

## 16.1 — Mapeo de tablas de registro/progreso

Revisión de `server/db/repositories/*.js` y `server/db/migrations/0001_init.js`.
**No se ha tocado el esquema**: ya cubre todo lo necesario.

| Tabla | Qué guarda | Clave / detalle |
|---|---|---|
| `completed_sessions` | Registro maestro de una sesión hecha. | `athlete_profile_id`, `planned_session_id` (FK, nullable), `fecha`, `tipo` (`running`/`strength`), `semana`, `created_at`. **No tiene `codigo_sesion` propio** (vive en las tablas detalle). |
| `running_sessions` | Detalle de carrera (1:1 con `completed_sessions`). | `codigo_sesion`, `distancia_km`, `duracion_min`, `ritmo`, `fc_media`, `fc_max`, `desnivel`, `cadencia`, `rpe`, `dolor`, `notas`, `origen` (`manual`/`strava`), `external_id`. |
| `strength_sessions` | Sesión de fuerza (1:1). | `codigo_sesion`. |
| `strength_sets` | Series de una sesión de fuerza. | `orden`, `peso_kg`, `reps`, `rir`, `notas` → `strength_exercises` (`nombre`, `canonical_name`, `provider`, `external_id`). |
| `recovery_logs` | Recuperación diaria. | **Upsert** sobre `(athlete_profile_id, fecha)` — clave única `idx_recovery_logs_profile_fecha`. `horas_sueno`, `calidad_sueno`, `fatiga`, `agujetas`, `estres`, `motivacion`, `dolor`. |
| `feedback_logs` | Sensaciones / check-ins. | `fecha`, `semana`, `rpe`, `sensacion`, `dolor`, `zona_dolor`, `tipo_dolor`, `cuando_aparece`, `energia`, `comentario`. Sin clave única (el cliente fusiona por fecha). |

Flujo de escritura: el cliente registra en `localStorage` (dual-write) y lo empuja
por `POST /api/sync` → `replaceProfileState()` en `server/routes/sync.js`, que
vuelca `running`/`strength`/`checkins`/`recovery` a estas tablas. El orquestador
de la Fase 14 (`server/domain/planning/application.js` → `buildCanonicalPlannerContext`)
lee `completedSessions`, `recovery`, `feedback` y `strengthSets` para generar la
semana adaptativa.

---

## 16.2 — UI de registro de sesiones

El formulario ya existía y es claro; se verificó y se confirma completo:

- `Entrenar` → `RunForm` (carrera): código de sesión (catálogo completo +
  **`LIBRE`** para lo que no encaja), distancia y/o duración (ninguna obligatoria
  por separado), FC, desnivel, cadencia, **RPE** y dolor en rangos, notas.
- `Entrenar` → `StrengthForm` (fuerza): sesión `GYM A–D` + código libre, series con
  peso/reps/RIR precargados de la última vez.
- `Entrenar` → `CheckIn`: RPE, sensación, dolor (con aviso clínico si ≥5/10 o en
  reposo), energía, recuperación.

Cumple la regla 10: cualquier día (descanso, sin semana, fuera de plan, código
`LIBRE`) es registrable. No se obliga ningún campo inútil.

---

## 16.3 — Vista de progreso

`Progreso` (`src/HybridCoach.jsx`) ya mostraba carga semanal (min/km), tirada larga
prevista vs real, 1RM de fuerza y recuperación. **Se añadió la gráfica de RPE**
(esfuerzo percibido) para cerrar el triángulo carga/esfuerzo/recuperación, sin
sobrecargar ni añadir dependencias (Recharts ya estaba).

---

## 16.4 — Mitigación del bug #4 (sync borraba el historial)

**Antes:** `replaceProfileState()` hacía `DELETE FROM completed_sessions WHERE
athlete_profile_id=$1` (más `feedback_logs` y `recovery_logs`) en cada sync, lo que
destruía cualquier sesión del servidor ausente del snapshot del cliente (bug
documentado en `docs/01-estado-actual.md:431` como prioridad Alta).

**Ahora (bug #4 mitigado en `server/routes/sync.js`):**
- `completed_sessions`: **borrado selectivo por clave natural** `(fecha, código de
  sesión)` solo para las sesiones que el cliente está reenviando (carrera vía
  `running_sessions`, fuerza vía `strength_sessions`). Lo que el servidor tenga y
  este cliente no conoce se respeta. Es **idempotente**: reenviar el mismo snapshot
  no crea duplicados.
- `recovery_logs`: **upsert** sobre `(athlete_profile_id, fecha)` (su clave única).
- `feedback_logs`: **borrado selectivo por fecha** presentes en el snapshot.

El dual-write se mantiene (el cliente sigue empujando y el servidor reconcilia, no
destruye). Se respetó `server/jobs/reconciliation.js` (`readyForCutover`, 7 días
verdes): el conteo de totales locales vs base solo diverge cuando hay historial
realmente distinto, que es justo lo que debe bloquear el corte.

**Test:** `server/routes/sync.persistence.test.js` → "el sync respeta el historial
ajeno del servidor y es idempotente (bug #4)" (PGlite, sin BD real). Inserta una
sesión solo-servidor, sincroniza un snapshot que no la incluye y comprueba que
sobrevive y que el reenvío no duplica.

---

## 16.5 — El registro alimenta la semana adaptativa

Verificado por cableado (no se genera a ciegas):
- El registro del cliente llega a `completed_sessions` a través del sync
  (`running` → `completed_sessions`+`running_sessions`; `strength` →
  `completed_sessions`+`strength_sessions`+`strength_sets`).
- `buildCanonicalPlannerContext()` (`server/domain/planning/application.js:295`)
  mapea `canonical.completedSessions`, `recovery`, `feedback` y `strengthSets` al
  contexto del orquestador, que la Fase 14 ya usa para generar la propuesta semanal
  según disponibilidad y historial reales.

---

## Reglas duras respetadas
- Regla 10 (registrar siempre): el formulario `LIBRE` y el estado `libre` de
  `src/agenda.js` siguen permitiendo registrar cualquier día.
- Datos de salud: no se escriben en logs; el `CheckIn` mantiene los avisos clínicos
  como `if` duros.
- Secretos: solo en `env` (sin cambios).
- Presupuesto de tokens: intacto en `server/ai/limits.js` (no tocado).
- Motor determinista: no tocado.
