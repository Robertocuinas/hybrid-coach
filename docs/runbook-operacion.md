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

### Planificador semanal (`0010_weekly_planning.js` y `0011_planning_and_evidence_integrity.js`)

Tras el primer despliegue del planificador, comprobar además que las tablas de ejecución y
revisión existen, que una propuesta nueva nace `draft` y que una semana nunca tiene más de
una revisión `accepted`. Ante un problema, hacer primero rollback de aplicación y conservar
el esquema aditivo: `migrate:down` eliminaría el historial de propuestas. El procedimiento,
consultas de verificación y alcance destructivo del rollback de esquema están en
[`11-planificador-semanal-ia-rag.md`](11-planificador-semanal-ia-rag.md#6-despliegue-de-la-migración).
Comprobar también que un cambio de molestias o sesiones completadas vuelve obsoleto un
borrador previo (`409`) y que la interfaz recupera la revisión aceptada mediante
`GET /api/planning/weeks/:week/accepted`.

## Conciliación diaria

El servicio cron usa el mismo repositorio, `/railway.cron.json`, el comando
`npm run reconcile:once` y el horario `0 3 * * *` (UTC). Debe tener `DATABASE_URL` privada.

- salida 0: todos los perfiles están en verde;
- salida 2: existe rojo o snapshot obsoleto;
- salida 1: error técnico.

Cuando exista el cron, el servicio web debe usar `RECONCILIATION_MODE=external` para no
duplicar el job. Hasta entonces puede conservar `RECONCILIATION_MODE=web`.

## Ingesta masiva de bibliografía

El corpus del RAG son los `document_chunks`. **`npm run seed:biblio` no los crea**: inserta
40 fichas en `documents` sin texto troceado, así que el retrieval no las ve. La única vía
que llena el corpus es la ingesta de PDF.

### Antes de lanzar

Tres cosas, en este orden. Las tres las comprueba el propio script y aborta si falta la
primera:

1. **Extractor.** Python + PyMuPDF en la imagen; lo pone `nixpacks.toml`. Sin esto no se
   ingiere nada.
2. **Embeddings.** Panel de administración o `EMBEDDING_*`. Sin ellos los documentos entran
   igual, pero sin vectorizar; se completa después con `npm run embeddings:reindex`.
3. **Proveedor de IA.** Sin él los documentos entran sin ficha y quedan **todos** pendientes
   de revisión manual, uno por uno. Con una tanda grande, esto importa.

### Lanzar

```bash
npm run biblio:ingest -- --dir ./papers --user tu@correo.com --dry-run   # comprobar
npm run biblio:ingest -- --dir ./papers --user tu@correo.com             # ejecutar
```

`--user` toma la clave de IA guardada en los ajustes de esa cuenta; sin él se usa
`LLM_PROVIDER` del entorno. Otras opciones: `--limite n` para probar con los primeros,
`--pausa ms` si el proveedor limita por minuto, `--informe salida.json` para el detalle
completo y `--si` para no pedir confirmación.

### Qué esperar

- Va de uno en uno. Cada documento gasta **una** llamada al modelo (la ficha) y varias de
  embeddings. Cien documentos son cien llamadas al modelo: cuenta el coste antes.
- **Es reanudable.** La deduplicación por hash y por DOI hace que relanzar la misma carpeta
  salte lo ya ingerido. Si se corta a mitad, se vuelve a lanzar y sigue.
- Un duplicado no es un error y no detiene nada. Un fallo de configuración del servidor
  (503) **sí** detiene el lote: se repetiría en todos los documentos restantes.
- Al terminar, lo que tenga ficha completa queda disponible para el coach; el resto espera
  revisión en el panel.

### Por interfaz

El panel admite selección múltiple y muestra el progreso por archivo. Sirve para tandas
pequeñas; el límite de `UPLOAD_RATE_LIMIT_PER_HOUR` (60 por defecto) sigue aplicando, y el
CLI no pasa por él.

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
