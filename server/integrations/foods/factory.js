/* Fábrica de proveedores de alimentos.

   A diferencia del resto de proveedores del proyecto, este viene ACTIVADO por
   defecto: Open Food Facts no necesita clave y desactivarlo no protege de
   nada. `FOOD_PROVIDER=ninguno` lo apaga si hiciera falta. */
import { assertFoodProvider } from "./types.js";
import { OpenFoodFactsProvider } from "./openfoodfacts.js";

const PROVEEDORES = new Set(["openfoodfacts"]);

const limpio = (valor) => String(valor || "").trim();

/* La licencia exige identificarse en cada llamada. Se construye desde el
   dominio de la instancia para que dos despliegues no compartan identidad. */
export function userAgentDe(env = process.env) {
  const origen = limpio(env.APP_ORIGIN) || "https://hybrid-coach.local";
  let host = origen;
  try { host = new URL(origen).host; } catch { /* origen mal formado: se usa tal cual */ }
  return `HybridCoach/2.0 (${host})`;
}

export function readFoodConfig(env = process.env) {
  const provider = limpio(env.FOOD_PROVIDER) || "openfoodfacts";
  if (provider === "ninguno") return { enabled: false };
  if (!PROVEEDORES.has(provider)) throw new Error(`FOOD_PROVIDER desconocido: ${provider}`);
  return {
    enabled: true,
    provider,
    userAgent: userAgentDe(env),
    idioma: limpio(env.FOOD_LANG) || "es",
  };
}

export function createFoodProvider(env = process.env, { fetchImpl = fetch } = {}) {
  const config = readFoodConfig(env);
  if (!config.enabled) return null;
  return assertFoodProvider(new OpenFoodFactsProvider({ ...config, fetchImpl }));
}
