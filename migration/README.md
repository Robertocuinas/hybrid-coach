# Migración a PostgreSQL — cómo ejecutarla

Scripts de la **Fase 2** ([`../docs/roadmap/fase-02-migracion-datos.md`](../docs/roadmap/fase-02-migracion-datos.md)).
Llevan los datos de `localStorage` a PostgreSQL y verifican que no se ha perdido nada.

> **La aplicación no cambia.** Esta fase carga datos; sigue leyendo de `localStorage`.
> Nada de lo que hagas aquí afecta a lo que ves en la app.

---

## Antes de empezar

1. **Fase 0 hecha**: los volcados de cada dispositivo en `source/`, y `TOTALES-ORIGEN.md`
   relleno con los números contados a mano.
2. **Fase 1 hecha**: `npm run migrate` ejecutado contra la base de datos destino.
3. `DATABASE_URL` apuntando a esa base de datos.

`source/` está en `.gitignore` — **son datos de salud reales y no se commitean nunca**.

---

## Ejecución

```bash
# Un paso suelto
npm run migrate:data -- --step 01

# Todo seguido (01 → 05)
npm run migrate:data
```

| Paso | Qué hace | Necesita `DATABASE_URL` |
|---|---|---|
| `01` | Parsea y valida los volcados de `source/*.json` → `parsed/localstorage/` | no |
| `02` | Parsea los CSV de Sheets → `parsed/sheets/` (opcional) | no |
| `03` | Transforma a la forma relacional → `transformed/migration.json` | no |
| `04` | Carga en PostgreSQL | **sí** |
| `05` | Verifica y da el reporte ROJO/VERDE | **sí** |

Los pasos 01-03 no tocan la base de datos: puedes repetirlos y revisar
`transformed/migration.json` a mano antes de cargar nada.

### Orden recomendado la primera vez

```bash
npm run migrate:data -- --step 01     # ¿parsean todos los volcados?
npm run migrate:data -- --step 03     # ¿cuadran los totales que imprime?
# revisar transformed/migration.json y transformed/rechazados.json
npm run migrate:data -- --step 04     # cargar
npm run migrate:data -- --step 05     # verificar
```

---

## El reporte de verificación

El paso 05 imprime una línea por check y termina en **MIGRACIÓN EN VERDE** o
**EN ROJO**. Sale con código 1 si algo falla, así que se puede encadenar:

```bash
npm run migrate:data -- --step 04 && npm run migrate:data -- --step 05
```

Comprueba: recuentos por tabla, suma de km, suma de kg movidos (peso × reps),
rango de fechas, que cada perfil tenga exactamente un plan activo, que no haya
filas huérfanas ni duplicados por día, y la trazabilidad de `legacy_id_map`.

Si `TOTALES-ORIGEN.md` tiene números rellenos, los contrasta también contra la
base de datos. **Merece la pena rellenarlo**: los demás checks comparan el
fichero transformado contra PostgreSQL, así que detectan un fallo de *carga*
pero no uno de *transformación*. Los totales contados a mano son lo único que
cierra ese círculo.

### Si sale en ROJO

El reporte dice el valor esperado y el real de cada check que falla. Lo normal es:

- **Recuento menor del esperado** → mira `transformed/rechazados.json`: filas sin
  fecha o con RPE/dolor fuera de rango, que se rechazan a propósito en vez de
  truncarlas en silencio.
- **Recuento mayor** → había datos previos en las tablas. Los scripts son
  idempotentes entre sí, pero no borran lo que hubiera antes de otra fuente.
- **Suma de km o kg distinta** → es el síntoma más serio. No sigas: revisa
  `transformed/migration.json` contra el volcado original.

---

## Reejecutar es seguro

Todo el flujo se puede repetir cuantas veces haga falta sin duplicar nada.

Los UUID **no son aleatorios**: se derivan de la clave natural de cada registro
(fecha + código de sesión + duración para una carrera, etc.), así que el mismo
dato de origen produce siempre el mismo identificador y la carga actúa como
UPSERT sobre clave natural, como exige [`../docs/06-migracion.md`](../docs/06-migracion.md) §1.
Corregir algo en el paso 03 y recargar **actualiza** las filas, no las duplica.

---

## Qué hace el paso 03 con los datos sucios

| Situación | Tratamiento |
|---|---|
| Cadenas vacías | → `NULL` |
| El mismo perfil en varios dispositivos | Se fusiona en uno solo (clave: nombre normalizado). Los escalares salen del volcado más antiguo; el historial se une y se deduplica |
| Mismo ejercicio con distinta grafía | Se unifican (`Sentadilla`, `sentadilla `, `SENTADILLA` → uno). **Es lo que evita perder el historial de progresión de carga** |
| Sesión repetida entre dispositivos | Se descarta por clave natural (§6 del doc de migración) |
| RPE o dolor fuera de rango | Fila rechazada y registrada en `transformed/rechazados.json`, nunca truncada |
| Fila sin fecha | Rechazada igual |
| `grado` de la bibliografía | Se traduce a `evidence_grade`. `study_type` queda vacío: el dato de origen mezcla ambas cosas y no se puede derivar con fiabilidad (ver [`../docs/10-decisiones-tecnicas.md`](../docs/10-decisiones-tecnicas.md) D9) |

Al terminar, el paso 03 imprime cuántos duplicados descartó por tabla. Contrasta
esos números con `DISCREPANCIAS.md`: deberían explicarse solos.

---

## Qué NO migra este paso, y por qué

Se migra todo lo que es **hecho histórico**: sesiones registradas, series,
recuperación, check-ins, cambios de plan, chat, catálogo de comidas y
bibliografía.

**No** se migran `training_weeks`, `planned_sessions`, `routines` ni
`plan_decisions`. No es un olvido: esa estructura la produce el motor
determinista (`buildPlan()` / `generateWeek()` en `src/HybridCoach.jsx`) a
partir del perfil, que sí se migra. Reimplementar el motor dentro de un script
de migración significaría mantener dos copias de las reglas que protegen la
integridad física del atleta, con el riesgo de que diverjan. Sí se migra un
resumen plano en `training_plans` (semanas totales, taper, riesgo) porque esos
valores son historia real, no estructura derivada.

Consecuencia práctica: tras migrar, el plan se regenera desde el perfil. Si
habías **editado rutinas a mano**, esas ediciones viven hoy solo en
`localStorage` y no se trasladan. Anótalo en `DISCREPANCIAS.md` si te afecta.

---

## El último check no lo hace ningún script

Aunque los 24 checks salgan en verde, falta el que de verdad importa
([`../docs/06-migracion.md`](../docs/06-migracion.md) §7): **abrir la aplicación
y comparar pantalla a pantalla** con la versión que lee de `localStorage`. Los
totales pueden cuadrar y aun así verse mal si una relación quedó torcida.

---

## Ficheros que genera

```
parsed/          intermedios de los pasos 01 y 02
transformed/
  migration.json  lo que se va a cargar — revisable a mano
  rechazados.json filas descartadas y por qué
```

Ninguno se commitea: derivan de datos de salud. Puedes borrarlos y regenerarlos.

`legacy_id_map` (en la base de datos) guarda la correspondencia entre los IDs
viejos y los nuevos. Se conserva hasta cerrar la Fase 3 y luego se elimina;
mientras exista, cualquier discrepancia se puede rastrear hasta el registro
original.
