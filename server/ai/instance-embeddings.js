/* Resolución del proveedor de embeddings de la instancia.

   Orden: lo guardado en la base de datos manda sobre las variables de entorno.
   Así se puede configurar desde la aplicación sin redesplegar, y una instancia
   que ya funcionaba con EMBEDDING_* sigue funcionando igual mientras nadie
   guarde nada.

   A diferencia del LLM, esto NO es por usuario: los vectores de toda la
   biblioteca deben salir del mismo modelo o el retrieval deja de ver la mitad
   del corpus (ver la migración 0009 y docs/05-rag.md §6). */
import pool from "../db/pool.js";
import { createEmbeddingProvider, readEmbeddingConfig } from "./factory.js";
import { decryptApiKey, encryptApiKey } from "./settings-crypto.js";
import { findInstanceEmbeddingSettings } from "../db/repositories/embeddingSettings.js";

export const EMBEDDING_PROVIDERS_UI = ["voyage", "openai", "openai-compatible"];

/* El cifrado de claves va ligado a un dato asociado; para un ajuste que no
   pertenece a ningún usuario, ese dato es una constante del propio ámbito. */
const AAD_INSTANCIA = "instance:embeddings";

export const cifrarClaveEmbeddings = (apiKey) => encryptApiKey(apiKey, AAD_INSTANCIA);
export const descifrarClaveEmbeddings = (packed) => decryptApiKey(packed, AAD_INSTANCIA);

/* Los ajustes guardados se traducen a la forma de entorno para pasar por
   readEmbeddingConfig() sin duplicar ni una validación: dimensión fija en
   1024, clave obligatoria salvo en servidores locales, base URL comprobada.
   El tamaño de lote y los reintentos siguen siendo ajuste de operación. */
export function ajustesComoEntorno(settings, apiKey, env = process.env) {
  return {
    EMBEDDING_PROVIDER: settings.provider,
    EMBEDDING_MODEL: settings.model,
    EMBEDDING_API_KEY: apiKey || "",
    EMBEDDING_BASE_URL: settings.base_url || undefined,
    EMBEDDING_DIMENSIONS: "1024",
    EMBEDDING_BATCH_SIZE: env.EMBEDDING_BATCH_SIZE,
    EMBEDDING_MAX_RETRIES: env.EMBEDDING_MAX_RETRIES,
  };
}

export function configDesdeAjustes(settings, env = process.env) {
  const apiKey = settings.api_key_ciphertext ? descifrarClaveEmbeddings(settings.api_key_ciphertext) : "";
  return { ...readEmbeddingConfig(ajustesComoEntorno(settings, apiKey, env)), origen: "instancia" };
}

/* Memoria corta: descifrar y validar en cada petición sería gasto puro, pero
   una caché indefinida dejaría a las demás réplicas sirviendo la configuración
   vieja después de un cambio. El TTL acota esa ventana y invalidar() la cierra
   del todo en la réplica que hace el cambio. */
const TTL_MS = 60_000;
let cache = null;

export function invalidarEmbeddingsDeInstancia() { cache = null; }

export async function resolveEmbeddingConfig({ db = pool, env = process.env, ahora = Date.now() } = {}) {
  if (cache && ahora - cache.momento < TTL_MS) return cache.config;
  let config;
  try {
    const settings = await findInstanceEmbeddingSettings(db);
    config = settings ? configDesdeAjustes(settings, env) : { ...readEmbeddingConfig(env), origen: "entorno" };
  } catch (error) {
    /* Una configuración guardada inválida (clave que ya no descifra, modelo
       retirado) no puede tumbar el retrieval entero: se cae al entorno y el
       panel de administración lo reporta. */
    config = { ...readEmbeddingConfig(env), origen: "entorno", error: error.message };
  }
  cache = { config, momento: ahora };
  return config;
}

export async function resolveEmbeddingProvider({ db = pool, env = process.env, fetchImpl = fetch } = {}) {
  const config = await resolveEmbeddingConfig({ db, env });
  if (!config.enabled) return null;
  return crearDesdeConfig(config, fetchImpl);
}

/* readEmbeddingConfig() ya dejó la config normalizada; para instanciar hay que
   volver a la forma de entorno porque es lo que acepta la factoría. */
export function crearDesdeConfig(config, fetchImpl = fetch) {
  return createEmbeddingProvider({
    EMBEDDING_PROVIDER: config.provider,
    EMBEDDING_MODEL: config.model,
    EMBEDDING_API_KEY: config.apiKey || "",
    EMBEDDING_BASE_URL: config.baseURL || undefined,
    EMBEDDING_DIMENSIONS: String(config.dimensions),
    EMBEDDING_BATCH_SIZE: String(config.batchSize),
    EMBEDDING_MAX_RETRIES: String(config.maxRetries),
  }, { fetchImpl });
}

export function publicEmbeddingSettings(config, settings = null) {
  if (!config?.enabled) return { configured: false, origen: config?.origen || "entorno", provider: null, model: null, baseURL: null, lastTestedAt: null, lastTestOk: null };
  return {
    configured: true,
    origen: config.origen,
    provider: config.provider,
    model: config.model,
    baseURL: config.baseURL || null,
    dimensions: config.dimensions,
    lastTestedAt: settings?.last_tested_at || null,
    lastTestOk: settings?.last_test_ok ?? null,
    error: config.error || null,
  };
}
