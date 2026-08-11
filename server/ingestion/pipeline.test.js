import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { ingerirPDF, IngestaError, esPDF, MAX_BYTES } from "./pipeline.js";
import { storageKeyForHash, sha256 } from "../integrations/storage/r2.js";

const ESQUEMA = `
  CREATE TYPE study_type AS ENUM ('meta_analysis','systematic_review','rct','observational','position_statement','narrative_review','preprint');
  CREATE TYPE evidence_grade AS ENUM ('fuerte','moderada','debil','practica');
  CREATE TYPE population_type AS ENUM ('runners','strength_athletes','general_population','mixed');
  CREATE TYPE document_origen AS ENUM ('semilla','manual','pdf');
  CREATE TABLE documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legacy_id text UNIQUE, titulo text, autores text, anio int,
    fuente_revista text, doi text UNIQUE, hash_archivo text UNIQUE, study_type study_type, evidence_grade evidence_grade,
    poblacion text, population_type population_type, sample_size int, tema_principal text, tags text[],
    resumen text, limites text, aplicacion_practica text, storage_key text, origen document_origen,
    revisado boolean DEFAULT false, subido_por uuid, created_at timestamptz DEFAULT now()
  );
  CREATE TABLE document_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index int, seccion text, pagina_inicio int, pagina_fin int, texto text, num_tokens int,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(texto, ''))) STORED
  );
`;

/* El repositorio real usa el pool global; aquí se inyecta uno que habla con
   PGlite para poder probar el pipeline entero sin PostgreSQL instalado. */
function repoSobre(db) {
  return {
    async findDocumentByHash(hash) {
      const { rows } = await db.query(`SELECT * FROM documents WHERE hash_archivo = $1;`, [hash]);
      return rows[0] || null;
    },
    async findDocumentByDoi(doi) {
      const { rows } = await db.query(`SELECT * FROM documents WHERE doi = $1;`, [doi]);
      return rows[0] || null;
    },
    crearDocumentoConChunks: async (client, payload) => {
      const { crearDocumentoConChunks } = await import("../db/repositories/documents.js");
      return crearDocumentoConChunks(client, payload);
    },
  };
}

function almacenFalso() {
  const objetos = new Map();
  return {
    objetos,
    async guardarPDF(buffer, hash) {
      const key = storageKeyForHash(hash);
      objetos.set(key, buffer);
      return key;
    },
    urlPublica: () => null,
  };
}

const proveedorFalso = (respuesta) => ({
  call: async () => ({ text: JSON.stringify(respuesta) }),
});

const FICHA = {
  autores: "Wilson, J. M. y cols.", anio: 2012,
  titulo: "Entrenamiento concurrente: metaanálisis del efecto de interferencia",
  fuente: "J Strength Cond Res · meta-análisis", doi: "",
  tema: "Concurrente", tags: ["concurrente", "interferencia"],
  study_type: "meta_analysis", grado: "fuerte",
  poblacion: "n=24, corredores entrenados", population_type: "runners", sample_size: 24,
  resumenIA: "La interferencia es mayor con carrera que con ciclismo.",
  limites: "Heterogeneidad alta entre estudios.",
  aplicacion: "Separar fuerza pesada de intervalos al menos 24 h.",
};

const extraccionFalsa = (doi = "10.1519/JSC.0b013e31823a3e2d") => async () => ({
  numPaginas: 5,
  meta: { titulo: "", autores: "" },
  doi,
  tieneCapaDeTexto: true,
  texto: "Texto completo del paper.",
  parrafos: [
    { texto: "Resumen del estudio. ".repeat(30).trim(), pagina: 1, seccion: "abstract" },
    { texto: "Participantes entrenados. ".repeat(30).trim(), pagina: 2, seccion: "methods" },
    { texto: "El efecto fue mayor al correr. ".repeat(30).trim(), pagina: 3, seccion: "results" },
  ],
});

const PDF_MINIMO = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2048, 0x20)]);

async function baseDeDatos() {
  const db = new PGlite();
  await db.exec(ESQUEMA);
  return db;
}

test("un PDF válido entra con revisado=false, chunks y original en el almacén", async () => {
  const db = await baseDeDatos();
  const storage = almacenFalso();
  const resultado = await ingerirPDF(PDF_MINIMO, {
    db, storage, repo: repoSobre(db), provider: proveedorFalso(FICHA),
    extraer: extraccionFalsa(), nombre: "wilson-2012.pdf",
  });

  const { rows } = await db.query(`SELECT * FROM documents;`);
  assert.equal(rows.length, 1);
  const doc = rows[0];
  assert.equal(doc.revisado, false, "debe entrar sin revisar");
  assert.equal(doc.origen, "pdf");
  assert.equal(doc.study_type, "meta_analysis");
  assert.equal(doc.population_type, "runners");
  assert.equal(doc.sample_size, 24);
  assert.equal(doc.evidence_grade, "fuerte");
  assert.equal(doc.hash_archivo, sha256(PDF_MINIMO));
  assert.equal(doc.doi, "10.1519/JSC.0b013e31823a3e2d", "el DOI del texto manda sobre el del modelo");

  const chunks = await db.query(`SELECT * FROM document_chunks ORDER BY chunk_index;`);
  assert.equal(chunks.rows.length, resultado.chunks);
  assert.ok(chunks.rows.length >= 3);
  assert.deepEqual(chunks.rows.map((c) => c.seccion), ["abstract", "methods", "results"]);
  assert.ok(chunks.rows.every((c) => c.num_tokens > 0 && c.pagina_inicio >= 1));
  assert.ok(chunks.rows.every((c) => c.document_id === doc.id));

  // El original queda en el almacén bajo una clave derivada del hash.
  assert.equal(doc.storage_key, storageKeyForHash(sha256(PDF_MINIMO)));
  assert.ok(storage.objetos.has(doc.storage_key));
  assert.ok(storage.objetos.get(doc.storage_key).equals(PDF_MINIMO));
  await db.close();
});

