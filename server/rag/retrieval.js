/* Retrieval híbrido (docs/05-rag.md §5-§8).

   Sustituye a refsRelevantes() —que puntúa fichas resumen de una línea— por
   búsqueda sobre fragmentos de texto real. La función antigua sigue viva en el
   cliente hasta la Fase 8, a propósito, para poder comparar respuestas.

   Flujo: ampliar consulta → vectorial + léxico en paralelo (con los filtros
   duros dentro de cada uno) → fusión RRF → reranking → umbral → top-K. */
import { ampliarConsulta } from "./query-expansion.js";

/* Pesos de PESO_GRADO del cliente, conservados tal cual para no cambiar el
   criterio a mitad de migración. Solo se aplican si RAG_WEIGHT_BY_GRADE=true. */
export const PESO_GRADO = Object.freeze({ fuerte: 1.6, moderada: 1.25, debil: 0.85, practica: 0.6 });

export const SIN_EVIDENCIA = "No existe evidencia suficiente en la biblioteca cargada para justificar esta decisión.";

/**
 * Reciprocal Rank Fusion.
 *
 * Usa RANGOS, no scores: es el punto donde más fácil es equivocarse. Una
 * distancia coseno y un ts_rank viven en escalas incomparables, y sumarlos o
 * normalizarlos introduce sesgos arbitrarios. El rango no tiene ese problema.
 *
 * @param listas  [{ nombre, resultados: [chunk] }] ya ordenadas por relevancia
 */
export function fusionarRRF(listas, { k = 60 } = {}) {
  const acumulado = new Map();

  for (const { nombre, resultados } of listas) {
    resultados.forEach((chunk, indice) => {
      const rango = indice + 1;                       // 1-based: RRF penaliza el rango 0
      const previo = acumulado.get(chunk.id) || { chunk, rrf: 0, rangos: {} };
      previo.rrf += 1 / (k + rango);
      previo.rangos[nombre] = rango;
      /* Un mismo chunk puede venir de las dos listas con columnas distintas
         (similitud en el vectorial, ts_rank en el léxico): se conservan ambas. */
      previo.chunk = { ...previo.chunk, ...chunk };
      acumulado.set(chunk.id, previo);
    });
  }

  return [...acumulado.values()].sort((a, b) => b.rrf - a.rrf);
}

/* Devuelve null ante cualquier cosa que no sea un número utilizable. Importa
   más de lo que parece: la distancia coseno contra un vector degenerado (todo
   ceros) es NaN, y un solo NaN colándose en un Math.max lo vuelve NaN entero,
   convirtiendo una consulta con evidencia buena en un "sin evidencia". */
