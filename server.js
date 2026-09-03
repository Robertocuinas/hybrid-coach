/**
 * HYBRID COACH — bootstrap del servidor para Railway.
 *
 * Hace una sola cosa: construir la aplicación Express (en `server/app.js`) y
 * ponerla a escuchar. Toda la lógica — middlewares, routers, IA, Sheets,
 * Strava, OAuth, errores — vive en `buildApp()` para poder testear el binario
 * sin levantar un puerto.
 *
 * Los `await resolveEmbeddingConfig(...)`, `validateEmbeddingStartup(...)` y
 * `comprobarExtractor()` que antes vivían aquí como top-level await ahora son
 * awaits internos de `buildApp()`. El comportamiento es el mismo; lo que cambia
 * es que se puede importar la app en un test sin necesidad de un Postgres real
 * (con `DATABASE_URL` apuntando a un puerto muerto la app arranca y /health
 * responde 503, igual que antes).
 */
import { buildApp } from "./server/app.js";

const PORT = process.env.PORT || 3000;

const { app, llmProvider, embeddingConfig, toolRouterProvider, legacyStravaConfig } = await buildApp();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hybrid Coach escuchando en el puerto ${PORT}`);
  console.log(`  IA:     ${llmProvider ? `${process.env.LLM_PROVIDER}/${process.env.LLM_MODEL}` : "sin proveedor (la app funciona igual)"}`);
  console.log(`  Embed:  ${embeddingConfig.enabled ? `${embeddingConfig.provider}/${embeddingConfig.model} (${embeddingConfig.dimensions}d, ${embeddingConfig.origen})` : "desactivados"}`);
  console.log(`  Local:  ${toolRouterProvider ? "needle/tool-routing" : "desactivado"}`);
  console.log(`  Hoja:   ${process.env.APPS_SCRIPT_URL ? "vía Apps Script" : process.env.SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "vía cuenta de servicio" : "sin configurar"}`);
  console.log(`  Strava: ${legacyStravaConfig.enabled ? "legacy monousuario activo" : legacyStravaConfig.credentialsConfigured ? "credenciales presentes, legacy bloqueado" : "sin configurar"}`);
  console.log(`  Ejercicios: ${process.env.EXERCISE_PROVIDER ? process.env.EXERCISE_PROVIDER : "sin catálogo externo (solo PAT propio)"}`);
  console.log("  Acceso: sesiones autenticadas");
});

if (process.env.DATABASE_URL && process.env.RECONCILIATION_ENABLED !== "false" && process.env.RECONCILIATION_MODE !== "external") {
  const { startReconciliationJob } = await import("./server/jobs/reconciliation.js");
  startReconciliationJob();
}