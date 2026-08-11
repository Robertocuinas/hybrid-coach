import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import * as documentsRepo from "../db/repositories/documents.js";
import { recuperar, fusionarRRF, SIN_EVIDENCIA } from "./retrieval.js";
import { ampliarConsulta } from "./query-expansion.js";
import { terminosIngleses } from "./diccionario-es-en.js";
import { NoopRerankProvider } from "../ai/providers/rerank/noop.js";

const INDICE = { provider: "openai-compatible", model: "bge-m3", dimensions: 1024 };
const CONFIG = { topKRetrieval: 25, topKFinal: 8, minResults: 3, minScore: 0.25, rrfK: 60, weightByGrade: false };

/* Vector unitario controlado: la primera componente fija la similitud coseno
   contra la consulta [1,0,0,...], que es exactamente lo que se quiere poder
   afinar en las pruebas del umbral. */
function vectorConSimilitud(similitud) {
  const v = new Array(1024).fill(0);
  v[0] = similitud;
  v[1] = Math.sqrt(Math.max(0, 1 - similitud * similitud));
  return v;
}
const CONSULTA_VECTOR = vectorConSimilitud(1);

const embeddingProviderFalso = () => ({
  embed: async (textos, { inputType }) => {
    assert.equal(inputType, "query", "la consulta debe embeberse como 'query', no como 'document'");
    return { vectors: textos.map(() => CONSULTA_VECTOR), dimensions: 1024 };
  },
  dimensions: () => 1024,
});

