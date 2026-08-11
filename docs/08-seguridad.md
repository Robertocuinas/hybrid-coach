# 08 · Seguridad

Esta aplicación guarda **datos de salud**: peso, porcentaje de grasa, lesiones, dolor,
sensaciones, sueño. Eso eleva el listón por encima de un proyecto personal cualquiera.

---

## 1. Estado actual y sus agujeros

| Situación hoy | Riesgo |
|---|---|
| `APP_PASSWORD` compartida en cookie `hc_pase` | No es autenticación por persona. Quien tiene la contraseña entra como cualquiera |
| La cookie contiene la contraseña en claro | Si se filtra, es la credencial completa, no un token revocable |
| Token de Strava en variable de proceso, global | Un solo token para todos los usuarios; se pierde en cada redeploy |
| Sin cuentas, sin roles | Cualquiera que entre puede subir bibliografía y ver todo |
| Datos en `localStorage` sin cifrar | Accesible a cualquier script en el mismo origen |

Lo que ya está **bien**: la `ANTHROPIC_API_KEY` vive solo en el servidor y nunca llega al
navegador. Ese criterio hay que extenderlo a todas las claves nuevas.

---

## 2. Autenticación

**Fase 3 del roadmap.** Sustituir `APP_PASSWORD` por cuentas reales.

- Email + contraseña con hash `argon2id` (o `bcrypt` con coste ≥12). No inventes nada aquí.
- Sesión con cookie `HttpOnly`, `Secure`, `SameSite=Lax`, con un identificador de sesión
  aleatorio — **nunca la contraseña ni un dato derivado de ella**.
- `SESSION_SECRET` como variable de entorno obligatoria; el servidor no arranca sin ella.
- Límite de intentos de login (rate limiting por IP y por cuenta) para frenar fuerza bruta.
- OAuth (Google) es una alternativa válida si prefieres no gestionar contraseñas. Menos
  código propio, una dependencia externa más.

Migración desde el estado actual: al implementarlo, crear una cuenta con tu email y asociar
el perfil existente a ella. `APP_PASSWORD` se elimina, no se deja como fallback.

---

## 3. Autorización y aislamiento entre usuarios

**Regla central:** el `athlete_profile_id` de cualquier consulta se deriva de la **sesión
autenticada**, nunca de un parámetro de la petición.

```
MAL:   GET /api/sesiones?perfil=<id>          → el cliente elige de quién lee
BIEN:  GET /api/sesiones                      → el servidor resuelve el perfil desde la sesión
BIEN:  GET /api/perfiles/:id/sesiones         → válido SOLO si se verifica que :id pertenece al usuario
```

Segunda capa opcional: **Row-Level Security** de PostgreSQL. No sustituye a la verificación
en la aplicación, pero convierte un bug de autorización en una consulta vacía en vez de una
fuga de datos. Merece la pena si en algún momento hay más de una persona tocando el código.

### Excepción deliberada: la biblioteca es compartida

`documents`, `document_chunks` y `chunk_embeddings` son comunes a todos los usuarios — igual
que hoy `st.biblio` vive fuera de los perfiles. **Solo un usuario con rol `admin` puede
escribir en ellas.** Cualquiera puede leerlas.

---

## 4. Secretos

| Regla | Detalle |
|---|---|
| Solo en variables de entorno de Railway | Nunca en el código, nunca en el repositorio, nunca en el bundle |
| Nunca en el cliente | Toda llamada a APIs de terceros pasa por el servidor. El patrón de `/api/ia` es el correcto y hay que replicarlo para embeddings y reranking |
| `.env` en `.gitignore` | `.env.example` sí se commitea, con los nombres y sin valores |
| Rotación | Si una clave se expone, revócala en el proveedor; no basta con quitarla del código |

El repositorio debe seguir siendo **privado**: aunque las claves no estén, el perfil, las
lesiones y el plan sí están en `perfilSemilla()`.

---

## 5. Tokens de Strava

Problema actual: un `refresh_token` único, en memoria, compartido.

Solución (tabla `strava_connections`):
- una fila por usuario,
- `access_token` y `refresh_token` **cifrados en reposo** — `pgcrypto` en la base de datos o
  cifrado en la aplicación antes de insertar, con la clave en variable de entorno,
- refresco automático cuando expira, escribiendo el token nuevo,
- posibilidad de desconectar (borrar la fila) desde la interfaz.

---

## 6. Datos sensibles y logs

| Qué | Regla |
|---|---|
| Peso, grasa, lesiones, dolor | Nunca en logs de aplicación ni en mensajes de error |
| `ai_query_logs` | Guardar `athlete_profile_id` y referenciar, **no copiar** los datos de salud en el log. Purga automática a los 90 días |
| Errores de integraciones externas | Enmascarar claves y tokens antes de loguear la respuesta |
| Prompts completos | Si los guardas para depurar, trátalos como datos de salud: contienen el perfil entero |

---

## 7. Transporte y cabeceras

- HTTPS siempre — Railway lo da con el dominio generado.
- `app.disable('x-powered-by')` ya está puesto. Bien.
- Añadir cabeceras de seguridad básicas: `Content-Security-Policy` (ojo: hoy se carga
  `pdf.js` desde CDN, tenlo en cuenta al definir la política — cuando la ingesta pase al
  servidor, esa dependencia externa desaparece del cliente), `X-Content-Type-Options`,
  `Referrer-Policy`.
- Límite de tamaño de payload ya existe (`express.json({ limit: '2mb' })`). Revisarlo al
  añadir subida de PDFs, que irá por otro camino (`multipart`, con su propio límite).

---

## 8. Subida de PDFs

Superficie de ataque nueva a partir de la Fase 5:

- Solo rol `admin`.
- Validar el tipo real del archivo (magic bytes), no la extensión ni el `Content-Type`.
- Límite de tamaño explícito (p. ej. 50 MB).
- Procesar en un contexto aislado: un PDF malicioso puede explotar bugs de la librería de
  extracción. Mantener PyMuPDF actualizado.
- Nombre de archivo en R2 derivado del **hash**, nunca del nombre subido por el usuario
  (evita path traversal y colisiones).

---

## 9. Backups

- Cifrados en reposo (R2 lo hace por defecto).
- Credenciales de acceso al bucket de backups **separadas** de las que usa la aplicación
  para operar, y con permisos mínimos.
- Restauración probada al menos una vez antes de confiar en ellos
  ([`07-railway-despliegue.md`](07-railway-despliegue.md) §5).

---

## 10. Aviso al compartir la aplicación

Está bien escrito en el README actual y sigue vigente. Con cuentas reales el escenario
mejora, pero conviene mantener explícito:
- los datos son de salud,
- las llamadas al LLM las paga quien despliega,
- la aplicación no diagnostica lesiones ni sustituye a un profesional sanitario.

Esos avisos son **código, no prompt** ([`02-arquitectura-objetivo.md`](02-arquitectura-objetivo.md) §6).
