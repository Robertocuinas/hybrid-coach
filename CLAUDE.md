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

- **PostgreSQL + pgvector están activos.** Durante el asentamiento, el frontend conserva
  `localStorage` y hace dual write a la API.
- **`server.js` expone autenticación, CRUD, sync, ingesta y RAG.** El dominio no llama
  directamente a proveedores de IA.
- **Google Sheets es una integración opcional heredada**, no la fuente de datos.
- **`HybridCoach-BaseDeDatos.xlsx` no lo lee ni escribe ningún código.** Es una plantilla
  de referencia. No forma parte del flujo de datos.
- **Hay cuentas y sesiones reales.** Las contraseñas usan Argon2id y la cookie contiene
  un token aleatorio revocable, nunca la contraseña.

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
| ~L204-282 | Biblioteca v2: `normRef()`, `refsRelevantes()` |
| ~L284-400 | Cuestionario de perfil (`WIZARD`) |
| ~L400-700 | Motor determinista: `buildPlan()`, `generateWeek()`, `sessionDetail()` |
| ~L680-700 | `progresionSugerida()` — progresión de carga por RIR/reps |
| ~L800-960 | Módulo de nutrición (determinista, no IA) |
| ~L940-990 | **Capa de IA en cliente**: `llamarIA()`, `extraerJSON()`. El razonamiento del plan y sus guardarraíles ya NO viven aquí: ver §4.2 |
| ~L1129-1200 | Importación de PDF en cliente con pdf.js + `SYS_PDF` |
| ~L1203-1300 | Almacenamiento multiperfil (`store`, `loadState`, `saveState`, `pushToSheets`) |
| ~L2270-2530 | **Coach**: cliente del coach de servidor. Habla con `POST /api/coach/chat` y con `/api/coach/conversations`; el contexto, el retrieval y el historial son del servidor (`server/domain/coach/`) |
| resto | Componentes de UI |

`src/agenda.js` es lógica pura de fechas (fecha → semana/día, estado de cada día,
precarga de pesos). Vive fuera del JSX para poder probarse con `node --test`:
ver `src/agenda.test.js`.

### Acciones del Coach

El Coach no ejecuta: propone. El reparto es deliberado y **no se rompe sin permiso**:

| Pieza | Dónde | Qué hace |
|---|---|---|
| Catálogo y validación | `server/domain/coach/acciones.js` | Lista cerrada de acciones con lista blanca de parámetros y tres niveles: `lectura`, `escritura`, `confirmacion` |
| Extracción | bloque `<<ACCION>>` en `chat.js` | Mismo patrón que `<<CAMBIO>>`. **No se usa tool calling nativo**: el formato difiere entre proveedores y la capa es neutra (§8) |
| Ejecución en cliente | `src/acciones.js` | Consultas y registros propios. Escribe en el estado del cliente y viaja por el sync |
| Ejecución de plan | `src/planningApi.js` | **Toda la programación semanal es del planificador IA + RAG.** El Coach delega, no genera |

`catalogoParaPrompt({ planificador })` oculta las acciones del planificador mientras
`server/routes/planning.js` no exista, para que el modelo no ofrezca lo que no se puede
cumplir. Se activa solo cuando esa ruta aparece.

## 4. Reglas duras — no romper sin permiso explícito

1. **No toques el motor determinista sin que se te pida explícitamente.**
   `buildPlan()`, `generateWeek()`, las reglas de distribución R1-R9 y `progresionSugerida()`
   protegen la integridad física del atleta. No son "lógica de negocio" normal.

2. **No amplíes lo que la IA puede modificar.**
   `CAMPOS_BLOQUEADOS` y `AJUSTES_PERMITIDOS` viven en `server/domain/coach/prompt.js` y son
   la frontera entre lo que decide el código y lo que puede sugerir el modelo. Añadir un
   campo a `AJUSTES_PERMITIDOS` es una decisión de producto, no de implementación.

   **Una sola copia.** Estas listas han llegado a estar duplicadas en tres sitios, y la
   copia sobrante estaba desactualizada y era *más permisiva* que la real. Si necesitas las
   listas en otra capa, impórtalas; no las reescribas.

3. **Toda salida de un LLM pasa por validación antes de mostrarse.**
   El patrón es `extraerJSON()` → validación, hoy en `server/domain/coach/validacion.js`.
   Nunca renderices texto de un modelo como si fuera dato validado, y nunca apliques un
   cambio de plan automáticamente: el usuario acepta o rechaza.

4. **Nunca se cita evidencia que no exista.**
   Cualquier ID de referencia devuelto por el modelo se comprueba contra la biblioteca real
   y se descarta si no existe. Ver `server/domain/coach/validacion.js`; el chat solo devuelve
   como citas los fragmentos que el modelo mencionó por id y que existen de verdad.

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

Ejecuta `npm test` y `npm run build` antes de dar el trabajo por terminado.

## 7. Variables de entorno

La lista vigente está en `.env.example`. Para el núcleo son obligatorias `DATABASE_URL` y
`SESSION_SECRET`; en producción también `NODE_ENV=production` y `APP_ORIGIN`. IA,
embeddings, R2, Sheets y Strava son opcionales.

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
