/* Contrato de plan maestro versionado, generado por IA+RAG.

   Es deliberadamente estricto: una propiedad que el backend no entiende no
   puede convertirse accidentalmente en una orden de entrenamiento. El modelo
   propone la ESTRUCTURA (semanas, fases, tirada larga, sesiones maestras) y el
   código valida contra este contrato y contra los guardarraíles clínicos antes
   de persistir. La IA nunca decide fuera de lo que aquí se valida. */

export const MASTER_PLAN_SCHEMA_VERSION = "master-plan.v1";

const esObjeto = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const esCadena = (v, min = 0, max = Infinity) => typeof v === "string" && v.length >= min && v.length <= max;
const esNumero = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const numeroONull = (v, min, max) => v === null || v === undefined
  ? null
  : esNumero(Number(v), min, max) ? Number(v) : null;

const MODALIDADES = Object.freeze(["running", "strength", "recovery", "cross_training"]);
const TIPOS_SESION = Object.freeze([
  "long_run", "intervals", "tempo", "easy_run", "recovery_run",
  "heavy_strength", "strength", "mobility", "cross_training", "race",
]);
const CODIGOS_AGENDA = Object.freeze([
  "RUN A", "RUN B", "RUN C", "RUN D", "GYM A", "GYM B", "GYM C", "GYM D", "RECOVERY",
]);
const FASES = Object.freeze(["adaptacion", "base", "construccion", "especifica", "descarga", "taper", "competicion"]);

const TIPOS_POR_MODALIDAD = Object.freeze({
  running: new Set(["long_run", "intervals", "tempo", "easy_run", "recovery_run", "race"]),
  strength: new Set(["heavy_strength", "strength"]),
  recovery: new Set(["mobility"]),
  cross_training: new Set(["cross_training"]),
});

function error(lista, path, code, message) {
  lista.push({ path, code, message });
}

function clavesExactas(valor, permitidas, path, errores) {
  if (!esObjeto(valor)) { error(errores, path, "TYPE", "debe ser un objeto"); return false; }
  for (const key of Object.keys(valor)) {
    if (!permitidas.includes(key)) error(errores, `${path}.${key}`, "UNKNOWN_PROPERTY", "propiedad no permitida");
  }
  for (const key of permitidas) {
    if (!Object.hasOwn(valor, key)) error(errores, `${path}.${key}`, "REQUIRED", "propiedad obligatoria");
  }
  return true;
}

export function parsearPlanMaestro(texto) {
  if (esObjeto(texto)) return { ok: true, value: texto, errors: [] };
  const bruto = String(texto ?? "").trim();
  if (!bruto) return { ok: false, value: null, errors: [{ path: "$", code: "EMPTY", message: "respuesta vacía" }] };
  const sinBloque = bruto.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const inicio = sinBloque.indexOf("{");
  const fin = sinBloque.lastIndexOf("}");
  const candidato = inicio >= 0 && fin >= inicio ? sinBloque.slice(inicio, fin + 1) : sinBloque;
  try {
    const value = JSON.parse(candidato);
    return esObjeto(value)
      ? { ok: true, value, errors: [] }
      : { ok: false, value: null, errors: [{ path: "$", code: "TYPE", message: "la raíz debe ser un objeto" }] };
  } catch (e) {
    return { ok: false, value: null, errors: [{ path: "$", code: "INVALID_JSON", message: String(e.message).slice(0, 180) }] };
  }
}

function validarRiesgo(valor, path, errores) {
  if (!clavesExactas(valor, ["score", "causas"], path, errores)) return;
  if (!esNumero(valor.score, 0, 10)) error(errores, `${path}.score`, "RANGE", "debe ser un entero entre 0 y 10");
  if (!Array.isArray(valor.causas)) error(errores, `${path}.causas`, "TYPE", "debe ser un array");
}