async function baseConCorpus() {
  const db = await PGlite.create({ extensions: { vector, pgcrypto } });
  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TYPE study_type AS ENUM ('meta_analysis','systematic_review','rct','observational','position_statement','narrative_review','preprint');
    CREATE TYPE evidence_grade AS ENUM ('fuerte','moderada','debil','practica');
    CREATE TYPE population_type AS ENUM ('runners','strength_athletes','general_population','mixed');
    CREATE TABLE documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), titulo text, autores text, anio int,
      fuente_revista text, doi text, study_type study_type, evidence_grade evidence_grade,
      poblacion text, population_type population_type, sample_size int, tema_principal text,
      storage_key text, revisado boolean DEFAULT false
    );
    CREATE TABLE document_chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index int, seccion text, pagina_inicio int, pagina_fin int, texto text, num_tokens int,
      tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(texto, ''))) STORED
    );
    CREATE TABLE chunk_embeddings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_chunk_id uuid NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
      provider text, model text, dimensions int, embedding vector(1024)
    );
  `);
  return db;
}

async function insertarDocumento(db, { titulo, anio = 2020, studyType = "rct", grade = "moderada", population = "runners", revisado = true, chunks }) {
  const { rows } = await db.query(
    `INSERT INTO documents (titulo, autores, anio, study_type, evidence_grade, population_type, revisado)
     VALUES ($1,'Autor, A.',$2,$3,$4,$5,$6) RETURNING id;`,
    [titulo, anio, studyType, grade, population, revisado]
  );
  const documentId = rows[0].id;
  for (const [indice, chunk] of chunks.entries()) {
    const insertado = await db.query(
      `INSERT INTO document_chunks (document_id, chunk_index, seccion, pagina_inicio, pagina_fin, texto, num_tokens)
       VALUES ($1,$2,$3,$4,$4,$5,$6) RETURNING id;`,
      [documentId, indice, chunk.seccion || "discussion", chunk.pagina || 1, chunk.texto, 100]
    );
    if (chunk.similitud !== undefined) {
      await db.query(
        `INSERT INTO chunk_embeddings (document_chunk_id, provider, model, dimensions, embedding)
         VALUES ($1,$2,$3,1024,$4);`,
        [insertado.rows[0].id, INDICE.provider, INDICE.model, JSON.stringify(vectorConSimilitud(chunk.similitud))]
      );
    }
  }
  return documentId;
}

const ejecutar = (db, consulta, extra = {}) => recuperar(consulta, {
  db, repo: documentsRepo, embeddingProvider: embeddingProviderFalso(),
  rerankProvider: new NoopRerankProvider(), indice: INDICE,
  config: { ...CONFIG, ...(extra.config || {}) },
  contexto: extra.contexto || {}, filtros: extra.filtros || {},
});

/* ---------- RRF puro ---------- */

test("RRF fusiona por RANGO, no por score", () => {
  const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
  const fusion = fusionarRRF([
    { nombre: "vectorial", resultados: [a, b] },
    { nombre: "lexico", resultados: [b, c] },
  ], { k: 60 });

  // b aparece en las dos listas: 1/(60+2) + 1/(60+1) gana a un solo 1/(60+1).
  assert.equal(fusion[0].chunk.id, "b");
  assert.ok(Math.abs(fusion[0].rrf - (1 / 62 + 1 / 61)) < 1e-12);
  assert.deepEqual(fusion[0].rangos, { vectorial: 2, lexico: 1 });
  assert.equal(fusion.length, 3);
});

test("un score enorme no compra posición: solo cuenta el rango", () => {
  const fusion = fusionarRRF([
    { nombre: "vectorial", resultados: [{ id: "x", similitud: 0.99 }] },
    { nombre: "lexico", resultados: [{ id: "y", ts_rank: 999999 }] },
  ], { k: 60 });
  assert.equal(fusion[0].rrf, fusion[1].rrf, "dos rangos 1 deben empatar pese a escalas incomparables");
});

/* ---------- Diccionario y ampliación ---------- */

test("la consulta en español se amplía con los términos ingleses del corpus", () => {
  const ampliada = ampliarConsulta("¿cuánto separar fuerza pesada de intervalos?", { distanciaObjetivo: "Media maratón" });
  assert.ok(ampliada.terminosEN.includes("strength training"));
  assert.ok(ampliada.terminosEN.includes("intervals"));
  assert.ok(ampliada.paraLexico.includes(" OR "), "el léxico debe unir términos con OR, no con AND");
  assert.ok(ampliada.paraEmbedding.includes("Media maratón"), "el contexto del atleta viaja al vectorial");
});

test("el término largo gana al corto contenido en él", () => {
  assert.deepEqual(terminosIngleses("media maratón"), ["half marathon"]);
  assert.deepEqual(terminosIngleses("entrenamiento concurrente"), ["concurrent training"]);
});

/* ---------- Retrieval contra PostgreSQL ---------- */

test("recupera fragmentos sobre interferencia para una consulta en español", async () => {
  const db = await baseConCorpus();
  await insertarDocumento(db, { titulo: "Concurrent training meta-analysis", chunks: [
    { texto: "The interference effect of concurrent training was larger for running than cycling.", similitud: 0.8, seccion: "results" },
    { texto: "Heavy strength training should be separated from interval sessions by 24 hours.", similitud: 0.75, seccion: "discussion" },
  ] });
  await insertarDocumento(db, { titulo: "Vitamin D and bone health", chunks: [
    { texto: "Vitamin D supplementation and bone mineral density in older adults.", similitud: 0.05, seccion: "results" },
  ] });

  const resultado = await ejecutar(db, "¿cuánto separar fuerza pesada de intervalos?");

  assert.equal(resultado.hayEvidencia, true);
  const relevantes = resultado.chunks.filter((c) => !c._relleno);
  assert.equal(relevantes.length, 2, "los dos fragmentos sobre interferencia deben superar el umbral");
  assert.ok(relevantes.every((c) => /interference|strength|interval/i.test(c.texto)),
    "el paper de vitamina D no puede aparecer como evidencia real");
  assert.ok(resultado.chunks.filter((c) => c._relleno).every((c) => /Vitamin D/i.test(c.texto)),
    "si entra vitamina D es solo como relleno marcado");
  assert.ok(resultado.diagnostico.candidatosLexicos > 0, "el componente léxico debe encontrar algo gracias al diccionario");
  assert.ok(resultado.diagnostico.candidatosVectoriales > 0);
  await db.close();
});

test("los scores desglosados incluyen las dos señales y los rangos", async () => {
  const db = await baseConCorpus();
  await insertarDocumento(db, { titulo: "Concurrent training", chunks: [
    { texto: "Interval training and strength training interference in trained runners.", similitud: 0.9 },
  ] });

  const { chunks } = await ejecutar(db, "interferencia entre fuerza e intervalos");
  const scores = chunks[0].scores;
  assert.ok(scores.similitudCoseno > 0.8);
  assert.ok(scores.tsRank > 0, "debe traer ts_rank del componente léxico");
  assert.equal(scores.rangoVectorial, 1);
  assert.equal(scores.rangoLexico, 1);
  assert.ok(scores.rrf > 0);
  assert.equal(scores.umbral, scores.similitudCoseno, "con noop el umbral cae sobre la similitud coseno");
  await db.close();
});

test("un documento sin revisar no participa en el retrieval", async () => {
  const db = await baseConCorpus();
  await insertarDocumento(db, { titulo: "Borrador sin revisar", revisado: false, chunks: [
    { texto: "Interference effect of concurrent strength and interval training.", similitud: 0.99 },
  ] });

  const resultado = await ejecutar(db, "interferencia entrenamiento concurrente");
  assert.equal(resultado.hayEvidencia, false);
  assert.equal(resultado.mensaje, SIN_EVIDENCIA);
  assert.equal(resultado.diagnostico.candidatosVectoriales, 0);
  assert.equal(resultado.diagnostico.candidatosLexicos, 0);
  await db.close();
});

test("el filtro por study_type devuelve solo ese tipo de estudio", async () => {
  const db = await baseConCorpus();
  await insertarDocumento(db, { titulo: "Revisión sistemática", studyType: "systematic_review", chunks: [
    { texto: "Systematic review of concurrent training interference.", similitud: 0.7 },
  ] });
  await insertarDocumento(db, { titulo: "Ensayo", studyType: "rct", chunks: [
    { texto: "Randomized trial of concurrent training interference.", similitud: 0.95 },
  ] });

  const resultado = await ejecutar(db, "interferencia concurrente", { filtros: { studyType: ["systematic_review"] } });
  assert.equal(resultado.chunks.length, 1);
  assert.equal(resultado.chunks[0].studyType, "systematic_review");
  assert.equal(resultado.chunks[0].titulo, "Revisión sistemática");
  await db.close();
});

test("el filtro por año se aplica antes de rankear", async () => {
  const db = await baseConCorpus();
  await insertarDocumento(db, { titulo: "Antiguo", anio: 2005, chunks: [
    { texto: "Concurrent training interference in runners.", similitud: 0.99 },
  ] });
  await insertarDocumento(db, { titulo: "Reciente", anio: 2020, chunks: [
    { texto: "Concurrent training interference in runners.", similitud: 0.6 },
  ] });

  const resultado = await ejecutar(db, "interferencia concurrente", { filtros: { anioMin: 2015 } });
  assert.equal(resultado.chunks.length, 1);
  assert.equal(resultado.chunks[0].anio, 2020);
  await db.close();
});

test("sin nada relevante se responde 'sin evidencia' y no se devuelve ningún chunk al prompt", async () => {
  const db = await baseConCorpus();
  await insertarDocumento(db, { titulo: "Vitamina D", chunks: [
    { texto: "Vitamin D supplementation and bone mineral density.", similitud: 0.10 },
  ] });

  const resultado = await ejecutar(db, "hidratación en carreras de montaña");
  assert.equal(resultado.hayEvidencia, false);
  assert.equal(resultado.mensaje, SIN_EVIDENCIA);
  assert.deepEqual(resultado.chunks, [], "el prompt no debe recibir nada");
  assert.match(resultado.motivo, /RAG_MIN_SCORE|sin resultados/);
  await db.close();
});

test("bajar RAG_MIN_SCORE deja pasar lo que antes se rechazaba", async () => {
  const db = await baseConCorpus();
  await insertarDocumento(db, { titulo: "Marginal", chunks: [
    { texto: "Vitamin D supplementation and bone mineral density.", similitud: 0.18 },
  ] });

  assert.equal((await ejecutar(db, "vitamina D y hueso")).hayEvidencia, false);
  const permisivo = await ejecutar(db, "vitamina D y hueso", { config: { minScore: 0.1 } });
  assert.equal(permisivo.hayEvidencia, true);
  assert.equal(permisivo.chunks.length, 1);
  await db.close();
});

test("con reranker de scores absolutos el umbral cae sobre su score, no sobre el coseno", async () => {
  const db = await baseConCorpus();
  await insertarDocumento(db, { titulo: "Concurrente", chunks: [
    { texto: "Concurrent training interference effect.", similitud: 0.95 },
  ] });

  /* Similitud alta pero el reranker dice que no es relevante: debe ganar el
     reranker, que es la señal calibrada. */
  const rerankProviderEstricto = {
    capabilities: () => ({ scoresAbsolutos: true, maxDocuments: 100 }),
    rerank: async (_q, documentos) => documentos.map((_, index) => ({ index, score: 0.05 })),
  };

  const resultado = await recuperar("interferencia concurrente", {
    db, repo: documentsRepo, embeddingProvider: embeddingProviderFalso(),
    rerankProvider: rerankProviderEstricto, indice: INDICE, config: CONFIG,
  });
  assert.equal(resultado.hayEvidencia, false, "un coseno alto no debe salvar lo que el reranker descarta");
  await db.close();
});

test("el reranker reordena de verdad el resultado final", async () => {
  const db = await baseConCorpus();
  await insertarDocumento(db, { titulo: "Primero por coseno", chunks: [
    { texto: "Concurrent training interference alpha.", similitud: 0.9 },
  ] });
  await insertarDocumento(db, { titulo: "Segundo por coseno", chunks: [
    { texto: "Concurrent training interference beta.", similitud: 0.5 },
  ] });

  const rerankInverso = {
    capabilities: () => ({ scoresAbsolutos: true, maxDocuments: 100 }),
    rerank: async (_q, documentos) => documentos
      .map((texto, index) => ({ index, score: /beta/.test(texto) ? 0.99 : 0.30 }))
      .sort((a, b) => b.score - a.score),
  };

  const resultado = await recuperar("interferencia concurrente", {
    db, repo: documentsRepo, embeddingProvider: embeddingProviderFalso(),
    rerankProvider: rerankInverso, indice: INDICE, config: CONFIG,
  });
  assert.match(resultado.chunks[0].texto, /beta/, "el orden final lo decide el reranker");
  assert.equal(resultado.chunks[0].scores.rerank, 0.99);
  await db.close();
});

test("lo que entra por completar el top-K va marcado como relleno", async () => {
  const db = await baseConCorpus();
  await insertarDocumento(db, { titulo: "Relevante", chunks: [
    { texto: "Concurrent training interference effect in runners.", similitud: 0.9 },
  ] });
  await insertarDocumento(db, { titulo: "Flojo", chunks: [
    { texto: "Concurrent training and something barely related.", similitud: 0.15 },
  ] });

  const resultado = await ejecutar(db, "interferencia concurrente");
  assert.equal(resultado.hayEvidencia, true);
  const relleno = resultado.chunks.filter((c) => c._relleno);
  assert.ok(relleno.length >= 1, "el fragmento por debajo del umbral debe ir marcado");
  assert.equal(resultado.chunks[0]._relleno, false);
  await db.close();
});

test("sin proveedor de embeddings el retrieval sigue funcionando solo con el léxico", async () => {
  const db = await baseConCorpus();
  await insertarDocumento(db, { titulo: "Solo texto", chunks: [
    { texto: "Concurrent training interference effect in trained runners.", similitud: 0.9 },
  ] });

  const resultado = await recuperar("interferencia concurrente", {
    db, repo: documentsRepo, embeddingProvider: null,
    rerankProvider: new NoopRerankProvider(), indice: INDICE, config: CONFIG,
  });
  assert.equal(resultado.diagnostico.candidatosVectoriales, 0);
  assert.ok(resultado.diagnostico.candidatosLexicos > 0);
  assert.equal(resultado.hayEvidencia, true, "sin vectores el léxico sigue siendo evidencia");
  assert.equal(resultado.diagnostico.modoUmbral, "lexico");
  assert.match(resultado.diagnostico.aviso, /EMBEDDING_PROVIDER/, "debe avisar de que corre en modo degradado");
  assert.equal(resultado.chunks[0].scores.similitudCoseno, null);
  await db.close();
});

test("el relleno solo entra si no hay suficientes fragmentos por encima del umbral", async () => {
  const db = await baseConCorpus();
  await insertarDocumento(db, { titulo: "Cuatro buenos", chunks: [
    { texto: "Concurrent training interference one.", similitud: 0.9 },
    { texto: "Concurrent training interference two.", similitud: 0.88 },
    { texto: "Concurrent training interference three.", similitud: 0.86 },
    { texto: "Concurrent training interference four.", similitud: 0.84 },
  ] });
  await insertarDocumento(db, { titulo: "Irrelevante", chunks: [
    { texto: "Concurrent notes about something unrelated entirely.", similitud: 0.02 },
  ] });

  const resultado = await ejecutar(db, "interferencia concurrente");
  assert.equal(resultado.chunks.filter((c) => c._relleno).length, 0,
    "con 4 fragmentos buenos no debe añadirse relleno irrelevante al prompt");
  await db.close();
});
