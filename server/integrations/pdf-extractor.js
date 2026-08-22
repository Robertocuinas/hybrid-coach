/* Extracción de PDF: PyMuPDF por subproceso + limpieza + detección de secciones.

   Por qué PyMuPDF y no pdf.js (docs/05-rag.md §2.1): conserva mucho mejor el
   orden de lectura en papers a dos columnas, que es la maquetación normal de
   la bibliografía de este proyecto. El coste es un runtime de Python en el
   contenedor; la alternativa era aceptar texto entremezclado entre columnas,
   que envenena tanto los embeddings como el full-text.

   El subproceso se lanza con execFile (sin shell) y recibe el PDF por stdin:
   nunca se escribe el archivo subido en disco. */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { presupuestoSalida } from "../ai/limits.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(AQUI, "extract.py");
const RAIZ = path.resolve(AQUI, "..", "..");
const TIMEOUT_MS = Number(process.env.PDF_EXTRACT_TIMEOUT_MS || 120000);

/* PyMuPDF no se instala en el Python del sistema sino en un entorno virtual del
   propio proyecto (ver nixpacks.toml): es lo único que funciona igual en el
   contenedor de Railway y en una máquina de desarrollo. Si ese entorno existe
   se usa sin que haya que declarar PYTHON_BIN; la variable sigue mandando. */
const VENV = [
  path.join(RAIZ, ".venv", "bin", "python"),
  path.join(RAIZ, ".venv", "Scripts", "python.exe"),
];

export const pythonBin = (env = process.env) => {
  const declarado = String(env.PYTHON_BIN || "").trim();
  if (declarado) return declarado;
  return VENV.find((candidato) => existsSync(candidato))
    || (process.platform === "win32" ? "python" : "python3");
};

/* El código de salida distingue "este servidor no puede extraer PDF" (falta el
   intérprete o la librería) de "este PDF concreto no se puede leer". Sin él,
   los dos casos llegan arriba como el mismo error genérico. */
function errorExtractor(error, stderr, env) {
  let detalle = String(stderr || error.message).trim();
  try { detalle = JSON.parse(detalle).error || detalle; } catch { /* stderr no era JSON */ }
  if (error.code === "ENOENT") detalle = `No se encontró el intérprete de Python (${pythonBin(env)}). Instálalo o define PYTHON_BIN.`;
  const fallo = new Error(detalle);
  fallo.codigoExtractor = error.code;
  return fallo;
}

/* ---------- 1. Extracción ---------- */

/* PostgreSQL RECHAZA el byte NUL en cualquier columna de texto: no es que lo
   guarde raro, es que aborta la inserción entera con «invalid byte sequence
   for encoding UTF8: 0x00». Un PDF con la codificación de fuentes rota los
   produce sin avisar, y como el documento y sus chunks se escriben en una
   transacción, un solo NUL en una página tiraba la ingesta completa del
   documento. El síntoma en la aplicación era mudo: cero fragmentos y ninguna
   pista de por qué.

   Los sustitutos sueltos van en el mismo saco por el mismo motivo: son UTF-16
   mal formado que tampoco sobrevive a la codificación de la conexión.

   Se limpia aquí, en la frontera donde el binario se vuelve texto, y no en el
   repositorio: así lo hereda TODO lo que sale del extractor —páginas y
   metadatos— sin que cada consumidor tenga que acordarse. El resto de
   controles C0 se respetan; no son ilegales y no toca inventarse criterios de
   limpieza que nadie ha pedido. */
const SIN_REPRESENTACION = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function sanearTexto(valor) {
  if (typeof valor === "string") return valor.replace(SIN_REPRESENTACION, "");
  if (Array.isArray(valor)) return valor.map(sanearTexto);
  if (valor && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, sanearTexto(v)]));
  }
  return valor;
}

export function ejecutarExtractor(buffer, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const hijo = execFile(pythonBin(env), [SCRIPT], {
      timeout: TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) return reject(errorExtractor(error, stderr, env));
      try { resolve(sanearTexto(JSON.parse(stdout))); }
      catch { reject(new Error("El extractor devolvió una salida ilegible")); }
    });
    hijo.stdin.end(buffer);
  });
}

/* Diagnóstico del panel de administración: dice si este servidor puede extraer
   PDF ANTES de que nadie suba uno. Nunca lanza; el estado es el valor. */
