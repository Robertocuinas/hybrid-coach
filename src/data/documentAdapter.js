const GRADE_FROM_API = Object.freeze({
  fuerte: "fuerte",
  moderada: "moderada",
  debil: "débil",
  practica: "práctica",
});

const GRADE_TO_API = Object.freeze({
  fuerte: "fuerte",
  moderada: "moderada",
  "débil": "debil",
  "práctica": "practica",
});

export function documentoDesdeAPI(row = {}) {
  return {
    id: row.legacy_id || row.id,
    _dbId: row.id || "",
    autores: row.autores || "",
    anio: Number(row.anio) || new Date().getFullYear(),
    titulo: row.titulo || "",
    fuente: row.fuente_revista || "",
    tema: row.tema_principal || "",
    grado: GRADE_FROM_API[row.evidence_grade] || "moderada",
    aplicacion: row.aplicacion_practica || "",
    doi: row.doi || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    origen: row.origen || "manual",
    resumenIA: row.resumen || "",
    poblacion: row.poblacion || "",
    limites: row.limites || "",
    revisado: row.revisado !== false,
    creado: row.created_at || new Date().toISOString().slice(0, 10),
    /* null se conserva: un documento recién ingerido puede estar SIN clasificar
       y etiquetarlo por defecto como revisión narrativa sería inventarse un
       metadato que luego filtra el retrieval. */
    studyType: row.study_type || null,
    populationType: row.population_type || null,
    sampleSize: Number.isInteger(row.sample_size) ? row.sample_size : null,
  };
}

export function documentoParaAPI(ref = {}) {
  return {
    titulo: ref.titulo || null,
    autores: ref.autores || null,
    anio: Number(ref.anio) || null,
    fuenteRevista: ref.fuente || null,
    doi: ref.doi?.trim() || null,
    studyType: ref.studyType || null,
    evidenceGrade: GRADE_TO_API[ref.grado] || "moderada",
    poblacion: ref.poblacion || null,
    populationType: ref.populationType || null,
    sampleSize: Number.isInteger(ref.sampleSize) ? ref.sampleSize : null,
    temaPrincipal: ref.tema || null,
    tags: Array.isArray(ref.tags) ? ref.tags : [],
    resumen: ref.resumenIA || null,
    limites: ref.limites || null,
    aplicacionPractica: ref.aplicacion || null,
    // En PATCH no se cambia el origen (una semilla editada sigue siendo semilla).
    origen: ref._dbId ? undefined : ref.origen === "pdf" ? "pdf" : "manual",
    // Solo un PDF ya persistido tiene chunks que un admin pueda confirmar.
    // Las altas manuales son catálogo, no evidencia RAG.
    revisado: ref.origen === "pdf" && !!ref._dbId,
  };
}
