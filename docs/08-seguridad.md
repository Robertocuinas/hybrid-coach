# 08 · Seguridad

Hybrid Coach procesa datos deportivos y datos que pueden revelar salud: peso, lesiones,
dolor, recuperación y sueño. Este documento describe las medidas técnicas actuales; no
sustituye asesoramiento jurídico.

## Autenticación y sesiones

- Cuenta individual con email y contraseña hasheada mediante Argon2id.
- Token de sesión aleatorio; PostgreSQL conserva únicamente su hash.
- Cookie `HttpOnly`, `Secure` en producción y `SameSite=Lax`.
- `SESSION_SECRET` obligatorio y contraseñas de 12 caracteres por defecto.
- Rate limiting por IP y cuenta en login; límites separados para registro, IA y PDFs.
- El registro siempre crea el rol `athlete`. La elevación a `admin` es una operación
  explícita y auditada en PostgreSQL.
- Cambiar la contraseña revoca las demás sesiones.

`APP_PASSWORD` ya no existe y no debe reintroducirse como fallback.

## Aislamiento entre usuarios

El `athlete_profile_id` se obtiene de la sesión autenticada. Nunca se acepta del body,
query string o cabecera enviada por el cliente. Las consultas y escrituras privadas
incluyen ese identificador. La biblioteca científica es compartida, pero solo el rol
`admin` puede modificarla.

Los tests de autorización comprueban que una cuenta no puede resolver un perfil ajeno.
PostgreSQL RLS sería una segunda defensa futura, no un sustituto de esta regla.

## Integridad y sincronización

- Las escrituras de sesiones y rutinas son transaccionales.
- Las operaciones dual-write son idempotentes.
- Un snapshot antiguo no puede sustituir uno nuevo; el servidor compara `capturedAt`
  bajo bloqueo de fila.
- Constraints limitan roles, tipos, RPE, dolor, RIR y valores negativos.
- Solo puede existir un plan activo por perfil y una actividad externa por identificador.

## Navegador y HTTP

- HTTPS en Railway y HSTS.
- CSP con `frame-ancestors 'none'`, `base-uri`, `form-action` y `object-src` restringidos.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` y
  `Permissions-Policy` restrictiva.
- Las respuestas de API y autenticación usan `Cache-Control: no-store`.
- Con `APP_ORIGIN` configurado, las mutaciones con cookie requieren el origen exacto.
- El JSON general está limitado a 2 MB; los PDFs tienen validación y límite propios.

## Secretos e integraciones

Los secretos de infraestructura viven en variables selladas del servidor. Las claves de
OpenAI o Anthropic que introduce un usuario en Ajustes son la única excepción: se cifran
en PostgreSQL con AES-256-GCM, con el `user_id` como dato autenticado, y nunca se devuelven
al navegador, se guardan en `localStorage` ni se incluyen en la exportación de cuenta.
La clave maestra se deriva de `AI_SETTINGS_ENCRYPTION_KEY` o, si no existe, de
`SESSION_SECRET`; rotarla invalida las claves de proveedor ya guardadas.

Solo se admiten los endpoints oficiales fijos de OpenAI y Anthropic, lo que evita que una
cuenta convierta este mecanismo en un proxy hacia una URL arbitraria. La prueba de
conexión está autenticada, limitada por cuenta y usa una salida mínima. `.env.example`
contiene únicamente nombres y valores no sensibles. No deben aparecer URLs desplegadas
privadas, tokens, claves, contraseñas ni conexiones de base de datos en Git, el bundle o
los logs.

IA, embeddings, R2, Sheets y Strava permanecen desactivados mientras no estén configurados.
Antes de activarlos hay que aprobar finalidad, minimización, retención y consentimiento.
Los tokens persistentes de Strava requieren cifrado en reposo antes de abrir la integración
a terceros.

## PDFs

- Subida exclusiva de administradores y rate limited.
- Validación por magic bytes, no por extensión o `Content-Type`.
- Tamaño máximo explícito, extracción con timeout y nombres R2 derivados del hash.
- URLs de evidencia firmadas con caducidad corta; el bucket no es público.

## Derechos y operación

- `GET /api/auth/export` produce una exportación privada completa de la cuenta.
- `DELETE /api/auth/account` exige contraseña y borra en cascada la cuenta.
- La política de retención está en [politica-datos.md](politica-datos.md).
- Backup, restauración, rollback y alertas están en [runbook-operacion.md](runbook-operacion.md).

Antes de admitir usuarios externos quedan: recuperación o verificación de email, cifrado
de OAuth Strava, registro de auditoría, monitorización externa y revisión
jurídica/consentimiento.
