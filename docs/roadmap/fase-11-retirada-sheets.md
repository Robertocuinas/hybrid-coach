# Fase 11 · Retirada de Google Sheets

**Dificultad:** baja · **Depende de:** Fase 3

---

## Objetivo

PostgreSQL como única fuente de verdad, con backups reales que sustituyan al respaldo en la
hoja de cálculo.

## Por qué esperar

No hay ninguna prisa. Mantener el export a Sheets unas semanas más cuesta prácticamente
cero y es una red de seguridad mientras el sistema nuevo se asienta.

## Condiciones previas — todas obligatorias

- [ ] 2-3 semanas con Postgres como fuente única sin incidencias
- [ ] `pg_dump` programado hacia R2 funcionando, con rotación de 30 días
- [ ] **Un dump restaurado con éxito en una base de datos de prueba**, con la app arrancando
      contra ella — *un backup no probado no es un backup*
- [ ] Snapshots del servicio gestionado de Railway configurados

## Tareas

- [ ] Script de `pg_dump` programado (cron de Railway o tarea equivalente)
- [ ] Subida del dump a R2 con credenciales **separadas** de las de la aplicación, con
      permisos mínimos
- [ ] Rotación automática a 30 días
- [ ] Prueba de restauración documentada en `docs/runbook-restauracion.md`
- [ ] Quitar `APPS_SCRIPT_URL` de las variables de entorno de Railway
- [ ] Verificar que nada falla sin ella (`/api/estado` debe reportar `hoja: false` sin error)
- [ ] Dejar el código del puente unas semanas más; borrarlo en una limpieza posterior
- [ ] Exportar una copia final de las hojas y archivarla fuera del repositorio
- [ ] Actualizar `README.md` y `.env.example` para reflejar que Sheets ya no se usa

## Criterio de terminado

- [ ] `pg_dump` corre automáticamente y los dumps aparecen en R2
- [ ] Una restauración completa se ha probado y documentado
- [ ] `APPS_SCRIPT_URL` está desactivada y la app funciona con normalidad
- [ ] Existe una copia final archivada de las hojas

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Retirar el respaldo antes de que los backups sean fiables | Las condiciones previas, sin saltarse ninguna. Especialmente la restauración probada |
| El código del puente se queda muerto para siempre | Anotarlo como deuda y limpiarlo en la Fase 12 |

## Notas

Es la fase más fácil de todo el roadmap y la que más tentador es hacer antes de tiempo.
No la adelantes: mientras Sheets siga encendido no molesta a nadie.