function validarSemana(valor, index, path, errores, opciones) {
  if (!clavesExactas(valor, [
    "numero", "fase", "nota", "checkpoint", "gym", "deload", "taper", "sesiones",
  ], path, errores)) return;
  if (!Number.isInteger(valor.numero) || valor.numero < 1 || valor.numero > 52) {
    error(errores, `${path}.numero`, "RANGE", "debe ser un entero entre 1 y 52");
  }
  if (!FASES.includes(valor.fase)) error(errores, `${path}.fase`, "ENUM", "fase no permitida");
  if (typeof valor.gym !== "string") error(errores, `${path}.gym`, "TYPE", "gym debe ser texto");
  if (typeof valor.deload !== "boolean") error(errores, `${path}.deload`, "TYPE", "deload debe ser booleano");
  if (typeof valor.taper !== "boolean") error(errores, `${path}.taper`, "TYPE", "taper debe ser booleano");
  if (!Array.isArray(valor.sesiones) || valor.sesiones.length < 1 || valor.sesiones.length > 8) {
    error(errores, `${path}.sesiones`, "RANGE", "debe ser un array de 1 a 8 sesiones");
  }
  (Array.isArray(valor.sesiones) ? valor.sesiones : []).forEach((s, i) => {
    const sp = `${path}.sesiones[${i}]`;
    if (!esObjeto(s)) { error(errores, sp, "TYPE", "debe ser un objeto"); return; }
    if (!esCadena(s.codigo, 1, 12) || !CODIGOS_AGENDA.includes(s.codigo)) {
      error(errores, `${sp}.codigo`, "ENUM", "código de agenda no permitido");
    }
    if (!MODALIDADES.includes(s.modalidad)) error(errores, `${sp}.modalidad`, "ENUM", "modalidad no permitida");
    if (!TIPOS_SESION.includes(s.tipo)) error(errores, `${sp}.tipo`, "ENUM", "tipo de sesión no permitido");
    if (TIPOS_POR_MODALIDAD[s.modalidad] && !TIPOS_POR_MODALIDAD[s.modalidad].has(s.tipo)) {
      error(errores, `${sp}.tipo`, "MODALITY_MISMATCH", "el tipo no corresponde a la modalidad");
    }
    if (!esCadena(s.titulo, 1, 120)) error(errores, `${sp}.titulo`, "TEXT", "título obligatorio");
    if (!esCadena(s.objetivo, 0, 300)) error(errores, `${sp}.objetivo`, "TEXT", "objetivo acotado");
    if (!esNumero(s.duracionMin ?? s.duracion_min, 1, 360)) error(errores, `${sp}.duracion_min`, "RANGE", "entero 1-360");
    /* evidence_ids es opcional y puede ser índices cortos ([0,1,2]) o ids; no
       se exige para no inflar el JSON ni forzar un fallo de validación por
       formato de cita. La evidencia ya viaja en el prompt usado. */
    if (s.evidence_ids !== undefined && !Array.isArray(s.evidence_ids)) {
      error(errores, `${sp}.evidence_ids`, "TYPE", "debe ser array si se incluye");
    }
  });
}

/** Valida y devuelve el mismo objeto; nunca elimina silenciosamente campos. */
export function validarPlanMaestro(valor, opciones = {}) {
  const errores = [], warnings = [];
  const root = ["schema_version", "distancia_objetivo", "fecha_carrera", "total_semanas",
    "riesgo", "mezcla", "techo_tirada_larga_min", "taper_semanas", "semanas", "decisiones", "evidence_state"];
  if (!clavesExactas(valor, root, "$", errores)) return { ok: false, value: null, errors: errores, warnings };
  if (valor.schema_version !== MASTER_PLAN_SCHEMA_VERSION) {
    error(errores, "$.schema_version", "VERSION", `debe ser ${MASTER_PLAN_SCHEMA_VERSION}`);
  }
  if (!esCadena(valor.distancia_objetivo, 1, 60)) error(errores, "$.distancia_objetivo", "TEXT", "obligatorio");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor.fecha_carrera))) error(errores, "$.fecha_carrera", "DATE", "ISO inválida");
  if (!Number.isInteger(valor.total_semanas) || valor.total_semanas < 3 || valor.total_semanas > 26) {
    error(errores, "$.total_semanas", "RANGE", "entero 3-26");
  }
  if (!Number.isInteger(valor.taper_semanas) || valor.taper_semanas < 1 || valor.taper_semanas > Math.max(1, Math.floor(valor.total_semanas / 4))) {
    error(errores, "$.taper_semanas", "RANGE", "entero coherente con el total");
  }
  if (!numeroONull(valor.techo_tirada_larga_min, 1, 600)) error(errores, "$.techo_tirada_larga_min", "RANGE", "entero 1-600");
  if (!esObjeto(valor.mezcla) || !Number.isInteger(valor.mezcla.run) || !Number.isInteger(valor.mezcla.gym)) {
    error(errores, "$.mezcla", "TYPE", "debe tener run y gym enteros");
  }
  validarRiesgo(valor.riesgo || {}, "$.riesgo", errores);
  if (!Array.isArray(valor.semanas) || valor.semanas.length < 1) error(errores, "$.semanas", "RANGE", "array no vacío");
  (Array.isArray(valor.semanas) ? valor.semanas : []).forEach((s, i) => validarSemana(s, i, `$.semanas[${i}]`, errores, opciones));
  if (!Array.isArray(valor.decisiones)) error(errores, "$.decisiones", "TYPE", "debe ser array");
  if (!["sufficient", "limited", "mixed", "none"].includes(valor.evidence_state)) {
    error(errores, "$.evidence_state", "ENUM", "estado de evidencia no permitido");
  }
  return { ok: errores.length === 0, value: errores.length ? null : valor, errors: errores, warnings };
}

export const parseMasterPlan = parsearPlanMaestro;
export const validateMasterPlan = validarPlanMaestro;
