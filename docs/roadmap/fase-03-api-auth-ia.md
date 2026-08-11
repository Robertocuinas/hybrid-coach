# Fase 3 · API real, autenticación y capa de IA neutra

**Dificultad:** alta · **Depende de:** Fases 1, 2 · **Bloquea a:** Fases 8, 11

La fase más grande del roadmap. Se puede partir en tres entregas independientes:
**3a API + auth**, **3b dual write**, **3c capa de IA**.

---

## Objetivo

Que puedas borrar `localStorage`, entrar desde otro dispositivo con tus credenciales y verlo
todo. Y que el proveedor de IA sea intercambiable por configuración.

## Referencias

- [`../04-capa-ia.md`](../04-capa-ia.md) — contratos y adaptadores
- [`../08-seguridad.md`](../08-seguridad.md) — autenticación y aislamiento
- [`../06-migracion.md`](../06-migracion.md) §8-9 — dual write y corte

---

## 3a · API y autenticación

- [ ] Estructura de carpetas de `02-arquitectura-objetivo.md` §3
- [ ] Mover el motor determinista (`buildPlan`, `generateWeek`, nutrición) a
      `server/domain/` **sin cambiar su lógica** — solo trasladarlo
- [ ] Verificar que `server/domain/` no importa nada de `db/` ni de `ai/`
- [ ] Repositorios de acceso a datos por agregado en `server/db/repositories/`
- [ ] Endpoints CRUD: perfil, plan, sesiones, check-ins, recuperación, rutinas, nutrición
- [ ] Autenticación: registro/login con `argon2id`, sesión con cookie `HttpOnly` + `Secure`
      + `SameSite=Lax`, `SESSION_SECRET` obligatoria
- [ ] Rate limiting en el login
- [ ] **Aislamiento:** todo `athlete_profile_id` se deriva de la sesión, nunca del cliente
- [ ] Rol `admin` para quien puede subir bibliografía
- [ ] Mover el token de Strava a `strava_connections`, cifrado, por usuario
- [ ] Retirar `APP_PASSWORD` (no dejarlo como fallback)

## 3b · Dual write y corte

- [ ] Cada `update()` del frontend escribe también en la API (`UPSERT` idempotente)
- [ ] Cola local de reintento si la API falla — **no bloquear al usuario**
- [ ] Job diario de conciliación que compara totales entre ambas fuentes y avisa
- [ ] Mantener 1-2 semanas; criterio de corte: **7 días sin divergencias**
- [ ] Corte: la app lee de la API; `localStorage` pasa a caché de lectura

## 3c · Capa de IA neutra

- [ ] `server/ai/providers/` con los tres contratos: `LLMProvider`, `EmbeddingProvider`,
      `RerankProvider`
- [ ] Adaptador `anthropic` — portar `llamarIA()` **sin cambiar comportamiento**
- [ ] Adaptador `openai`
- [ ] Adaptador `openai-compatible` con `baseURL` configurable
      (cubre Ollama, llama.cpp, LM Studio, vLLM de una vez)
- [ ] Declaración de `capabilities` por adaptador
- [ ] Factoría que lee la configuración de entorno
- [ ] Validación al arrancar: proveedor existe, API key presente, dimensiones coherentes
- [ ] Sustituir todas las llamadas directas del dominio por el contrato
- [ ] Mover las plantillas de prompt a `server/ai/prompts/` como archivos
- [ ] Registrar `provider` y `model` en `ai_recommendations`
- [ ] Bucle de reparación de JSON para proveedores con
      `reliableStructuredOutput: false` (1 reintento, luego degradar sin aplicar cambios)
- [ ] Probar las tres configuraciones: Anthropic, OpenAI, local con Ollama

## Criterio de terminado

- [ ] Borro `localStorage`, entro desde otro navegador con mis credenciales y veo todo
- [ ] Dos usuarios distintos no ven datos del otro (probado explícitamente)
- [ ] `grep -r "api.anthropic.com\|api.openai.com" server/` solo devuelve resultados dentro
      de `server/ai/providers/`
- [ ] Cambiar `LLM_PROVIDER` y reiniciar cambia el proveedor sin tocar código
- [ ] Con `LLM_PROVIDER=openai-compatible` apuntando a Ollama local, el coach responde
- [ ] Strava funciona tras un redeploy (el token ya no está en memoria)

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Romper flujos del frontend que asumen lectura síncrona de `localStorage` | Mantener `localStorage` como caché durante el dual write; migrar pantalla a pantalla |
| Bug de autorización que filtra datos entre usuarios | Verificación en la aplicación **+** Row-Level Security como segunda capa. Probar con dos cuentas reales |
| El adaptador nuevo cambia sutilmente el comportamiento del LLM | Portar `anthropic` primero **sin cambios funcionales**, comparar respuestas antes y después con las mismas preguntas |
| Modelos locales que devuelven JSON inválido | Bucle de reparación + `extraerJSON()` tolerante, que ya existe |
| Fase demasiado grande, se estanca | Partirla en 3a / 3b / 3c y desplegar cada una |

## Notas

`extraerJSON()` es la pieza que hace viable usar modelos locales pequeños: tolera que el
modelo envuelva el JSON en bloques de código o añada texto alrededor. **No la simplifiques.**
