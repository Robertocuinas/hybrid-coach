import { pool, insertRow } from "./_helpers.js";

/* pgvector espera el literal '[0.1,0.2,...]'; el driver `pg` no conoce el tipo
   vector, así que el array de JS se serializa a mano antes de parametrizarlo. */
function comoVector(embedding) {
  return `[${embedding.join(",")}]`;
}

const DOCUMENT_COLUMNS = Object.freeze({
  legacyId: "legacy_id",
  titulo: "titulo",
  autores: "autores",
  anio: "anio",
  fuenteRevista: "fuente_revista",
  doi: "doi",
  hashArchivo: "hash_archivo",
  studyType: "study_type",
  evidenceGrade: "evidence_grade",
  poblacion: "poblacion",
  populationType: "population_type",
  sampleSize: "sample_size",
  temaPrincipal: "tema_principal",
  tags: "tags",
  resumen: "resumen",
  limites: "limites",
  aplicacionPractica: "aplicacion_practica",
  storageKey: "storage_key",
  origen: "origen",
  revisado: "revisado",
});

const nullableText = (value) => typeof value === "string" && value.trim() ? value.trim() : null;

export function createDocument(datos = {}) {
  return insertRow("documents", {
    legacy_id: nullableText(datos.legacyId),
    titulo: datos.titulo ?? null,
    autores: datos.autores ?? null,
    anio: datos.anio ?? null,
    fuente_revista: datos.fuenteRevista ?? null,
    doi: nullableText(datos.doi),
    hash_archivo: nullableText(datos.hashArchivo),
    study_type: datos.studyType ?? null,
    evidence_grade: datos.evidenceGrade ?? null,
    poblacion: datos.poblacion ?? null,
    population_type: datos.populationType ?? null,
    sample_size: datos.sampleSize ?? null,
    tema_principal: datos.temaPrincipal ?? null,
    tags: datos.tags ?? null,
    resumen: datos.resumen ?? null,
    limites: datos.limites ?? null,
    aplicacion_practica: datos.aplicacionPractica ?? null,
    storage_key: datos.storageKey ?? null,
    origen: datos.origen ?? "manual",
    revisado: datos.revisado ?? false,
    subido_por: datos.subidoPor ?? null,
  });
}

export async function listDocumentsPaginated({ page = 1, pageSize = 50 } = {}) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 50));
  const offset = (safePage - 1) * safePageSize;
  const [data, count] = await Promise.all([
    pool.query(
      `SELECT * FROM documents
        ORDER BY anio DESC NULLS LAST, titulo ASC NULLS LAST
        LIMIT $1 OFFSET $2;`,
      [safePageSize, offset]
    ),
    pool.query(`SELECT count(*)::int AS total FROM documents;`),
  ]);
  return { documents: data.rows, page: safePage, pageSize: safePageSize, total: count.rows[0].total };
}

export async function updateDocument(id, datos = {}) {
  const entries = Object.entries(datos)
    .filter(([key, value]) => Object.hasOwn(DOCUMENT_COLUMNS, key) && value !== undefined)
    .map(([key, value]) => [DOCUMENT_COLUMNS[key], key === "doi" || key === "hashArchivo" || key === "legacyId" ? nullableText(value) : value]);
  if (!entries.length) {
    const { rows } = await pool.query(`SELECT * FROM documents WHERE id = $1;`, [id]);
    return rows[0] || null;
  }
  const assignments = entries.map(([column], index) => `${column} = $${index + 2}`).join(", ");
  const { rows } = await pool.query(
    `UPDATE documents SET ${assignments} WHERE id = $1 RETURNING *;`,
    [id, ...entries.map(([, value]) => value)]
  );
  return rows[0] || null;
}