const numero = (valor) => {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

/**
 * @param consulta  texto del atleta, en español
 * @param deps      { db, repo, embeddingProvider, rerankProvider, indice, config, contexto, filtros }
 */
export async function recuperar(consulta, {
  db, repo, embeddingProvider, rerankProvider, indice, config, contexto = {}, filtros = {},
}) {
  const inicio = Date.now();
  const ampliada = ampliarConsulta(consulta, contexto);
  const topKRetrieval = config.topKRetrieval;

  /* --- 1. Los dos componentes, en paralelo y con los filtros ya aplicados --- */
  const tareaVectorial = (async () => {
    if (!embeddingProvider || !indice?.provider) return [];
    /* inputType 'query' (no 'document'): Voyage y Cohere producen mejores
       resultados distinguiendo consulta de documento (docs/05-rag.md §4). */
    const { vectors } = await embeddingProvider.embed([ampliada.paraEmbedding], { inputType: "query" });
    return repo.vectorSearch(vectors[0], {
      provider: indice.provider, model: indice.model, dimensions: indice.dimensions,
      limit: topKRetrieval, filtros,
    }, db);
  })();

  const tareaLexica = ampliada.paraLexico
    ? repo.lexicalSearch(ampliada.paraLexico, { limit: topKRetrieval, filtros }, db)
    : Promise.resolve([]);

  const [vectorial, lexico] = await Promise.all([tareaVectorial, tareaLexica]);

  /* --- 2. Fusión --- */
  let fusionados = fusionarRRF(
    [{ nombre: "vectorial", resultados: vectorial }, { nombre: "lexico", resultados: lexico }],
    { k: config.rrfK }
  );

  if (config.weightByGrade) {
    fusionados = fusionados
      .map((item) => ({ ...item, rrf: item.rrf * (PESO_GRADO[item.chunk.evidence_grade] || 1) }))
      .sort((a, b) => b.rrf - a.rrf);
  }

  if (!fusionados.length) {
    return respuestaVacia(ampliada, { vectorial, lexico, inicio, config, motivo: "sin resultados" });
  }

  /* --- 3. Reranking. Siempre se llama: sin proveedor configurado el adaptador
         es `noop`, que conserva el orden. Cero ramas `if` aquí. --- */
  const candidatos = fusionados.slice(0, topKRetrieval);
  const ordenados = await rerankProvider.rerank(
    ampliada.paraEmbedding,
    candidatos.map((item) => item.chunk.texto),
    Math.min(topKRetrieval, candidatos.length)
  );

  /* Qué señal se umbraliza. El RRF NO sirve: su valor solo depende de la
     posición, así que siempre hay un "mejor" aunque no venga a cuento, y
     nunca detectaría la ausencia de evidencia.
       · reranker con scores absolutos → su score (calibrado, comparable)
       · noop + vectorial            → similitud coseno
       · noop sin vectorial          → no hay señal absoluta; una coincidencia
         léxica sobre un término del dominio ya es señal suficiente, y así se
         declara en el diagnóstico en vez de rechazarlo todo en silencio. */
  const capacidades = rerankProvider.capabilities();
  const hayVectorial = vectorial.length > 0;
  const modoUmbral = capacidades.scoresAbsolutos ? "rerank" : hayVectorial ? "coseno" : "lexico";

  const conScores = ordenados
    .map(({ index, score }) => {
      const item = candidatos[index];
      if (!item) return null;
      const scoreUmbral = modoUmbral === "rerank" ? numero(score)
        : modoUmbral === "coseno" ? numero(item.chunk.similitud)
        : null;
      return { ...item, rerank: numero(score), scoreUmbral };
    })
    .filter(Boolean);

  /* En modo léxico puro el umbral no es aplicable: todo lo recuperado ha
     coincidido con un término del dominio. */
  if (modoUmbral === "lexico") {
    return {
      ok: true,
      hayEvidencia: conScores.length > 0,
      mensaje: conScores.length ? undefined : SIN_EVIDENCIA,
      consulta: ampliada,
      chunks: conScores.slice(0, config.topKFinal).map((item) => formatear(item, config, false, modoUmbral)),
      diagnostico: { ...diagnostico({ vectorial, lexico, fusionados, inicio, config }), modoUmbral,
        aviso: "Sin componente vectorial: RAG_MIN_SCORE no se aplica. Configura EMBEDDING_PROVIDER." },
    };
  }

  /* --- 4. Umbral ANTES de devolver nada al LLM: ahorra tokens y, sobre todo,
         evita que el modelo rellene el hueco con conocimiento general
         (docs/05-rag.md §8.2). --- */
  /* Solo se comparan scores utilizables: un candidato sin señal no debe
     impedir que el resto pase el umbral. */
  const comparables = conScores.map((item) => item.scoreUmbral).filter((valor) => Number.isFinite(valor));
  const mejor = comparables.length ? Math.max(...comparables) : -Infinity;
  const superaUmbral = comparables.length > 0 && mejor >= config.minScore;

  if (!superaUmbral) {
    return respuestaVacia(ampliada, {
      vectorial, lexico, inicio, config, modoUmbral,
      motivo: Number.isFinite(mejor)
        ? `mejor score ${mejor.toFixed(4)} < RAG_MIN_SCORE ${config.minScore}`
        : "ningún candidato con score comparable",
      candidatos: conScores.slice(0, config.topKFinal).map((item) => formatear(item, config, false, modoUmbral)),
    });
  }

  /* --- 5. Top-K final.

     Mismo criterio que refsRelevantes(): se devuelven los que superan el
     umbral y SOLO si son menos de `minResults` se completa con los mejores
     restantes, marcados como relleno. Rellenar siempre hasta topKFinal metería
     en el prompt fragmentos irrelevantes cuando ya hay evidencia buena —
     tokens pagados y ruido para el modelo. --- */
  const superan = conScores.filter((item) => (item.scoreUmbral ?? -Infinity) >= config.minScore);
  const finales = superan.slice(0, config.topKFinal).map((item) => formatear(item, config, false, modoUmbral));

  if (finales.length < config.minResults) {
    const relleno = conScores
      .filter((item) => !superan.includes(item))
      .slice(0, config.minResults - finales.length)
      .map((item) => formatear(item, config, true, modoUmbral));
    finales.push(...relleno);
  }

  return {
    ok: true,
    hayEvidencia: true,
    consulta: ampliada,
    chunks: finales,
    diagnostico: { ...diagnostico({ vectorial, lexico, fusionados, inicio, config }), modoUmbral },
  };
}

function formatear(item, config, esRelleno, scoreType = null) {
  const { chunk } = item;
  return {
    id: chunk.id,
    documentId: chunk.document_id,
    titulo: chunk.titulo,
    autores: chunk.autores,
    anio: chunk.anio,
    doi: chunk.doi,
    fuente: chunk.fuente_revista,
    studyType: chunk.study_type,
    evidenceGrade: chunk.evidence_grade,
    poblacion: chunk.poblacion,
    populationType: chunk.population_type,
    sampleSize: chunk.sample_size,
    seccion: chunk.seccion,
    paginaInicio: chunk.pagina_inicio,
    paginaFin: chunk.pagina_fin,
    texto: chunk.texto,
    numTokens: chunk.num_tokens,
    storageKey: chunk.storage_key,
    origen: chunk.origen,
    scoreType,
    _relleno: esRelleno,
    scores: {
      similitudCoseno: numero(chunk.similitud),
      distancia: numero(chunk.distancia),
      tsRank: numero(chunk.ts_rank),
      rangoVectorial: item.rangos.vectorial ?? null,
      rangoLexico: item.rangos.lexico ?? null,
      rrf: item.rrf,
      rerank: item.rerank ?? null,
      umbral: item.scoreUmbral ?? null,
    },
  };
}

function respuestaVacia(ampliada, { vectorial, lexico, inicio, config, motivo, modoUmbral = null, candidatos = [] }) {
  return {
    ok: true,
    hayEvidencia: false,
    mensaje: SIN_EVIDENCIA,
    motivo,
    consulta: ampliada,
    chunks: [],
    /* Los descartados viajan solo para depuración: quien construye el prompt
       usa `chunks`, que está vacío. */
    descartados: candidatos,
    diagnostico: { ...diagnostico({ vectorial, lexico, fusionados: [], inicio, config }), modoUmbral },
  };
}

function diagnostico({ vectorial, lexico, fusionados, inicio, config }) {
  return {
    candidatosVectoriales: vectorial.length,
    candidatosLexicos: lexico.length,
    candidatosFusionados: fusionados.length,
    minScore: config.minScore,
    topKRetrieval: config.topKRetrieval,
    topKFinal: config.topKFinal,
    rrfK: config.rrfK,
    weightByGrade: config.weightByGrade,
    latenciaMs: Date.now() - inicio,
  };
}
