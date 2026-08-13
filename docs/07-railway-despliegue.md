# 07 · Despliegue en Railway

## Arquitectura actual de staging

- servicio web/API Express;
- servicio PostgreSQL con pgvector en red privada;
- SPA React servida por Express;
- conciliación temporal dentro del proceso web, preparada para moverse a Railway Cron;
- runtime de extracción de PDF (Python + PyMuPDF) incluido en la imagen vía `nixpacks.toml`;
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

## Subida de bibliografía en PDF

La ingesta necesita **dos** cosas en el servidor, no solo una. Faltando cualquiera, el panel
de administración deshabilita el selector de archivo y dice cuál falta.

### 1. Runtime de extracción (versionado, no hay nada que configurar)

El texto se extrae en un subproceso de Python con PyMuPDF. La imagen que Nixpacks deduce
del repositorio es solo Node, así que `nixpacks.toml` añade `python3` y crea un entorno
virtual en `.venv` durante la fase de instalación, junto a `npm ci`.
`server/integrations/pdf-extractor.js` lo encuentra solo; `PYTHON_BIN` únicamente hace
falta para forzar otro intérprete.

### 2. Credenciales de Cloudflare R2 (secretos, se ponen a mano)

El PDF original nunca va a PostgreSQL, solo su `storage_key`. En Cloudflare: **R2 → Create
bucket**, y después **Manage R2 API Tokens → Create API Token** con permiso *Object Read &
Write* restringido a ese bucket. De ahí salen las cuatro variables del servicio web:

```text
R2_ACCOUNT_ID=<Account ID de Cloudflare, no el del token>
R2_ACCESS_KEY_ID=<Access Key ID del token>
R2_SECRET_ACCESS_KEY=<Secret Access Key, solo se muestra al crearlo>
R2_BUCKET=<nombre exacto del bucket>
```

`R2_PUBLIC_BASE_URL` y `R2_ENDPOINT` son opcionales: la primera solo si el bucket tiene
dominio propio, la segunda solo para apuntar a un S3 local en pruebas.

El bucket **no debe ser público**. Sin dominio propio el PDF se sirve por el endpoint
autenticado del servidor, que es el comportamiento por defecto y el que conviene:
la bibliografía es material con licencia.

### Comprobación

`GET /api/admin/storage/estado` (sesión admin) responde con `r2`, `r2Faltan` —nombres de
variables sin valor, nunca valores—, `r2Acceso` —si el bucket contesta de verdad— y
`extractor` —si Python y PyMuPDF están—. Es la vía rápida para saber si falta configuración
o si el token no tiene permisos, sin gastar una ingesta entera en averiguarlo.

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
