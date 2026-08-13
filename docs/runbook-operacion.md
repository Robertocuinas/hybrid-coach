# Runbook de operación

Estado de referencia: staging en Railway, PostgreSQL + pgvector, autenticación real y dual write temporal.

## Despliegue web

La configuración versionada en `railway.json` define:

- instalación Nixpacks: `npm ci` y el entorno virtual de Python del extractor de PDF,
  ambos en la misma fase declarada en `nixpacks.toml`;
- build: `npm run build`;
- pre-deploy: `npm run migrate`;
- start: `npm start`;
- readiness: `/health/ready`;
- reinicio: solo ante fallo, máximo 10 reintentos.

El pre-deploy debe terminar en código 0. Si una migración falla, Railway no debe publicar
la nueva versión. No se modifican migraciones ya aplicadas: cualquier cambio de esquema es
un archivo nuevo.

## Comprobaciones después de desplegar

1. `/health/live` devuelve HTTP 200.
2. `/health/ready` devuelve HTTP 200 con `db=true` y `pgvector=true`.
3. `/api/estado` devuelve `ok=true`, `db=true`, `pgvector=true`.
4. Login y `/api/auth/me` funcionan.
5. Los logs muestran conciliación verde.

## Rollback web

1. Railway → servicio web → Deployments.
2. Elegir el último despliegue estable y pulsar Redeploy/Rollback.
3. No ejecutar `migrate:down` automáticamente. Las migraciones deben ser compatibles hacia
   atrás durante el rollback de aplicación.
4. Repetir las comprobaciones anteriores.

## Conciliación diaria

El servicio cron usa el mismo repositorio, `/railway.cron.json`, el comando
`npm run reconcile:once` y el horario `0 3 * * *` (UTC). Debe tener `DATABASE_URL` privada.

- salida 0: todos los perfiles están en verde;
- salida 2: existe rojo o snapshot obsoleto;
- salida 1: error técnico.

Cuando exista el cron, el servicio web debe usar `RECONCILIATION_MODE=external` para no
duplicar el job. Hasta entonces puede conservar `RECONCILIATION_MODE=web`.

## Backup lógico manual

Requisito local: `pg_dump` y `pg_restore` de una versión igual o posterior a la del
servidor. Usar temporalmente la URL pública de administración, nunca guardarla en Git.

```powershell
$env:DATABASE_URL = "<URL pública temporal>"
npm run backup:db -- --name staging-AAAA-MM-DD.dump
Remove-Item Env:DATABASE_URL
```

El script crea `migration/backups/*.dump` y su `.sha256`, valida el catálogo mediante
`pg_restore --list` y deja la carpeta fuera de Git. Mover ambos ficheros a almacenamiento
privado cifrado.

## Restauración de prueba

Nunca restaurar encima de staging o producción.

1. Crear una base pgvector vacía y temporal.
2. Ejecutar las migraciones contra ella.
3. Restaurar el dump:

```powershell
pg_restore --clean --if-exists --no-owner --no-acl --dbname "<URL temporal destino>" migration/backups/<archivo>.dump
```

4. Ejecutar `npm run migrate` por si el dump fuese de una versión anterior.
5. Verificar extensiones, migraciones, recuentos y `/health/ready` con una instancia temporal.
6. Eliminar la base temporal solo después de documentar el resultado.

## Producción

Producción requiere un entorno Railway independiente, su propio pgvector, secretos
distintos y dominio propio. No se duplica `SESSION_SECRET` de staging. El registro público
permanece cerrado. Antes de permitir uso real: backup/restauración probados, readiness
verde, cuenta administradora confirmada y política de datos aprobada.

## Alertas mínimas

- despliegue o readiness fallidos;
- PostgreSQL sin conexión o volumen casi lleno;
- ejecución cron no verde;
- crecimiento anormal de errores HTTP 5xx;
- ausencia de conciliación durante más de 36 horas;
- backup manual fuera de la periodicidad acordada.

Sin un monitor externo, Railway healthcheck solo protege el despliegue. Revisar Metrics y
Logs al menos semanalmente mientras el proyecto sea de uso personal.
