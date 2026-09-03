# Hybrid Coach

Aplicación de entrenamiento híbrido con React, Express y PostgreSQL + pgvector. Incluye
motor determinista, perfiles por cuenta, sesiones, nutrición, dual write temporal,
conciliación y una capa opcional de IA/RAG.

## Estado

- staging desplegado en Railway;
- autenticación real con Argon2id y cookie HttpOnly;
- PostgreSQL y pgvector operativos;
- registro público disponible, con cierre opcional mediante `REGISTRATION_ENABLED=false`;
- dual write `localStorage` → API activo hasta completar la conciliación;
- IA, embeddings, R2 y Strava opcionales y desactivados si no tienen variables.

## Desarrollo local

Requisitos: Node 20+, PostgreSQL con pgvector para integración real y una
`SESSION_SECRET` de al menos 32 caracteres.

```bash
npm install
npm run build
npm test
npm run migrate
npm start
```

La plantilla completa de variables está en `.env.example`. Nunca se guardan secretos en
Git, en el frontend ni en documentación.

## Railway

El modelo local Needle 2 es opcional y se usa exclusivamente para enrutado estructurado
de herramientas. Consulta [docs/modelo-local-needle.md](docs/modelo-local-needle.md).

`railway.json` define:

- instalación automática de Nixpacks con `npm ci` y build `npm run build`;
- pre-deploy `npm run migrate`;
- start `npm start`;
- healthcheck `/health/ready`.

Servicios esperados en staging:

1. `helpful-endurance`: web/API.
2. `pgvector`: PostgreSQL en la misma red privada.
3. conciliación cron opcional: mismo repositorio, config `/railway.cron.json`, start
   `npm run reconcile:once`, horario `0 3 * * *` UTC.

Consulta [docs/runbook-operacion.md](docs/runbook-operacion.md) para despliegue, rollback,
backup lógico, restauración y creación de producción.

## Endpoints operativos

- `GET /health/live`: proceso vivo.
- `GET /health/ready`: PostgreSQL y pgvector disponibles; devuelve 503 si no está listo.
- `GET /api/estado`: diagnóstico de módulos opcionales.
- `GET /api/auth/me`: sesión actual.
- `GET|PUT|DELETE /api/ai/settings`: proveedor, modelo y clave cifrada de la cuenta.
- `POST /api/ai/settings/test`: prueba autenticada y limitada del proveedor elegido.
- `GET /api/reconciliation-status`: racha diaria de conciliación.

## Datos y seguridad

La aplicación maneja información potencialmente sanitaria. Mantén el repositorio privado,
el registro cerrado y las integraciones externas desactivadas hasta definir consentimiento,
retención y finalidad. Consulta [docs/politica-datos.md](docs/politica-datos.md) y
[docs/08-seguridad.md](docs/08-seguridad.md).

La cuenta puede exportarse desde `GET /api/auth/export`. Ajustes permite cambiar la
contraseña, borrar la cuenta y elegir GPT o Claude sin editar código. Las claves de IA se
cifran en PostgreSQL y se excluyen de las respuestas y exportaciones.

## Pruebas

```bash
npm test
```

La suite cubre sincronización, aislamiento entre usuarios, ingesta, embeddings, retrieval,
citas, RAG, conciliación y el motor determinista.

## Límites actuales

- PostgreSQL todavía es espejo recuperable, pero `localStorage` sigue siendo la fuente de
  verdad durante el periodo de conciliación.
- No se debe ejecutar el corte hasta siete días verdes consecutivos.
- Los backups nativos de Railway requieren un plan compatible; mientras tanto se usa
  exportación JSON y `npm run backup:db` con almacenamiento privado externo.
- No escalar a varias réplicas mientras Strava y jobs sigan teniendo estado de proceso.

## Documentación adicional

La arquitectura, decisiones y runbook viven en `docs/`:

- `docs/runbook-operacion.md` — despliegue, rollback, backup y restore.
- `docs/08-seguridad.md` — política de seguridad y CSP.
- `docs/04-capa-ia.md` y `docs/05-rag.md` — capa de IA y RAG.
- `docs/03-modelo-datos.md` y `docs/06-migracion.md` — esquema y migraciones.
- `docs/12-arquitectura-backend.md` y `docs/13-frontend-y-agenda.md` — detalle backend y frontend.
- `CLAUDE.md` — instrucciones operativas para el agente que trabaja sobre este repo.

`CLAUDE.md` y `GUIA-INSTALACION.md` son las dos puertas de entrada si vienes a tocar
algo: léelas antes de cambiar nada.
