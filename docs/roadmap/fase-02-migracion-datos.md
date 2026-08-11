# Fase 2 · Migración de datos existentes

**Dificultad:** media · **Depende de:** Fases 0, 1 · **Bloquea a:** Fase 3

---

## Objetivo

Todos los datos históricos vivos en PostgreSQL, verificados contra los totales de origen.
La aplicación **sigue leyendo de `localStorage`**: esta fase carga datos, no cambia el flujo.

## Referencias

- [`../06-migracion.md`](../06-migracion.md) — el procedimiento completo
- `migration/TOTALES-ORIGEN.md` — de la Fase 0

## Tareas

- [ ] `scripts/01-parse-localstorage.js` — parsear el volcado a estructuras intermedias
- [ ] `scripts/02-parse-sheets.js` — parsear los CSV de Sheets
- [ ] `scripts/03-transform.js` — mapeo de campos, limpieza, normalización
      (ver `06-migracion.md` §3 y §4)
- [ ] Normalizar nombres de ejercicios **antes** de mapearlos a `strength_exercises.id`
      (mayúsculas, espacios) — si no, se pierde historial de progresión
- [ ] Generar `uuid v4` nuevos y poblar `legacy_id_map`
- [ ] `scripts/04-load.js` — carga con `UPSERT` idempotente (se puede reejecutar sin duplicar)
- [ ] `scripts/05-verify.js` — todos los checks de `06-migracion.md` §7, en un comando
- [ ] Crear el usuario inicial en `users` y asociarle el perfil existente
- [ ] Ejecutar la migración completa contra una base de datos de prueba primero
- [ ] Ejecutar contra producción
- [ ] Comparación visual: abrir la app leyendo de Postgres (endpoint temporal de solo
      lectura) y comparar pantalla a pantalla con la versión de `localStorage`

## Criterio de terminado

Todos estos checks en verde en `scripts/05-verify.js`:

- [ ] Nº de filas por tabla coincide con origen (menos duplicados eliminados, documentados)
- [ ] Suma de km corridos idéntica
- [ ] Suma de kg movidos idéntica
- [ ] Nº de check-ins y registros de recuperación idéntico
- [ ] Rango de fechas (primera/última sesión) idéntico
- [ ] Cada `athlete_profile` tiene exactamente un `training_plan` activo
- [ ] Ningún `strength_set` huérfano
- [ ] Nº de referencias bibliográficas idéntico
- [ ] El plan y las gráficas se ven igual leyendo de Postgres que de `localStorage`

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **Pérdida silenciosa de filas** | Los checksums de §7. Es el riesgo principal de esta fase |
| Mapeo de ejercicios por nombre que pierde progresión | Normalizar nombres y revisar a mano el mapa resultante |
| Totales cuadran pero las relaciones están torcidas | El check de comparación visual pantalla a pantalla es el que lo detecta |
| Reejecutar el script duplica datos | `UPSERT` con clave natural desde el principio, no `INSERT` |

## Notas

`legacy_id_map` se conserva hasta cerrar la Fase 3 y luego se elimina. Mientras exista,
cualquier discrepancia detectada después se puede rastrear hasta el registro original.
