import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extraerDOI, limpiarPaginas, detectarSecciones, seccionDeEncabezado,
  normalizarFicha, extraerJSON, extraerDocumento, comprobarExtractor, pythonBin,
} from "./pdf-extractor.js";

const SCRIPT_EXTRACTOR = path.join(path.dirname(fileURLToPath(import.meta.url)), "extract.py");

/* ---------- Puras: no necesitan Python ---------- */

test("el DOI se extrae del texto y se limpia la puntuación final", () => {
  assert.equal(extraerDOI("Disponible en doi: 10.1519/JSC.0b013e31823a3e2d."), "10.1519/JSC.0b013e31823a3e2d");
  assert.equal(extraerDOI("https://doi.org/10.1007/s40279-018-0862-z)"), "10.1007/s40279-018-0862-z");
  assert.equal(extraerDOI("Sin identificador aquí"), null);
});

test("las cabeceras repetidas en la mayoría de páginas se eliminan", () => {
  const paginas = Array.from({ length: 4 }, (_, i) => ({
    numero: i + 1,
    bloques: ["J Strength Cond Res 2012", `Contenido real de la página ${i + 1}.`, String(i + 1)],
  }));
  const limpias = limpiarPaginas(paginas);
  assert.ok(limpias.every((p) => !p.bloques.some((b) => b.includes("J Strength Cond Res"))), "la cabecera debe desaparecer");
  assert.ok(limpias.every((p) => p.bloques.length === 1), "el número de página suelto también");
  assert.ok(limpias[0].bloques[0].includes("Contenido real"));
});

test("con menos de 3 páginas no se descarta nada por repetición", () => {
  const paginas = [
    { numero: 1, bloques: ["Encabezado", "Cuerpo uno."] },
    { numero: 2, bloques: ["Encabezado", "Cuerpo dos."] },
  ];
  assert.equal(limpiarPaginas(paginas)[0].bloques.length, 2);
});

test("los pies de figura y tabla sueltos se descartan", () => {
  const [pagina] = limpiarPaginas([{ numero: 1, bloques: ["Figure 3. Forest plot of effect sizes.", "Texto de verdad."] }]);
  assert.deepEqual(pagina.bloques, ["Texto de verdad."]);
});

test("los guiones de partición se unen solo cuando sigue minúscula", () => {
  const [pagina] = limpiarPaginas([{ numero: 1, bloques: ["la recu-\nperación muscular", "el test Wingate-\nBased protocolo"] }]);
  assert.match(pagina.bloques[0], /recuperación/);
  assert.match(pagina.bloques[1], /Wingate-\s?Based/, "un compuesto con mayúscula no debe unirse");
});

test("se reconocen los encabezados de sección y no las frases que los mencionan", () => {
  assert.equal(seccionDeEncabezado("Abstract"), "abstract");
  assert.equal(seccionDeEncabezado("2. Materials and Methods"), "methods");
  assert.equal(seccionDeEncabezado("MÉTODOS"), "methods");
  assert.equal(seccionDeEncabezado("Discussion"), "discussion");
  assert.equal(seccionDeEncabezado("Results show that the interference effect was larger for running than cycling in every subgroup analysed here."), null);
  assert.equal(seccionDeEncabezado("Cualquier párrafo normal"), null);
});

test("la lista de referencias final se corta y no vuelve", () => {
  const parrafos = detectarSecciones([
    { numero: 1, bloques: ["Discussion", "Contenido útil."] },
    { numero: 2, bloques: ["References", "1. Autor irrelevante, Journal of Nothing.", "2. Otro autor."] },
  ]);
  assert.equal(parrafos.length, 1);
  assert.equal(parrafos[0].seccion, "discussion");
  assert.ok(!parrafos.some((p) => p.texto.includes("Journal of Nothing")));
});

test("normalizarFicha descarta enums inventados y prioriza el DOI del texto", () => {
  const ficha = normalizarFicha(
    { study_type: "inventado", population_type: "runners", grado: "fuerte", sample_size: "24", doi: "10.9999/falso", tags: ["a", 3, " b "] },
    { doiDetectado: "10.1519/real" }
  );
  assert.equal(ficha.studyType, null);
  assert.equal(ficha.populationType, "runners");
  assert.equal(ficha.evidenceGrade, "fuerte");
  assert.equal(ficha.sampleSize, 24);
  assert.equal(ficha.doi, "10.1519/real");
  assert.deepEqual(ficha.tags, ["a", "b"]);
});

test("extraerJSON tolera el JSON envuelto en prosa o en bloque de código", () => {
  assert.deepEqual(extraerJSON('Aquí tienes:\n```json\n{"anio": 2012}\n```\nEspero que sirva.'), { anio: 2012 });
  assert.throws(() => extraerJSON("no hay json"), /no devolvió JSON/);
});

/* ---------- Integración real con PyMuPDF ---------- */