export function comprobarExtractor({ env = process.env } = {}) {
  return new Promise((resolve) => {
    const hijo = execFile(pythonBin(env), [SCRIPT, "--check"], {
      timeout: 20000,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) return resolve({ ok: false, motivo: errorExtractor(error, stderr, env).message });
      try {
        const { pymupdf, python } = JSON.parse(stdout);
        resolve({ ok: true, pymupdf, python });
      } catch { resolve({ ok: false, motivo: "El extractor devolvió una salida ilegible" }); }
    });
    hijo.stdin.end();
  });
}

/* ---------- 2. Limpieza (docs/05-rag.md §2.2) ---------- */

const esNumeroPagina = (linea) =>
  /^\s*\d{1,4}\s*$/.test(linea) || /^\s*(p[áa]g(ina)?\.?|page)\s*\d+(\s*(of|de)\s*\d+)?\s*$/i.test(linea);

const esPieDeFigura = (texto) =>
  /^\s*(figure|fig\.?|figura|table|tabla|supplementary)\s*\d+/i.test(texto) && texto.length < 400;

/* Cabeceras y pies se detectan por repetición: un bloque que aparece igual en
   la mayoría de las páginas y en su primera o última posición es plantilla,
   no contenido. Con menos de 3 páginas no hay muestra suficiente. */
function bloquesRepetidos(paginas) {
  if (paginas.length < 3) return new Set();
  const conteo = new Map();
  for (const pagina of paginas) {
    const candidatos = [pagina.bloques[0], pagina.bloques[pagina.bloques.length - 1]].filter(Boolean);
    for (const bloque of new Set(candidatos.map((b) => b.trim()))) {
      if (bloque.length > 200) continue;
      conteo.set(bloque, (conteo.get(bloque) || 0) + 1);
    }
  }
  const umbral = Math.max(2, Math.ceil(paginas.length * 0.5));
  return new Set([...conteo.entries()].filter(([, n]) => n >= umbral).map(([bloque]) => bloque));
}

/* "recu-\nperación" → "recuperación". Solo cuando la siguiente línea empieza
   en minúscula: si empieza en mayúscula el guion casi siempre es parte de un
   compuesto o de un nombre propio partido, y unirlo estropearía el término. */
const unirGuiones = (texto) => texto.replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, "$1$2");

const normalizarEspacios = (texto) => texto.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim();

export function limpiarPaginas(paginas) {
  const plantilla = bloquesRepetidos(paginas);
  return paginas.map((pagina) => ({
    numero: pagina.numero,
    bloques: pagina.bloques
      .map((bloque) => bloque.trim())
      .filter((bloque) => bloque && !plantilla.has(bloque) && !esNumeroPagina(bloque) && !esPieDeFigura(bloque))
      .map((bloque) => normalizarEspacios(unirGuiones(bloque)))
      .filter(Boolean),
  }));
}

/* ---------- 3. Secciones (docs/05-rag.md §3) ---------- */

/* El orden importa: "materials and methods" debe probarse antes que "methods"
   no por precedencia sino porque comparten prefijo en algunos papers. */
const PATRONES_SECCION = [
  ["abstract", /^(abstract|resumen|summary)\b/i],
  ["introduction", /^(\d+\.?\s*)?(introduction|introducci[óo]n|background)\b/i],
  ["methods", /^(\d+\.?\s*)?(materials?\s+and\s+methods|methods?(\s+and\s+materials)?|methodology|m[ée]todos?|materiales?\s+y\s+m[ée]todos)\b/i],
  ["results", /^(\d+\.?\s*)?(results?|findings|resultados)\b/i],
  ["discussion", /^(\d+\.?\s*)?(discussion|discusi[óo]n)\b/i],
  ["conclusion", /^(\d+\.?\s*)?(conclusions?|concluding\s+remarks|conclusiones?)\b/i],
];

/* Un encabezado es un bloque corto que coincide con el patrón. El límite de
   longitud evita que una frase que empieza por "Results show that..." dentro
   de un párrafo se confunda con el encabezado de la sección Results. */
export function seccionDeEncabezado(bloque) {
  const texto = bloque.trim();
  if (texto.length > 80) return null;
  for (const [seccion, patron] of PATRONES_SECCION) {
    if (patron.test(texto)) return seccion;
  }
  return null;
}

const ES_REFERENCIAS = /^(references?|bibliography|literature\s+cited|referencias|bibliograf[íi]a)\b/i;

/* Devuelve párrafos con su sección y su página. Es la entrada del chunker:
   a partir de aquí ya no hace falta saber que esto venía de un PDF. */
