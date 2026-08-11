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

export async function fullTextSearch(consulta, limit = 20) {
  const { rows } = await pool.query(
    `SELECT dc.*, ts_rank(dc.tsv, websearch_to_tsquery('english', $1)) AS rank
       FROM document_chunks dc
      WHERE dc.tsv @@ websearch_to_tsquery('english', $1)
      ORDER BY rank DESC
      LIMIT $2;`,
    [consulta, limit]
  );
  return rows;
}

export function addEmbedding(chunkId, { provider, model, dimensions, embedding }) {
  return pool.query(
    `INSERT INTO chunk_embeddings (document_chunk_id, provider, model, dimensions, embedding)
     VALUES ($1, $2, $3, $4, $5) RETURNING id;`,
    [chunkId, provider, model, dimensions, comoVector(embedding)]
  ).then((r) => r.rows[0]);
}

/* Retrieval vectorial vía HNSW. `<=>` es distancia coseno: menor es más similar. */
export async function vectorSearch(embedding, limit = 8) {
  const { rows } = await pool.query(
    `SELECT dc.*, ce.embedding <=> $1 AS distancia
       FROM chunk_embeddings ce
       JOIN document_chunks dc ON dc.id = ce.document_chunk_id
      ORDER BY ce.embedding <=> $1
      LIMIT $2;`,
    [comoVector(embedding), limit]
  );
  return rows;
}

export function addCitation(planDecisionId, documentChunkId, similarityScore, rank) {
  return pool.query(
    `INSERT INTO plan_decision_citations (plan_decision_id, document_chunk_id, similarity_score, rank)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (plan_decision_id, document_chunk_id) DO NOTHING;`,
    [planDecisionId, documentChunkId, similarityScore, rank]
  );
}