const hayPython = (() => {
  try {
    execFileSync(pythonBin(), ["-c", "import pymupdf"], { stdio: "ignore" });
    return true;
  } catch { return false; }
})();

/* Se importa `pymupdf` y no `fitz` por lo mismo que en extract.py: el alias
   viejo escribe un aviso en stdout y aquí stdout son los bytes del PDF. */
function pdfDePrueba() {
  const guion = `
import pymupdf as fitz, sys
doc = fitz.open()
cabecera = 'J Strength Cond Res 2012'
def pagina(titulo, cuerpo):
    p = doc.new_page(); p.insert_text((60, 30), cabecera, fontsize=7)
    p.insert_text((60, 60), titulo, fontsize=12); y = 90
    for linea in [cuerpo[i:i+95] for i in range(0, len(cuerpo), 95)]:
        p.insert_text((60, y), linea, fontsize=9); y += 12
    p.insert_text((300, 800), str(doc.page_count), fontsize=8)

p = doc.new_page(); p.insert_text((60, 30), cabecera, fontsize=7)
p.insert_text((60, 60), 'Concurrent training: a meta-analysis', fontsize=13)
p.insert_text((60, 85), 'doi: 10.1519/JSC.0b013e31823a3e2d', fontsize=9)
p.insert_text((60, 115), 'Abstract', fontsize=12)
p.insert_text((60, 140), 'This meta-analysis examined the interference effect in trained runners.', fontsize=9)
pagina('Methods', 'Participants were 24 trained male runners aged 21 to 34 years. ' * 5)
pagina('Results', 'The interference effect was larger for running than for cycling. ' * 5)
pagina('Discussion', 'Heavy lower-body work should be separated from quality running. ' * 5)
p = doc.new_page(); p.insert_text((60, 30), cabecera, fontsize=7)
p.insert_text((60, 60), 'References', fontsize=12)
p.insert_text((60, 90), '1. Autor irrelevante. Journal of Nothing, 1999.', fontsize=9)
sys.stdout.buffer.write(doc.tobytes())
`;
  return execFileSync(pythonBin(), ["-c", guion], { maxBuffer: 32 * 1024 * 1024 });
}

test("extrae un PDF real: secciones, páginas, DOI y limpieza", { skip: hayPython ? false : "sin Python con PyMuPDF" }, async () => {
  const documento = await extraerDocumento(pdfDePrueba());

  assert.equal(documento.numPaginas, 5);
  assert.equal(documento.tieneCapaDeTexto, true);
  assert.equal(documento.doi, "10.1519/JSC.0b013e31823a3e2d");

  const secciones = new Set(documento.parrafos.map((p) => p.seccion));
  for (const esperada of ["abstract", "methods", "results", "discussion"]) {
    assert.ok(secciones.has(esperada), `falta la sección ${esperada}`);
  }
  assert.ok(!documento.texto.includes("Journal of Nothing"), "las referencias no deben sobrevivir");
  assert.ok(!documento.texto.includes("J Strength Cond Res 2012"), "la cabecera repetida no debe sobrevivir");

  const methods = documento.parrafos.find((p) => p.seccion === "methods");
  assert.equal(methods.pagina, 2, "Methods está en la página 2 del PDF");
});

test("un PDF corrupto falla con un mensaje legible", { skip: hayPython ? false : "sin Python con PyMuPDF" }, async () => {
  await assert.rejects(() => extraerDocumento(Buffer.from("%PDF-1.7 esto no es un pdf de verdad")), /No se pudo abrir el PDF|PDF/);
});

/* Regresión: PyMuPDF 1.26 empezó a escribir el aviso de obsolescencia de `fitz`
   en stdout, que es el canal del protocolo JSON. Con `import fitz` la salida
   del extractor deja de ser analizable y CUALQUIER PDF pasa por ilegible. */
test("stdout del extractor solo lleva JSON, sin avisos de la librería", { skip: hayPython ? false : "sin Python con PyMuPDF" }, () => {
  const salida = execFileSync(pythonBin(), [SCRIPT_EXTRACTOR, "--check"], { stdio: ["ignore", "pipe", "ignore"] }).toString();
  assert.doesNotThrow(() => JSON.parse(salida), `stdout contaminado: ${JSON.stringify(salida)}`);
  assert.equal(salida.trimStart()[0], "{", "no debe preceder nada al JSON");
});

test("comprobarExtractor informa del estado sin lanzar", { skip: hayPython ? false : "sin Python con PyMuPDF" }, async () => {
  const bueno = await comprobarExtractor();
  assert.equal(bueno.ok, true);
  assert.match(bueno.pymupdf, /^\d+\.\d+/);

  /* Sin intérprete el diagnóstico devuelve el motivo, no una excepción: el
     panel de administración necesita mostrarlo, no romperse. */
  const malo = await comprobarExtractor({ env: { PYTHON_BIN: "python-que-no-existe" } });
  assert.equal(malo.ok, false);
  assert.match(malo.motivo, /No se encontró el intérprete/);
});
