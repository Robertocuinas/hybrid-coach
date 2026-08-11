# 07 · Despliegue en Railway

---

## 1. Servicios

| Servicio | Tipo | Cuándo crearlo |
|---|---|---|
| **App** (Express: API + SPA + orquestador IA) | El servicio Node actual, ampliado | Ya existe |
| **PostgreSQL + pgvector** | Servicio gestionado de Railway | Fase 1 |
| **Worker de ingesta de PDFs** | Servicio separado | **Solo si hace falta** — ver §2 |
| **Almacenamiento de PDFs** | Cloudflare R2, externo a Railway | Fase 5 |

### PostgreSQL con pgvector

Dos caminos:
- **Plantilla de Railway con pgvector preinstalado** (hay imágenes de Postgres 17/18 con la
  extensión lista). Es el camino limpio si empiezas de cero.
- **`CREATE EXTENSION vector;`** sobre un Postgres de Railway ya existente. Históricamente
  esto ha sido menos directo en servicios ya creados; si da problemas, la vía documentada es
  desplegar la plantilla con pgvector y migrar con `pg_dump`.

Como no tienes datos aún en Postgres, **empieza directamente con la plantilla que ya trae
pgvector**. Te ahorras el problema.

Railway inyecta `DATABASE_URL` automáticamente al enlazar el servicio de base de datos con
el de aplicación, y la conexión va por red privada del proyecto (no expuesta a internet).

## 2. Por qué NO separar servicios todavía

El "Service Layer" de [`02-arquitectura-objetivo.md`](02-arquitectura-objetivo.md) §3 son
**carpetas dentro del mismo proceso**, no despliegues independientes.

Separarías el worker de ingesta solo cuando se cumpla una de estas dos condiciones:
- procesar un PDF tarda lo suficiente como para bloquear peticiones normales del usuario;
- quieres procesar lotes grandes (reindexar toda la biblioteca al cambiar de modelo de
  embeddings) sin afectar a la app.

Hasta entonces, un endpoint de administración protegido en el mismo proceso es suficiente y
mucho más fácil de operar. Para reindexados puntuales, un script ejecutado a mano contra la
base de datos también sirve.

## 3. Variables de entorno

### Existentes
```bash
APP_PASSWORD=                  # se retira al implementar auth real (Fase 3)
ANTHROPIC_API_KEY=             # migra a LLM_API_KEY (Fase 3)
APPS_SCRIPT_URL=               # se retira en Fase 11
SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_JSON=
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
MODELO_IA=                     # migra a LLM_MODEL
```

### Nuevas
```bash
# Base de datos — la inyecta Railway al enlazar el servicio
DATABASE_URL=

# Sesión
SESSION_SECRET=                # cadena aleatoria larga, obligatoria en Fase 3

# Capa de IA — ver docs/04-capa-ia.md §6
LLM_PROVIDER=
LLM_MODEL=
LLM_API_KEY=
LLM_BASE_URL=
EMBEDDING_PROVIDER=
EMBEDDING_MODEL=
EMBEDDING_API_KEY=
EMBEDDING_BASE_URL=
EMBEDDING_DIMENSIONS=1024
RERANK_PROVIDER=
RERANK_MODEL=
RERANK_API_KEY=

# Almacenamiento de objetos (Cloudflare R2, API compatible con S3)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=            # opcional, si sirves PDFs por dominio propio
R2_SIGNED_URL_TTL_SECONDS=300  # enlace temporal al PDF citado; rango permitido 60-900 s

# RAG
RAG_MIN_SCORE=                 # umbral por debajo del cual se responde "sin evidencia"
RAG_TOP_K_RETRIEVAL=25
RAG_TOP_K_FINAL=8
```

**Ninguna en el código, ninguna en el bundle del navegador.** Ver
[`08-seguridad.md`](08-seguridad.md).

## 4. Almacenamiento de PDFs