export function detectarSecciones(paginas) {
  const parrafos = [];
  let seccionActual = "other";
  let enReferencias = false;

  for (const pagina of paginas) {
    for (const bloque of pagina.bloques) {
      /* La lista de referencias del final no aporta contenido y contamina la
         búsqueda con autores de OTROS papers: se corta y no se vuelve. */
      if (!enReferencias && bloque.trim().length <= 80 && ES_REFERENCIAS.test(bloque.trim())) {
        enReferencias = true;
        continue;
      }
      if (enReferencias) continue;

      const seccion = seccionDeEncabezado(bloque);
      if (seccion) { seccionActual = seccion; continue; }   // el encabezado no es contenido
      parrafos.push({ texto: bloque, pagina: pagina.numero, seccion: seccionActual });
    }
  }
  return parrafos;
}

/* ---------- 4. DOI ---------- */

/* Se intenta por regex ANTES de preguntar al modelo: es más fiable y gratis
   (docs/05-rag.md §2.3). El punto final se recorta porque suele ser el de la
   frase, no parte del identificador. */
const DOI_RE = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i;
export function extraerDOI(texto) {
  const encontrado = String(texto || "").match(DOI_RE);
  return encontrado ? encontrado[1].replace(/[.,;)]+$/, "") : null;
}

/* ---------- 5. Pipeline ---------- */

export async function extraerDocumento(buffer, { env = process.env } = {}) {
  const crudo = await ejecutarExtractor(buffer, { env });
  const paginas = limpiarPaginas(crudo.paginas || []);
  const parrafos = detectarSecciones(paginas);
  const texto = parrafos.map((p) => p.texto).join("\n\n");

  return {
    numPaginas: crudo.numPaginas || paginas.length,
    meta: crudo.meta || {},
    parrafos,
    texto,
    doi: extraerDOI(texto),
    /* Un PDF escaneado sin capa de texto sale con casi nada. No se hace OCR:
       es una excepción manual, no el caso general (docs/05-rag.md §2.1). */
    tieneCapaDeTexto: texto.replace(/\s/g, "").length >= 200,
  };
}

/* ---------- 6. Ficha por LLM ---------- */

export const STUDY_TYPES = ["meta_analysis", "systematic_review", "rct", "observational", "position_statement", "narrative_review", "preprint"];
export const POPULATION_TYPES = ["runners", "strength_athletes", "general_population", "mixed"];
export const EVIDENCE_GRADES = ["fuerte", "moderada", "debil", "practica"];

/* Ampliación de SYS_PDF (el prompt que ya existía en cliente) con los tres
   campos que la tabla documents necesita y que antes no se pedían:
   study_type, population_type y sample_size.

   study_type y grado son EJES DISTINTOS a propósito (docs/05-rag.md §11): el
   primero es el diseño del estudio, el segundo la confianza que merece. Se le
   dice explícitamente al modelo que no derive uno del otro. */
export const SYS_PDF = `Extraes los metadatos de un artículo científico y, sobre todo, decides para qué sirve en la práctica.

Devuelves SOLO un objeto JSON:
{
  "autores": "Apellido, N. y cols.",
  "anio": 2023,
  "titulo": "título en español si el original está en inglés, manteniendo el sentido técnico",
  "fuente": "revista y tipo de estudio (ECA, meta-análisis, revisión, estudio observacional, preprint…)",
  "doi": "doi si aparece en el texto, cadena vacía si no",
  "tema": "una sola palabra o dos de esta lista si encaja: Rendimiento, Volumen, Lesiones, Concurrente, Fuerza, Hipertrofia, Detraining, Carga, Progresión, Monitorización, Taper, Nutrición, Recuperación, Sueño, Biomecánica, Calzado",
  "tags": ["5-10 palabras clave en español, en minúscula, que usará un buscador interno"],
  "study_type": "${STUDY_TYPES.join("|")}",
  "grado": "fuerte|moderada|debil|practica",
  "poblacion": "en quién se estudió: n, sexo, edad, nivel de entrenamiento",
  "population_type": "${POPULATION_TYPES.join("|")}",
  "sample_size": 24,
  "resumenIA": "qué encontró el estudio, 2-3 frases, con las cifras concretas si las da",
  "limites": "por qué NO se puede generalizar: tamaño de muestra, diseño, población, conflictos de interés",
  "aplicacion": "qué decisión concreta de entrenamiento justifica y con qué límites. Esto es lo más importante: escríbelo como una instrucción accionable, no como un resumen"
}

CRITERIO DE study_type (diseño del estudio, objetivo)
- meta_analysis: combina estadísticamente resultados de varios estudios
- systematic_review: revisión con búsqueda sistemática, sin metaanálisis
- rct: ensayo controlado aleatorizado
- observational: cohorte, caso-control, transversal, sin asignación aleatoria
- position_statement: posicionamiento o consenso de una sociedad científica
- narrative_review: revisión narrativa sin método sistemático
- preprint: no ha pasado revisión por pares

CRITERIO DE grado (confianza aplicada; NO se deduce de study_type)
- fuerte: meta-análisis o revisión sistemática de ECA, o varios ECA concordantes
- moderada: un ECA bien hecho, o estudios observacionales consistentes
- debil: estudio pequeño, preprint, transversal, o resultados contradictorios
- practica: artículo de posición, opinión de expertos o descripción de práctica habitual sin datos

Un meta-análisis con muestra pequeña y alta heterogeneidad puede merecer grado "moderada" o
"debil". Un ECA grande y bien ejecutado puede merecer "fuerte". Juzga los dos ejes por separado.

CRITERIO DE population_type
- runners: corredores o deportistas de resistencia
- strength_athletes: deportistas de fuerza, culturismo, halterofilia
- general_population: población general, sedentarios, pacientes
- mixed: varias de las anteriores, o deportistas sin especificar modalidad

REGLAS
- Si un dato no aparece en el texto, cadena vacía. NO inventes DOI, año ni autores.
- "sample_size" es el número TOTAL de participantes, como número entero. Si el estudio no
  informa de participantes (revisión narrativa, posicionamiento) o no lo puedes determinar,
  usa null. En un metaanálisis, el total agregado si lo da; si no, null.
- Si el texto está incompleto o cortado, trabaja con lo que hay y dilo en "limites".
- En "aplicacion" no repitas el resumen: escribe qué haría un entrenador distinto por haber leído esto.`;

