import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { buildSeedDocuments, seedBibliography } from "./seed-biblio.js";

test("las 40 referencias están clasificadas y mantienen su id heredado", () => {
  const documents = buildSeedDocuments();
  assert.equal(documents.length, 40);
  assert.equal(new Set(documents.map((doc) => doc.legacy_id)).size, 40);
  assert.ok(documents.every((doc) => doc.study_type && doc.evidence_grade));
  assert.ok(documents.filter((doc) => doc.legacy_id.startsWith("b")).every((doc) => doc.population_type === null));
  assert.ok(documents.filter((doc) => doc.legacy_id.startsWith("n")).every((doc) => doc.population_type));
});

test("el seed de bibliografía es idempotente en PostgreSQL", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TYPE study_type AS ENUM ('meta_analysis','systematic_review','rct','observational','position_statement','narrative_review','preprint');
    CREATE TYPE evidence_grade AS ENUM ('fuerte','moderada','debil','practica');
    CREATE TYPE population_type AS ENUM ('runners','strength_athletes','general_population','mixed');
    CREATE TYPE document_origen AS ENUM ('semilla','manual','pdf');
    CREATE TABLE documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legacy_id text UNIQUE, titulo text, autores text, anio int,
      fuente_revista text, doi text UNIQUE, study_type study_type, evidence_grade evidence_grade,
      poblacion text, population_type population_type, sample_size int, tema_principal text, tags text[],
      resumen text, limites text, aplicacion_practica text, origen document_origen, revisado boolean
    );
  `);
  const first = await seedBibliography(db);
  const second = await seedBibliography(db);
  const result = await db.query(`SELECT count(*)::int AS total, count(study_type)::int AS classified FROM documents;`);
  assert.deepEqual(first, { total: 40, inserted: 40, updated: 0 });
  assert.deepEqual(second, { total: 40, inserted: 0, updated: 40 });
  assert.deepEqual(result.rows[0], { total: 40, classified: 40 });
  await db.close();
});