test("el mismo archivo dos veces se rechaza por hash", async () => {
  const db = await baseDeDatos();
  const deps = { db, storage: almacenFalso(), repo: repoSobre(db), provider: proveedorFalso(FICHA), extraer: extraccionFalsa() };
  await ingerirPDF(PDF_MINIMO, deps);
  await assert.rejects(() => ingerirPDF(PDF_MINIMO, deps), (error) => {
    assert.ok(error instanceof IngestaError);
    assert.equal(error.status, 409);
    assert.equal(error.motivo, "hash");
    return true;
  });
  assert.equal((await db.query(`SELECT count(*)::int n FROM documents;`)).rows[0].n, 1);
  await db.close();
});

test("el mismo paper desde otro archivo se rechaza por DOI", async () => {
  const db = await baseDeDatos();
  const base = { db, storage: almacenFalso(), repo: repoSobre(db), provider: proveedorFalso(FICHA) };
  await ingerirPDF(PDF_MINIMO, { ...base, extraer: extraccionFalsa() });

  const otroArchivo = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(3000, 0x41)]);
  await assert.rejects(() => ingerirPDF(otroArchivo, { ...base, extraer: extraccionFalsa() }), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.motivo, "doi");
    return true;
  });
  assert.equal((await db.query(`SELECT count(*)::int n FROM documents;`)).rows[0].n, 1);
  await db.close();
});

test("lo que no empieza por %PDF- se rechaza aunque diga llamarse .pdf", async () => {
  const db = await baseDeDatos();
  const disfrazado = Buffer.from("<?php system($_GET['x']); ?>");
  assert.equal(esPDF(disfrazado), false);
  await assert.rejects(
    () => ingerirPDF(disfrazado, { db, storage: almacenFalso(), repo: repoSobre(db), provider: proveedorFalso(FICHA), nombre: "malicioso.pdf" }),
    (error) => error.status === 415
  );
  assert.equal((await db.query(`SELECT count(*)::int n FROM documents;`)).rows[0].n, 0);
  await db.close();
});

test("un PDF por encima del límite se rechaza antes de procesarlo", async () => {
  const db = await baseDeDatos();
  const enorme = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(MAX_BYTES + 1024, 0x20)]);
  let extraccionesLlamadas = 0;
  await assert.rejects(
    () => ingerirPDF(enorme, {
      db, storage: almacenFalso(), repo: repoSobre(db), provider: proveedorFalso(FICHA),
      extraer: async () => { extraccionesLlamadas++; return extraccionFalsa()(); },
    }),
    (error) => error.status === 413
  );
  assert.equal(extraccionesLlamadas, 0, "no debe extraer nada de un archivo que ya excede el límite");
  await db.close();
});

test("un PDF escaneado sin capa de texto se rechaza con mensaje claro, sin OCR", async () => {
  const db = await baseDeDatos();
  await assert.rejects(
    () => ingerirPDF(PDF_MINIMO, {
      db, storage: almacenFalso(), repo: repoSobre(db), provider: proveedorFalso(FICHA),
      extraer: async () => ({ numPaginas: 3, meta: {}, doi: null, texto: "", parrafos: [], tieneCapaDeTexto: false }),
    }),
    (error) => {
      assert.equal(error.status, 422);
      assert.match(error.message, /escaneado/i);
      return true;
    }
  );
  await db.close();
});

test("sin proveedor de IA el documento entra igual, con aviso, para rellenar a mano", async () => {
  const db = await baseDeDatos();
  const resultado = await ingerirPDF(PDF_MINIMO, {
    db, storage: almacenFalso(), repo: repoSobre(db), provider: null, extraer: extraccionFalsa(),
  });
  assert.match(resultado.aviso, /ficha/i);
  const { rows } = await db.query(`SELECT doi, revisado, study_type FROM documents;`);
  assert.equal(rows[0].doi, "10.1519/JSC.0b013e31823a3e2d", "el DOI por regex funciona sin IA");
  assert.equal(rows[0].revisado, false);
  assert.equal(rows[0].study_type, null, "sin IA los campos de clasificación quedan para revisión humana");
  await db.close();
});

test("sin almacenamiento configurado no se ingiere nada", async () => {
  const db = await baseDeDatos();
  await assert.rejects(
    () => ingerirPDF(PDF_MINIMO, { db, storage: null, repo: repoSobre(db), provider: proveedorFalso(FICHA), extraer: extraccionFalsa() }),
    (error) => error.status === 503
  );
  await db.close();
});

test("una ficha con valores inventados por el modelo no llega a la base de datos", async () => {
  const db = await baseDeDatos();
  const inventado = { ...FICHA, study_type: "estudio_inventado", population_type: "marcianos", grado: "altísima", sample_size: "muchos" };
  await ingerirPDF(PDF_MINIMO, {
    db, storage: almacenFalso(), repo: repoSobre(db), provider: proveedorFalso(inventado), extraer: extraccionFalsa(),
  });
  const { rows } = await db.query(`SELECT study_type, population_type, evidence_grade, sample_size FROM documents;`);
  assert.deepEqual(rows[0], { study_type: null, population_type: null, evidence_grade: null, sample_size: null });
  await db.close();
});
