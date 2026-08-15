import { pathToFileURL } from "node:url";
import pool from "./pool.js";
import { BIBLIO_SEED } from "../../src/data/biblioSeed.js";

export const STUDY_TYPE_BY_ID = Object.freeze({
  b1: "narrative_review", b2: "observational", b3: "meta_analysis", b4: "observational",
  b5: "meta_analysis", b6: "rct", b7: "systematic_review", b8: "meta_analysis",
  b9: "narrative_review", b10: "systematic_review", b11: "meta_analysis", b12: "rct",
  b13: "position_statement", b14: "rct", b15: "preprint", b16: "narrative_review",
  b17: "narrative_review", b18: "narrative_review", b19: "meta_analysis", b20: "meta_analysis",
  b21: "position_statement", b22: "meta_analysis",
  n1: "position_statement", n2: "narrative_review", n3: "narrative_review", n4: "position_statement",
  n5: "narrative_review", n6: "narrative_review", n7: "rct", n8: "position_statement",
  n9: "narrative_review", n10: "narrative_review", n11: "position_statement", n12: "narrative_review",
  n13: "position_statement", n14: "narrative_review", n15: "narrative_review", n16: "narrative_review",
  n17: "narrative_review", n18: "narrative_review",
});

export const POPULATION_TYPE_BY_ID = Object.freeze({
  n1: "mixed", n2: "runners", n3: "runners", n4: "mixed",
  n5: "strength_athletes", n6: "strength_athletes", n7: "strength_athletes", n8: "mixed",
  n9: "mixed", n10: "runners", n11: "mixed", n12: "runners",
  n13: "mixed", n14: "general_population", n15: "general_population", n16: "mixed",
  n17: "strength_athletes", n18: "runners",
});

const EVIDENCE_GRADE = Object.freeze({
  fuerte: "fuerte",
  moderada: "moderada",
  "débil": "debil",
  "práctica": "practica",
});

export function buildSeedDocuments() {
  return BIBLIO_SEED.map((ref) => ({
    legacy_id: ref.id,
    titulo: ref.titulo,
    autores: ref.autores || null,
    anio: Number(ref.anio) || null,
    fuente_revista: ref.fuente || null,
    doi: ref.doi?.trim() || null,
    study_type: STUDY_TYPE_BY_ID[ref.id],
    evidence_grade: EVIDENCE_GRADE[ref.grado],
    poblacion: ref.poblacion || null,
    population_type: POPULATION_TYPE_BY_ID[ref.id] || null,
    sample_size: ref.id === "n7" ? 24 : null,
    tema_principal: ref.tema || null,
    tags: Array.isArray(ref.tags) ? ref.tags : [],
    resumen: ref.resumenIA || null,
    limites: ref.limites || null,
    aplicacion_practica: ref.aplicacion || null,
    origen: "semilla",
    // Son fichas de catálogo heredadas, no texto verificable. Sin chunks del
    // documento original nunca pueden funcionar como evidencia citable.
    revisado: false,
  }));
}

const COLUMNS = [
  "legacy_id", "titulo", "autores", "anio", "fuente_revista", "doi", "study_type",
  "evidence_grade", "poblacion", "population_type", "sample_size", "tema_principal",
  "tags", "resumen", "limites", "aplicacion_practica", "origen", "revisado",
];

export async function seedBibliography(client = pool) {
  const documents = buildSeedDocuments();
  const missing = documents.filter((doc) => !doc.study_type || !doc.evidence_grade);
  if (documents.length !== 40 || missing.length) {
    throw new Error(`Semilla bibliográfica incompleta: ${documents.length} filas, ${missing.length} sin clasificar.`);
  }

  // Un Pool no fija conexión entre llamadas; la transacción necesita un client dedicado.
  const db = typeof client.connect === "function" ? await client.connect() : client;
  const release = typeof db.release === "function" ? () => db.release() : () => {};
  await db.query("BEGIN");
  try {
    let inserted = 0;
    let updated = 0;
    for (const doc of documents) {
      const values = COLUMNS.map((column) => doc[column]);
      const assignments = COLUMNS.map((column, index) => `${column} = $${index + 1}`).join(", ");
      const result = await db.query(
        `UPDATE documents SET ${assignments}
          WHERE legacy_id = $1 OR (titulo = $2 AND anio IS NOT DISTINCT FROM $4)
          RETURNING id;`,
        values
      );
      const affected = result.rowCount ?? result.affectedRows ?? result.rows.length;
      if (affected) {
        updated += affected;
      } else {
        const placeholders = COLUMNS.map((_, index) => `$${index + 1}`).join(", ");
        await db.query(`INSERT INTO documents (${COLUMNS.join(", ")}) VALUES (${placeholders});`, values);
        inserted += 1;
      }
    }
    await db.query("COMMIT");
    return { total: documents.length, inserted, updated };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL es obligatoria para cargar la bibliografía.");
  const result = await seedBibliography();
  console.log(`Bibliografía cargada: ${result.total} referencias (${result.inserted} nuevas, ${result.updated} actualizadas).`);
  console.warn("Aviso: las referencias heredadas deben verificarse antes de citarlas en un trabajo formal.");
  await pool.end();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error(error.message);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
}
