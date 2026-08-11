# Fase 0 · Auditoría y volcado de datos

**Dificultad:** baja · **Depende de:** nada · **Bloquea a:** Fase 1

---

## Objetivo

Tener una copia completa, verificada y fuera del navegador de todos los datos que existen
hoy, antes de tocar nada. Es la red de seguridad de todo lo demás.

## Por qué primero

Todo el estado vive en `localStorage`. Un navegador que se limpia solo, una actualización
del sistema o un cambio de móvil borra meses de historial. Ahora mismo **no hay copia**.

## Tareas

- [ ] Exportar `localStorage` desde **cada dispositivo** donde hayas usado la app
      (`copy(localStorage.getItem('hybridcoach:v2'))` en la consola del navegador)
- [ ] Guardar los volcados en `migration/source/localstorage-<dispositivo>-<fecha>.json`
- [ ] Añadir `migration/source/` a `.gitignore` — **son datos de salud reales**
- [ ] Exportar cada hoja de Google Sheets a CSV en `migration/source/sheets/`
- [ ] Comparar ambas fuentes y documentar diferencias en `migration/DISCREPANCIAS.md`
- [ ] Contar y anotar los totales de referencia:
      - nº de sesiones de carrera y suma de km
      - nº de series de fuerza y suma de kg movidos (peso × reps)
      - nº de check-ins y de registros de recuperación
      - nº de referencias bibliográficas
      - primera y última fecha con datos
- [ ] Guardar esos totales en `migration/TOTALES-ORIGEN.md` — se usarán para validar la
      migración en la Fase 2
- [ ] Copia de seguridad de los volcados fuera del repositorio (disco externo o
      almacenamiento cifrado personal)

## Criterio de terminado

- Existe un volcado JSON íntegro de cada dispositivo, guardado fuera del navegador.
- `TOTALES-ORIGEN.md` tiene los números de referencia.
- `DISCREPANCIAS.md` explica cada diferencia entre `localStorage` y Sheets.
- `migration/source/` está en `.gitignore` y confirmado que no se ha commiteado nada.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Commitear datos de salud al repositorio | `.gitignore` **antes** de crear la carpeta; verificar con `git status` |
| Olvidar un dispositivo con datos | Listar explícitamente todos los navegadores/móviles usados |
| El volcado se corta al copiarlo desde consola | Verificar que el JSON parsea completo antes de dar la tarea por hecha |

## Notas

Este es también el momento de decidir qué dispositivo tiene el estado "bueno" si hay varios
con historial divergente. Regla por defecto: el que tenga la fecha más reciente **y** más
registros; documentar la decisión en `DISCREPANCIAS.md`.
