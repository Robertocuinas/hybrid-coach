/* Caché en memoria para resultados de retrieval (Fase 12.3).

   Evita recomputar embeddings, búsqueda vectorial y rerank en consultas
   repetidas (mismo texto + mismos filtros + mismo índice), lo que recorta
   latencia y coste de los proveedores sin tocar el motor determinista ni
   acoplar a ningún LLM.

   Diseño:
   - Clave = hash estable de (consulta, filtros, provider, model).
   - TTL configurable (por defecto 10 min) para no servir evidencia obsoleta
     si se recarga la biblioteca.
   - No persiste: se pierde al reiniciar el proceso, que es exactamente lo que
     queremos (la biblioteca puede cambiar entre arranques).

   No guarda datos de salud: la consulta es texto del atleta, no información
   clínica (CLAUDE.md §4.6). */

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function hashClave(consulta, filtros, indice) {
  const cruda = JSON.stringify({
    c: consulta,
    f: filtros || {},
    p: indice?.provider || null,
    m: indice?.model || null,
  });
  // FNV-1a 32-bit: rápido, determinista, sin dependencias.
  let h = 0x811c9dc5;
  for (let i = 0; i < cruda.length; i++) {
    h ^= cruda.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export class CacheRetrieval {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntradas = 200 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntradas = maxEntradas;
    this.map = new Map();
  }

  clave(consulta, filtros, indice) {
    return hashClave(consulta, filtros, indice);
  }

  obtener(consulta, filtros, indice) {
    const k = this.clave(consulta, filtros, indice);
    const entrada = this.map.get(k);
    if (!entrada) return null;
    if (Date.now() - entrada.ts > this.ttlMs) {
      this.map.delete(k);
      return null;
    }
    return entrada.valor;
  }

  poner(consulta, filtros, indice, valor) {
    const k = this.clave(consulta, filtros, indice);
    // LRU simple: si se llena, borra la más antigua.
    if (this.map.size >= this.maxEntradas && !this.map.has(k)) {
      const primera = this.map.keys().next().value;
      if (primera !== undefined) this.map.delete(primera);
    }
    this.map.set(k, { ts: Date.now(), valor });
  }

  limpiar() {
    this.map.clear();
  }
}

/* Instancia por proceso. Se puede invalidar llamando a .limpiar() cuando se
   recarga la biblioteca (p. ej. tras subir un PDF). */
export const cacheRetrieval = new CacheRetrieval();