| Opción | Coste | Veredicto |
|---|---|---|
| **Cloudflare R2** | $0,015/GB-mes, **egress $0**, 10 GB gratis | **Elegido.** API compatible con S3, sin coste de salida (relevante si el visor sirve PDFs al navegador) |
| Railway Volume | incluido en el consumo | Acopla el almacenamiento al ciclo de vida del servicio; frágil ante recreación |
| AWS S3 | ~$0,023/GB-mes + $0,09/GB egress | Más caro en egress sin ventaja aquí |
| Supabase Storage | requiere adoptar Supabase | Solo si migraras todo el stack, que no es el plan |
| PostgreSQL (`bytea`) | — | **Nunca.** Infla los backups y degrada el motor relacional |

En `documents` se guarda solo `storage_key`, nunca el binario.

## 5. Backups

Dos capas:

1. **Snapshots del servicio gestionado de Railway** — automáticos, configurables.
2. **`pg_dump` programado al bucket de R2**, con rotación de 30 días. Es tu copia
   independiente del proveedor.

> **Un backup no probado no es un backup.** Antes de retirar Google Sheets (Fase 11),
> restaura al menos una vez un dump completo en una base de datos de prueba y comprueba que
> la app arranca contra ella.

## 6. Costes estimados

Órdenes de magnitud, no cifras exactas.

| Escala | Railway | Embeddings | LLM | R2 | Total aprox./mes |
|---|---|---|---|---|---|
| 1 usuario (tú) | Hobby $5 | ~$2 una sola vez en la ingesta inicial (~300 papers) | unos pocos $ con uso diario | céntimos | **~$8-15** |
| 10 usuarios | $5-20 según consumo | marginal (biblioteca compartida) | $20-40 | céntimos | **~$40-80** |
| 100 usuarios | Pro $20 + consumo real | marginal | cientos de $ | marginal | **~$300-800** |
| 1000 usuarios | dimensionar Postgres, separar worker | marginal | dominante | marginal (pocos GB) | **miles**, y aquí el diseño cambia |

**Patrón importante:** la infraestructura es barata y escala suavemente; lo que crece con
usuarios es el **coste del LLM**. Es una razón más para el reparto de responsabilidad de
[`02-arquitectura-objetivo.md`](02-arquitectura-objetivo.md) §6: cuanta más decisión resuelve
el código determinista sin llamar al modelo, menor es el coste marginal por usuario.

Palancas si el coste del LLM se dispara:
- prompt caching (descuento sustancial en el bloque estable de perfil/plan),
- modelo más barato para tareas que no requieren el más capaz (resúmenes de conversación,
  clasificación),
- un modelo local para el chat conversacional (ver [`04-capa-ia.md`](04-capa-ia.md)).

Precios de referencia (agosto 2026): Railway Hobby $5/mes, Pro $20/mes, ambos con consumo
por encima del crédito incluido. R2 $0,015/GB-mes con egress gratuito. Embeddings entre
$0,02 y $0,13 por millón de tokens según proveedor. Reranking ~$0,001 por búsqueda.
**Verificar antes de decidir: cambian.**

## 7. Build y arranque

`railway.json` actual sirve tal cual:

```json
{
  "build":  { "builder": "NIXPACKS", "buildCommand": "npm install && npm run build" },
  "deploy": { "startCommand": "npm start", "restartPolicyType": "ON_FAILURE" }
}
```

A partir de la Fase 1 hay que añadir la ejecución de migraciones antes del arranque. Dos
opciones:
- `startCommand: "npm run migrate && npm start"` — simple, pero las migraciones corren en
  cada arranque de cada instancia (con una sola instancia no es problema);
- un comando de release separado si Railway lo permite en tu plan — más limpio.

Con una sola instancia, la primera opción es suficiente. Las herramientas de migración
serias son idempotentes: no reaplican lo ya aplicado.

## 8. Salud del servicio

Ampliar el endpoint `/api/estado` que ya existe para incluir el estado de las piezas nuevas:

```json
{
  "ok": true,
  "db": true,
  "pgvector": true,
  "llm":   { "provider": "anthropic", "model": "…", "ok": true },
  "embeddings": { "provider": "voyage", "dimensions": 1024, "ok": true },
  "rerank": { "provider": "cohere", "ok": true },
  "storage": true,
  "documentos": 312,
  "chunks": 8740
}
```

Es el mismo patrón que ya usas ("lo que salga en `false` es lo que falta por configurar") y
funciona muy bien para diagnosticar despliegues.
