/* Adaptador de ExerciseDB.

   Aísla dos cosas que pueden cambiar sin avisar: la vía de acceso (RapidAPI o
   el endpoint directo, que exigen cabeceras distintas) y la forma exacta del
   JSON. Fuera de este archivo nadie sabe cuál de las dos se está usando.

   El catálogo NO decide la rutina. Este adaptador responde a "qué ejercicios
   existen con este músculo y este equipamiento"; qué patrón hace falta lo
   decide el planificador con el RAG. */
import { ExerciseProvider, normalizarEjercicio } from "./types.js";

export class ExerciseDBProvider extends ExerciseProvider {
  constructor({ apiKey, host, baseURL, fetchImpl = fetch, timeoutMs = 10_000 }) {
    super();
    this.apiKey = apiKey;
    this.host = host;
    this.baseURL = String(baseURL || "").replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  capabilities() {
    return { provider: "exercisedb", media: true, filtroEquipamiento: true, filtroMusculo: true };
  }

  /* RapidAPI exige `x-rapidapi-key` + `x-rapidapi-host`; el acceso directo usa
     Authorization. Se envían las que correspondan según lo configurado. */
  cabeceras() {
    const h = { accept: "application/json" };
    if (this.host) { h["x-rapidapi-key"] = this.apiKey; h["x-rapidapi-host"] = this.host; }
    else if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async pedir(ruta, params = {}) {
    const url = new URL(this.baseURL + ruta);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const respuesta = await this.fetchImpl(url.toString(), {
      headers: this.cabeceras(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!respuesta.ok) {
      const error = new Error(
        respuesta.status === 429 ? "ExerciseDB ha aplicado un límite de peticiones"
          : respuesta.status === 401 || respuesta.status === 403 ? "La clave de ExerciseDB no es válida"
          : `ExerciseDB respondió ${respuesta.status}`
      );
      error.status = respuesta.status;
      throw error;
    }
    return respuesta.json();
  }

  /* La respuesta viene envuelta de formas distintas según endpoint y versión
     ({data:[…]}, {data:{exercises:[…]}} o un array pelado). Se desenvuelve
     aquí para que el dominio reciba siempre una lista. */
  static desenvolver(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.data?.exercises)) return payload.data.exercises;
    if (Array.isArray(payload?.exercises)) return payload.exercises;
    return [];
  }

  async buscar({ musculo, equipamiento, bodyPart, texto, limite = 10 } = {}) {
    const payload = await this.pedir("/exercises", {
      search: texto, targetMuscles: musculo, equipments: equipamiento,
      bodyParts: bodyPart, limit: Math.min(50, Math.max(1, limite)),
    });
    return ExerciseDBProvider.desenvolver(payload)
      .map((bruto) => normalizarEjercicio(bruto, { provider: "exercisedb" }))
      .filter(Boolean);
  }

  async obtener(externalId) {
    if (!externalId) return null;
    try {
      const payload = await this.pedir(`/exercises/${encodeURIComponent(externalId)}`);
      const bruto = payload?.data && !Array.isArray(payload.data) ? payload.data : ExerciseDBProvider.desenvolver(payload)[0];
      return bruto ? normalizarEjercicio(bruto, { provider: "exercisedb" }) : null;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }
}
