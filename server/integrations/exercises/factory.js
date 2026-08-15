/* Fábrica de proveedores de ejercicios.

   Mismo contrato que server/ai/factory.js, y por la misma razón: sin
   configurar devuelve null y quien lo consume comprueba null en vez de
   romperse. Sin ExerciseDB la aplicación sigue funcionando con PAT y los
   ejercicios propios, que es el fallback que exige §59 del encargo. */
import { assertExerciseProvider } from "./types.js";
import { ExerciseDBProvider } from "./exercisedb.js";

const PROVEEDORES = new Set(["exercisedb"]);
const BASE_POR_DEFECTO = "https://exercisedb-api1.p.rapidapi.com/api/v1";

const limpio = (valor) => String(valor || "").trim();

export function readExerciseConfig(env = process.env) {
  const provider = limpio(env.EXERCISE_PROVIDER);
  if (!provider) return { enabled: false };
  if (!PROVEEDORES.has(provider)) throw new Error(`EXERCISE_PROVIDER desconocido: ${provider}`);

  const apiKey = limpio(env.EXERCISEDB_API_KEY);
  if (!apiKey) throw new Error("EXERCISEDB_API_KEY es obligatoria cuando EXERCISE_PROVIDER está configurado");

  /* El host solo lo usa RapidAPI. Si está, se firma como RapidAPI; si no, se
     asume acceso directo con Bearer. La elección queda dentro del adaptador. */
  const host = limpio(env.EXERCISEDB_HOST);
  const baseURL = limpio(env.EXERCISEDB_BASE_URL) || (host ? `https://${host}/api/v1` : BASE_POR_DEFECTO);

  return { enabled: true, provider, apiKey, host, baseURL };
}

export function createExerciseProvider(env = process.env, { fetchImpl = fetch } = {}) {
  const config = readExerciseConfig(env);
  if (!config.enabled) return null;
  return assertExerciseProvider(new ExerciseDBProvider({ ...config, fetchImpl }));
}
