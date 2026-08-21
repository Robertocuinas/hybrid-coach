/* Formatea la evidencia para el prompt del plan maestro, igual que
   formatearEvidenciaPlanificador pero con las columnas del chunk genérico. */

export const MAESTRO_CHARS_POR_CHUNK = Math.max(300, Number(process.env.MASTER_EVIDENCE_CHARS || 1200) || 1200);

export function formatearEvidenciaMaestro(chunks = [], charsPorChunk = MAESTRO_CHARS_POR_CHUNK) {
  if (!chunks.length) return "(sin evidencia)";
  return [
    "<EVIDENCIA_NO_CONFIABLE>",
    ...chunks.map((chunk) => {
      const cabecera = [
        `[id:${chunk.id}]`,
        chunk.titulo || chunk.title || "sin título",
        chunk.autores || chunk.authors || null,
        chunk.anio || chunk.year || null,
        chunk.studyType || chunk.study_type || null,
        chunk.evidenceGrade || chunk.evidence_grade || null,
        chunk._relleno || chunk.esRelleno ? "RELLENO_NO_CITABLE" : null,
      ].filter(Boolean).join(" · ");
      return `${cabecera}\n${String(chunk.texto || chunk.text || "").slice(0, charsPorChunk)}`;
    }),
    "</EVIDENCIA_NO_CONFIABLE>",
  ].join("\n\n");
}