/* El modelo a veces envuelve el JSON en prosa o en un bloque de código. Mismo
   patrón que extraerJSON() en cliente: se recorta al primer objeto completo. */
export function extraerJSON(texto) {
  const limpio = String(texto || "").replace(/```(?:json)?/gi, "");
  const inicio = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) throw new Error("El modelo no devolvió JSON");
  return JSON.parse(limpio.slice(inicio, fin + 1));
}

const enLista = (valor, lista) => lista.includes(String(valor || "").trim()) ? String(valor).trim() : null;

/* Toda salida del modelo se valida antes de tocar la base de datos: los enums
   de PostgreSQL rechazarían un valor inventado, pero es mejor devolver null y
   que la revisión humana lo complete que reventar la ingesta entera. */
export function normalizarFicha(bruto = {}, { doiDetectado = null } = {}) {
  const entero = (valor) => {
    const n = Number.parseInt(valor, 10);
    return Number.isInteger(n) && n > 0 && n < 10_000_000 ? n : null;
  };
  const texto = (valor) => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

  return {
    titulo: texto(bruto.titulo),
    autores: texto(bruto.autores),
    anio: entero(bruto.anio),
    fuenteRevista: texto(bruto.fuente),
    /* El DOI del texto manda sobre el del modelo: la regex no alucina. */
    doi: doiDetectado || texto(bruto.doi),
    studyType: enLista(bruto.study_type, STUDY_TYPES),
    evidenceGrade: enLista(bruto.grado, EVIDENCE_GRADES),
    poblacion: texto(bruto.poblacion),
    populationType: enLista(bruto.population_type, POPULATION_TYPES),
    sampleSize: entero(bruto.sample_size),
    temaPrincipal: texto(bruto.tema),
    tags: Array.isArray(bruto.tags) ? bruto.tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim()) : [],
    resumen: texto(bruto.resumenIA),
    limites: texto(bruto.limites),
    aplicacionPractica: texto(bruto.aplicacion),
  };
}

/* Se manda solo el principio del documento: título, resumen, métodos y parte
   de la discusión bastan para clasificarlo, y el texto completo no cabe en
   contexto ni compensa pagarlo. */
export async function analizarFicha(texto, { provider, nombre = "documento.pdf", maxChars = 55000, doiDetectado = null }) {
  if (!provider) throw new Error("No hay proveedor de IA configurado: la ficha debe rellenarse a mano");
  const respuesta = await provider.call({
    system: SYS_PDF,
    maxTokens: presupuestoSalida().pdf,
    messages: [{ role: "user", content: `Archivo: ${nombre}\n\nTEXTO EXTRAÍDO:\n${texto.slice(0, maxChars)}` }],
  });
  return normalizarFicha(extraerJSON(respuesta.text), { doiDetectado });
}
