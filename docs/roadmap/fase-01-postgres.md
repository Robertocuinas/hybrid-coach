# Fase 1 · PostgreSQL + pgvector en Railway

**Dificultad:** media · **Depende de:** Fase 0 · **Bloquea a:** Fases 2, 3, 4

---

## Objetivo

Base de datos desplegada, esquema completo creado con migraciones versionadas, y el servidor
conectando a ella. **La aplicación sigue funcionando igual que hoy** desde `localStorage`:
esta fase no cambia nada visible.

## Referencias

- [`../03-modelo-datos.md`](../03-modelo-datos.md) — el esquema completo
- [`../07-railway-despliegue.md`](../07-railway-despliegue.md) §1 — despliegue

## Tareas

- [ ] Crear el servicio de PostgreSQL en Railway **usando una plantilla que ya traiga
      pgvector preinstalado** (evita el problema de activar la extensión sobre un servicio
      existente)
- [ ] Verificar: `SELECT * FROM pg_extension WHERE extname = 'vector';` devuelve fila
- [ ] Enlazar el servicio de base de datos con el de aplicación → `DATABASE_URL` inyectada
- [ ] Elegir herramienta de migraciones (**Drizzle** o **node-pg-migrate**; no un ORM pesado)
      y documentar la elección en `docs/10-decisiones-tecnicas.md`
- [ ] Crear `server/db/migrations/` con la primera migración: todas las tablas de
      `03-modelo-datos.md`
- [ ] Crear los índices críticos (§10 del modelo de datos), incluido el HNSW sobre
      `chunk_embeddings.embedding`
- [ ] Configurar el pool de conexiones en el servidor (con límite acorde al plan de Railway)
- [ ] Ampliar `/api/estado` para incluir `db: true/false` y `pgvector: true/false`
- [ ] Añadir `npm run migrate` y encadenarlo al arranque
      (`startCommand: "npm run migrate && npm start"`)
- [ ] Verificar que un redeploy no rompe nada y que las migraciones son idempotentes

## Criterio de terminado

- `/api/estado` devuelve `db: true` y `pgvector: true` en producción.
- Todas las tablas del modelo de datos existen, con sus índices.
- `npm run migrate` se puede ejecutar dos veces seguidas sin error.
- La aplicación sigue funcionando exactamente igual que antes (nadie nota el cambio).

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Modelar mal una relación desde el principio | El esquema sale de `HEADERS` en `Codigo.gs`, que ya está probado en uso real. Es traducción, no diseño desde cero |
| Activar pgvector sobre un Postgres ya creado da problemas | Empezar directamente con plantilla que lo traiga |
| Migraciones que corren en paralelo en varias instancias | Con una sola instancia no aplica. Si escalas, usar comando de release separado |
| Editar una migración ya aplicada | Regla: nunca. Se crea una migración nueva que corrige |

## Notas

Esta fase no debe tocar `src/HybridCoach.jsx` en absoluto. Si acabas modificando el
frontend, algo se ha desviado del alcance.
