# CLAUDE.md — instrucciones para Claude Code en este repositorio

Este archivo lo lee Claude Code automáticamente al abrir el proyecto. Contiene las reglas
que **no** debe romper y el mapa de dónde está cada cosa.

---

## 1. Qué es este proyecto

**Hybrid Coach** — aplicación de entrenamiento híbrido (carrera + fuerza) para preparar una
media maratón. Genera un plan con un motor determinista, registra sesiones, y usa un LLM
como "coach" que justifica decisiones citando bibliografía científica.

Desplegada en Railway. Un solo servicio Node/Express que sirve una SPA de React.

## 2. Estado real del proyecto (importante, no asumir otra cosa)

- **No hay base de datos.** Todo el estado vive en un blob JSON en `localStorage` del
  navegador, bajo la clave `hybridcoach:v2`.
- **`server.js` no tiene estado.** Es un proxy: reenvía a la API de Anthropic, hace de
  puente a Google Sheets y gestiona OAuth de Strava (con el token en una variable en
  memoria del proceso, que se pierde en cada redeploy).
- **Google Sheets es un respaldo de solo escritura**, no la fuente de datos.
- **`HybridCoach-BaseDeDatos.xlsx` no lo lee ni escribe ningún código.** Es una plantilla
  de referencia. No forma parte del flujo de datos.
- **No hay autenticación real.** `APP_PASSWORD` es una contraseña compartida en cookie.

Estamos en proceso de evolucionar esto hacia PostgreSQL + pgvector + RAG.
Ver `docs/` para el plan completo.

## 3. Mapa del código

```
server.js               Servidor Express: /api/ia, /api/sheets, /api/strava/*, estáticos
build.mjs               Compila src/index.jsx → public/app.js con esbuild
src/index.jsx           Arranque + pantalla de contraseña
src/HybridCoach.jsx     TODA la aplicación (~2900 líneas). Ver secciones abajo.
Codigo.gs               Google Apps Script: define HEADERS de las 15 hojas de Sheets
public/                 Bundle compilado + manifest + iconos
docs/                   Documentación de la evolución a BD + RAG (leer antes de tocar nada)
```

### Secciones dentro de `src/HybridCoach.jsx`

| Zona | Qué hay |
|---|---|
| ~L100-160 | Catálogo de ejercicios y plantillas de sesión de gimnasio |
| ~L157-202 | `BIBLIO_SEED` — 40 referencias científicas semilla |
| ~L204-282 | Biblioteca v2: `normRef()`, `refsRelevantes()`, `refsPrompt()` |
| ~L284-400 | Cuestionario de perfil (`WIZARD`) |
| ~L400-700 | Motor determinista: `buildPlan()`, `generateWeek()`, `sessionDetail()` |
| ~L680-700 | `progresionSugerida()` — progresión de carga por RIR/reps |
| ~L800-960 | Módulo de nutrición (determinista, no IA) |
| ~L963-1130 | **Capa de IA**: `llamarIA()`, `extraerJSON()`, `hechosPlan()`, `SYS_DECISIONES`, `decisionesIA()`, `validarPropuesta()` |
| ~L1129-1200 | Importación de PDF en cliente con pdf.js + `SYS_PDF` |
| ~L1203-1300 | Almacenamiento multiperfil (`store`, `loadState`, `saveState`, `pushToSheets`) |
| ~L1892-1990 | **Coach**: `buildContext()` (construye el system prompt) y componente `Coach` |
| resto | Componentes de UI |

## 4. Reglas duras — no romper sin permiso explícito

1. **No toques el motor determinista sin que se te pida explícitamente.**
   `buildPlan()`, `generateWeek()`, las reglas de distribución R1-R9 y `progresionSugerida()`
   protegen la integridad física del atleta. No son "lógica de negocio" normal.

