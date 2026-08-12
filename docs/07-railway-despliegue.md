# 07 · Despliegue en Railway

## Arquitectura actual de staging

- servicio web/API Express;
- servicio PostgreSQL con pgvector en red privada;
- SPA React servida por Express;
- conciliación temporal dentro del proceso web, preparada para moverse a Railway Cron;
- R2, Strava, LLM y embeddings desactivados hasta configurar credenciales.

## Configuración web versionada

`railway.json`:

```json
{
  "build": { "builder": "NIXPACKS", "buildCommand": "npm run build" },
  "deploy": {
    "preDeployCommand": "npm run migrate",
    "startCommand": "npm start",
    "healthcheckPath": "/health/ready",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

Las migraciones no se ejecutan al reiniciar cada réplica. Railway ejecuta el pre-deploy
dentro de la red privada y no publica el despliegue si el comando falla.

## Variables obligatorias del núcleo

```text
DATABASE_URL=<referencia privada al servicio pgvector>
SESSION_SECRET=<aleatorio, al menos 32 caracteres>
APP_ORIGIN=https://<dominio exacto>
NODE_ENV=production
PGVECTOR_ENABLED=true
PASSWORD_MIN_LENGTH=12
SESSION_TTL_DAYS=30
REGISTRATION_ENABLED=false
```

El primer administrador se asigna explícitamente en PostgreSQL después de registrar la
cuenta. El registro público siempre crea usuarios con rol `athlete`.
Variables de IA, embeddings, R2, Sheets y Strava son opcionales.

## Healthchecks

- `/health/live`: solo confirma que el proceso responde.
- `/health/ready`: exige base de datos y, salvo desactivación expresa, pgvector.
- `/api/estado`: diagnóstico detallado; no sustituye al readiness.

## Railway Cron

Crear un segundo servicio desde el mismo repositorio con config file
`/railway.cron.json`, `DATABASE_URL` privada y horario `0 3 * * *` UTC. El proceso ejecuta
`npm run reconcile:once`, cierra el pool y termina. Al activarlo, poner
`RECONCILIATION_MODE=external` en la web.

## Producción

No reutilizar staging como producción. Crear otro entorno, otro servicio pgvector, otro
`SESSION_SECRET`, otro dominio y otra cuenta administradora. El procedimiento completo,
backup y rollback están en [runbook-operacion.md](runbook-operacion.md).

## Backups

Si el plan permite Backups/PITR, activarlos y probar una restauración en un servicio
separado. En planes sin esa función, usar `npm run backup:db`, conservar `.dump` y
`.sha256` fuera del repositorio y probar la restauración periódicamente.