export async function documentHasChunks(id, db = pool) {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM document_chunks WHERE document_id = $1
     ) AS has_chunks;`,
    [id],
  );
  return rows[0]?.has_chunks === true;
}

export async function deleteDocument(id) {
  const { rows } = await pool.query(`DELETE FROM documents WHERE id = $1 RETURNING *;`, [id]);
  return rows[0] || null;
}

export async function findDocumentByDoi(doi) {
  const { rows } = await pool.query(`SELECT * FROM documents WHERE doi = $1;`, [doi]);
  return rows[0] || null;
}

export async function findDocumentByHash(hashArchivo) {
  const { rows } = await pool.query(`SELECT * FROM documents WHERE hash_archivo = $1;`, [hashArchivo]);
  return rows[0] || null;
}

export async function searchByTags(tags) {
  const { rows } = await pool.query(`SELECT * FROM documents WHERE tags && $1::text[];`, [tags]);
  return rows;
}

export function addChunk(documentId, { chunkIndex, seccion, paginaInicio = null, paginaFin = null, texto, numTokens = null }) {
  return insertRow("document_chunks", {
    document_id: documentId,
    chunk_index: chunkIndex,
    seccion,
    pagina_inicio: paginaInicio,
    pagina_fin: paginaFin,
    texto,
    num_tokens: numTokens,
  });
}

/* Documento + chunks en una sola transacción: un documento sin sus chunks no
   sirve para nada y dejaría basura que el retrieval nunca encontraría. El
   cliente se inyecta (pool en producción, PGlite en las pruebas), igual que
   en replaceProfileState(). */
export async function crearDocumentoConChunks(client, { documento, chunks = [], onChunks = null }) {
  const db = typeof client.connect === "function" ? await client.connect() : client;
  const release = typeof db.release === "function" ? () => db.release() : () => {};
  await db.query("BEGIN");
  try {
    const columnas = Object.keys(documento);
    const marcadores = columnas.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await db.query(
      `INSERT INTO documents (${columnas.join(", ")}) VALUES (${marcadores}) RETURNING *;`,
      Object.values(documento)
    );
    const creado = rows[0];
    const chunksCreados = [];

    for (const chunk of chunks) {
      const insertado = await db.query(
        `INSERT INTO document_chunks (document_id, chunk_index, seccion, pagina_inicio, pagina_fin, texto, num_tokens)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;`,
        [creado.id, chunk.chunk_index, chunk.seccion, chunk.pagina_inicio, chunk.pagina_fin, chunk.texto, chunk.num_tokens]
      );
      chunksCreados.push(insertado.rows[0]);
    }

    if (onChunks) await onChunks(db, chunksCreados);

    await db.query("COMMIT");
    return { documento: creado, chunks: chunks.length, chunkRows: chunksCreados };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    release();
  }
}

export async function listChunksByDocument(documentId) {
  const { rows } = await pool.query(
    `SELECT id, chunk_index, seccion, pagina_inicio, pagina_fin, texto, num_tokens
       FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index;`,
    [documentId]
  );
  return rows;
}

/* Cola de revisión: lo que entró por PDF y nadie ha confirmado todavía. */
export async function listPendingReview() {
  const { rows } = await pool.query(
    `SELECT d.*, count(dc.id)::int AS num_chunks
       FROM documents d LEFT JOIN document_chunks dc ON dc.document_id = d.id
      WHERE d.revisado = false
        AND d.origen = 'pdf'
        AND EXISTS (SELECT 1 FROM document_chunks present WHERE present.document_id = d.id)
      GROUP BY d.id
      ORDER BY d.created_at DESC;`
  );
  return rows;
}

/* Filtros duros del retrieval (docs/05-rag.md §5). Se aplican DENTRO de cada
   componente, antes de rankear: si se filtrara después de fusionar, el top-K
   llegaría contaminado y se habrían perdido candidatos válidos por el camino.

   `revisado = true` no es opcional ni configurable: un documento sin confirmar
   no participa en el retrieval (docs/05-rag.md §2.5). */
function construirFiltros(filtros = {}, params = []) {
  const condiciones = ["d.revisado = true"];
  const push = (valor) => { params.push(valor); return `$${params.length}`; };
  /* Las listas viajan como texto separado por comas y se reconstruyen con
     string_to_array: cada cliente (pg, PGlite) serializa los arrays de JS a su
     manera, y esto funciona igual en los dos. Ningún valor de estos enums
     contiene comas. */
  const enLista = (columna, valores, tipo) =>
    `${columna} = ANY(string_to_array(${push(valores.join(","))}, ',')::${tipo}[])`;

  if (filtros.studyType?.length) condiciones.push(enLista("d.study_type", filtros.studyType, "study_type"));
  if (filtros.populationType?.length) condiciones.push(enLista("d.population_type", filtros.populationType, "population_type"));
  if (filtros.evidenceGrade?.length) condiciones.push(enLista("d.evidence_grade", filtros.evidenceGrade, "evidence_grade"));
  if (Number.isInteger(filtros.anioMin)) condiciones.push(`d.anio >= ${push(filtros.anioMin)}`);
  if (Number.isInteger(filtros.anioMax)) condiciones.push(`d.anio <= ${push(filtros.anioMax)}`);
  if (filtros.seccion?.length) condiciones.push(enLista("dc.seccion", filtros.seccion, "text"));

  return { where: condiciones.join(" AND "), params };
}

/* Columnas comunes a los dos componentes para que la fusión compare peras con
   peras y el prompt tenga siempre los mismos metadatos disponibles. */
const COLUMNAS_CHUNK = `
  dc.id, dc.document_id, dc.chunk_index, dc.seccion, dc.pagina_inicio, dc.pagina_fin,
  dc.texto, dc.num_tokens,
  d.titulo, d.autores, d.anio, d.doi, d.fuente_revista, d.study_type,
  d.evidence_grade, d.poblacion, d.population_type, d.sample_size, d.tema_principal,
  d.storage_key, d.origen`;

/**
 * Componente léxico. `consulta` debe venir en sintaxis websearch (términos
 * unidos por OR); ver server/rag/query-expansion.js: con AND —que es el
 * comportamiento por defecto de plainto_/websearch_to_tsquery ante palabras
 * sueltas— una consulta de varias palabras no encontraría casi nada.
 */
export async function lexicalSearch(consulta, { limit = 25, filtros = {} } = {}, db = pool) {
  const texto = String(consulta || "").trim();
  if (!texto) return [];
  const { where, params } = construirFiltros(filtros, [texto]);
  params.push(Math.min(200, Math.max(1, Number(limit) || 25)));

  const { rows } = await db.query(
    `SELECT ${COLUMNAS_CHUNK},
            ts_rank(dc.tsv, websearch_to_tsquery('english', $1)) AS ts_rank
       FROM document_chunks dc
       JOIN documents d ON d.id = dc.document_id
      WHERE dc.tsv @@ websearch_to_tsquery('english', $1) AND ${where}
      ORDER BY ts_rank DESC, dc.id
      LIMIT $${params.length};`,
    params
  );
  return rows;
}

export function addEmbedding(chunkId, { provider, model, dimensions, embedding }) {
  return pool.query(
    `INSERT INTO chunk_embeddings (document_chunk_id, provider, model, dimensions, embedding)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (document_chunk_id, provider, model, dimensions)
     DO UPDATE SET embedding=EXCLUDED.embedding, created_at=now()
     RETURNING id;`,
    [chunkId, provider, model, dimensions, comoVector(embedding)]
  ).then((r) => r.rows[0]);
}

/* Retrieval vectorial vía HNSW. `<=>` es distancia coseno: menor es más
   similar. Se devuelve además `similitud` (1 - distancia) porque es la señal
   sobre la que cae el umbral cuando no hay reranker (server/rag/retrieval.js). */
export async function vectorSearch(embedding, { provider, model, dimensions = 1024, limit = 8, filtros = {} } = {}, db = pool) {
  if (!provider || !model) throw new Error("vectorSearch requiere provider y model del índice activo");
  const { where, params } = construirFiltros(filtros, [comoVector(embedding), provider, model, dimensions]);
  params.push(Math.min(200, Math.max(1, Number(limit) || 8)));

  const { rows } = await db.query(
    `SELECT ${COLUMNAS_CHUNK},
            ce.embedding <=> $1 AS distancia,
            1 - (ce.embedding <=> $1) AS similitud
       FROM chunk_embeddings ce
       JOIN document_chunks dc ON dc.id = ce.document_chunk_id
       JOIN documents d ON d.id = dc.document_id
      WHERE ce.provider=$2 AND ce.model=$3 AND ce.dimensions=$4 AND ${where}
      ORDER BY ce.embedding <=> $1, dc.id
      LIMIT $${params.length};`,
    params
  );
  return rows;
}

export function addCitation(planDecisionId, documentChunkId, similarityScore, rank, { scoreType = null, relleno = false } = {}) {
  return pool.query(
    `INSERT INTO plan_decision_citations
       (plan_decision_id, document_chunk_id, similarity_score, rank, score_type, es_relleno)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (plan_decision_id, document_chunk_id) DO NOTHING;`,
    [planDecisionId, documentChunkId, similarityScore, rank, scoreType, relleno]
  );
}

/* Ficha pública de un fragmento revisado. `storage_key` solo se usa dentro del
   servidor para firmar el PDF y nunca forma parte del DTO enviado al cliente. */
export async function findReviewedChunkEvidence(chunkId, db = pool) {
  const { rows } = await db.query(
    `SELECT dc.id, dc.document_id, dc.texto, dc.seccion, dc.pagina_inicio, dc.pagina_fin,
            d.titulo, d.autores, d.anio, d.fuente_revista, d.study_type,
            d.evidence_grade, d.poblacion, d.population_type, d.sample_size,
            d.doi, d.origen, d.storage_key
       FROM document_chunks dc
       JOIN documents d ON d.id = dc.document_id
      WHERE dc.id = $1 AND d.revisado = true;`,
    [chunkId]
  );
  return rows[0] || null;
}