2. **No amplíes lo que la IA puede modificar.**
   `CAMPOS_BLOQUEADOS` y `AJUSTES_PERMITIDOS` (≈L1018) son la frontera entre lo que decide
   el código y lo que puede sugerir el modelo. Añadir un campo a `AJUSTES_PERMITIDOS` es
   una decisión de producto, no de implementación.

3. **Toda salida de un LLM pasa por validación antes de mostrarse.**
   El patrón es `extraerJSON()` → `validarPropuesta()`. Nunca renderices texto de un modelo
   como si fuera dato validado, y nunca apliques un cambio de plan automáticamente: el
   usuario acepta o rechaza.

4. **Nunca se cita evidencia que no exista.**
   Cualquier ID de referencia devuelto por el modelo se comprueba contra la biblioteca real
   y se descarta si no existe. Ver `validarPropuesta()`.

5. **Los avisos de seguridad clínica son `if` de código, no instrucciones de prompt.**
   Dolor ≥5/10, dolor en reposo, suelo calórico de disponibilidad energética: están
   hardcodeados y deben seguir estándolo. No los delegues al LLM.

6. **Secretos solo en variables de entorno.** Nunca en el código, nunca en el bundle del
   navegador. La `ANTHROPIC_API_KEY` vive en el servidor y se usa vía `/api/ia`.

7. **No introduzcas dependencias nuevas sin justificarlo.** El proyecto es deliberadamente
   austero: React + esbuild + Express, sin ORM pesado, sin gestor de estado, sin framework
   de agentes. Ver `docs/10-decisiones-tecnicas.md`.

8. **Datos de salud.** Peso, lesiones, dolor y sensaciones son datos sensibles. No los
   escribas en logs, no los mandes a servicios de terceros que no estén ya en el diseño.

## 5. Convenciones de estilo

- **Comentarios en español**, en el tono del código existente: explican *por qué*, no *qué*.
  Bloques de sección con `/* ===== TÍTULO ===== */`.
- Nombres de funciones y variables en español cuando el dominio es español
  (`decisionesIA`, `refsRelevantes`, `perfilSemilla`), en inglés cuando es técnico genérico
  (`loadState`, `buildContext`). Sigue lo que ya hay en el fichero que edites.
- ESM (`import`/`export`), no CommonJS. `"type": "module"` en `package.json`.
- Nada de TypeScript por ahora: el proyecto es JS + JSX.
- Fechas siempre en formato `YYYY-MM-DD` vía el helper `iso()`.

## 6. Cómo se ejecuta

```bash
npm install
npm run build     # compila src → public/app.js
npm start         # arranca el servidor en PORT (3000 por defecto)
npm run dev       # build en watch + servidor
```

No hay tests todavía. Si añades lógica en el motor determinista o en el pipeline RAG,
propón tests antes de dar el trabajo por terminado.

## 7. Variables de entorno

Actuales (ver `.env.example`): `APP_PASSWORD`, `ANTHROPIC_API_KEY`, `APPS_SCRIPT_URL`,
`SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`,
`MODELO_IA`.

Previstas en la evolución: ver `docs/04-capa-ia.md` §6 y `docs/07-railway-despliegue.md` §3.

## 8. Antes de empezar cualquier tarea

1. Lee `docs/README.md` para situarte.
2. Si la tarea corresponde a una fase del roadmap, lee su ficha en `docs/roadmap/`.
3. Si la tarea cambia el modelo de datos, lee `docs/03-modelo-datos.md` primero.
4. Si la tarea toca proveedores de IA, lee `docs/04-capa-ia.md`: **el proyecto es
   neutro respecto al proveedor**, no acoples nada a Anthropic ni a OpenAI en concreto.

## 9. Qué hacer cuando algo no está claro

Pregunta antes de asumir, especialmente si la duda afecta a:
- la estructura del plan de entrenamiento,
- qué puede o no puede decidir la IA,
- el esquema de la base de datos,
- cualquier cosa etiquetada como regla dura en §4.
