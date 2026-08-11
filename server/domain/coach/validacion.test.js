import test from "node:test";
import assert from "node:assert/strict";
import { validarPropuesta, extraerCambio } from "./validacion.js";
import { formatearEvidencia } from "./prompt.js";

const CHUNK_A = {
  id: "11111111-1111-4111-8111-111111111111", titulo: "Concurrent training meta-analysis",
  autores: "Wilson, J. M. y cols.", anio: 2012, seccion: "discussion", paginaInicio: 4, paginaFin: 4,
  studyType: "meta_analysis", evidenceGrade: "fuerte", populationType: "runners", sampleSize: 24,
  texto: "Heavy strength work should be separated from interval sessions.",
  documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fuente: "Sports Medicine", doi: "10.1000/test",
  poblacion: "Corredores entrenados", origen: "pdf", storageKey: "documents/aa/test.pdf", scoreType: "coseno",
  scores: { umbral: 0.82, similitudCoseno: 0.82 },
};
const CHUNK_B = {
  id: "22222222-2222-4222-8222-222222222222", titulo: "Tapering meta-analysis",
  autores: "Bosquet, L. y cols.", anio: 2007, seccion: "conclusion", paginaInicio: 8, paginaFin: 9,
  evidenceGrade: "fuerte", texto: "Reducing volume 41-60% maximises performance.",
  scores: { umbral: 0.61, similitudCoseno: 0.61 }, _relleno: true,
};
const ENTREGADOS = [CHUNK_A, CHUNK_B];

test("una cita a un fragmento que no se entregó se descarta y se avisa", () => {
  const salida = validarPropuesta({
    decisiones: [{
      t: "Separar fuerza de series", p: "Justificación", confianza: "alta",
      refs: [CHUNK_A.id, "99999999-9999-4999-8999-999999999999", "b5"],
    }],
  }, { entregados: ENTREGADOS });

  assert.deepEqual(salida.decisiones[0].refs, [CHUNK_A.id], "solo sobrevive el fragmento entregado");
  assert.equal(salida.avisos.filter((a) => a.startsWith("Cita descartada")).length, 2);
  assert.equal(salida.decisiones[0].sinRespaldo, false);
});

test("un fragmento real pero NO entregado en el prompt también se descarta", () => {
  /* Es la diferencia entre validar contra la base de datos y validar contra lo
     que el modelo pudo ver: citar algo que nunca se le enseñó es inventar. */
  const salida = validarPropuesta({
    decisiones: [{ t: "T", p: "P", refs: [CHUNK_B.id] }],
  }, { entregados: [CHUNK_A] });
  assert.deepEqual(salida.decisiones[0].refs, []);
  assert.equal(salida.decisiones[0].sinRespaldo, true, "sin citas válidas queda marcada como sin respaldo");
});

test("las citas conservan página, sección y rank para poder comprobarlas", () => {
  const salida = validarPropuesta({
    decisiones: [{ t: "T", p: "P", refs: [CHUNK_B.id, CHUNK_A.id] }],
  }, { entregados: ENTREGADOS });

  const [primera, segunda] = salida.decisiones[0].citas;
  assert.equal(primera.chunkId, CHUNK_B.id);
  assert.equal(primera.rank, 1, "el rank sale del orden en que cita el modelo");
  assert.equal(primera.paginaInicio, 8);
  assert.equal(primera.relleno, true);
  assert.equal(segunda.similarityScore, 0.82);
  assert.equal(segunda.scoreType, "coseno");
  assert.equal(segunda.texto, CHUNK_A.texto);
  assert.equal(segunda.doi, CHUNK_A.doi);
  assert.equal(segunda.hasPdf, true);
  assert.equal(segunda.poblacion, "Corredores entrenados");
});

test("una propuesta que invade la estructura se marca pero no se descarta", () => {
  const salida = validarPropuesta({
    decisiones: [{ t: "Subir el techo de la tirada larga", p: "Podrías ampliar el techo a 150 min", refs: [] }],
  }, { entregados: ENTREGADOS });

  assert.equal(salida.decisiones[0].invade, true);
  assert.match(salida.avisos.join(" "), /estructura de seguridad/);
  assert.equal(salida.decisiones.length, 1, "se muestra como texto, no se borra");
});

test("un ajuste sobre un campo no permitido se rechaza", () => {
  const salida = validarPropuesta({
    decisiones: [{ t: "T", p: "P", refs: [] }],
    ajustes: [
      { campo: "rir", valor: "subir a 3", motivo: "fatiga" },
      { campo: "techo", valor: "150 min", motivo: "se ve capaz" },
    ],
  }, { entregados: ENTREGADOS });

  assert.equal(salida.ajustes.length, 1);
  assert.equal(salida.ajustes[0].campo, "rir");
  assert.match(salida.avisos.join(" "), /Ajuste rechazado: "techo"/);
});

test("evidencia_mixta valida las citas de cada posición por separado", () => {
  const salida = validarPropuesta({
    decisiones: [{ t: "T", p: "P", refs: [CHUNK_A.id] }],
    evidencia_mixta: [{
      tema: "Volumen óptimo",
      posiciones: [
        { resumen: "Más volumen mejora", refs: [CHUNK_A.id] },
        { resumen: "No hay diferencia", refs: ["inventado-9999"] },
      ],
    }],
  }, { entregados: ENTREGADOS });

  assert.equal(salida.evidenciaMixta.length, 1);
  assert.deepEqual(salida.evidenciaMixta[0].posiciones[0].refs, [CHUNK_A.id]);
  assert.equal(salida.evidenciaMixta[0].posiciones[0].citas[0].texto, CHUNK_A.texto);
  assert.deepEqual(salida.evidenciaMixta[0].posiciones[1].refs, [], "la cita inventada cae también aquí");
  assert.equal(salida.evidenciaMixta[0].posiciones[1].sinRespaldo, true);
});

test("evidencia_mixta con posiciones en texto plano se normaliza al formato estructurado", () => {
  const salida = validarPropuesta({
    decisiones: [{ t: "T", p: "P", refs: [] }],
    evidencia_mixta: [{ tema: "Volumen", posiciones: "Uno dice A, otro dice B", refs: [CHUNK_A.id] }],
  }, { entregados: ENTREGADOS });

  assert.equal(salida.evidenciaMixta[0].posiciones.length, 1);
  assert.deepEqual(salida.evidenciaMixta[0].posiciones[0].refs, [CHUNK_A.id]);
});

test("sin decisiones utilizables se avisa de que se mantienen las deterministas", () => {
  const salida = validarPropuesta({ decisiones: [] }, { entregados: ENTREGADOS });
  assert.match(salida.avisos.join(" "), /Se mantienen las deterministas/);
});

test("el bloque <<CAMBIO>> se extrae y se valida el tipo", () => {
  const bueno = extraerCambio('Te propongo esto.\n<<CAMBIO>>{"tipo":"mover","dia":"jueves","de":"RUN B","a":"RUN C","motivo":"fatiga"}<<FIN>>');
  assert.equal(bueno.texto, "Te propongo esto.");
  assert.equal(bueno.cambio.tipo, "mover");
  assert.equal(bueno.cambio.dia, "jueves");

  const malo = extraerCambio('Texto.\n<<CAMBIO>>{"tipo":"borrar_plan"}<<FIN>>');
  assert.equal(malo.cambio, null);
  assert.match(malo.avisos.join(" "), /tipo "borrar_plan" no permitido/);

  const roto = extraerCambio("Texto.\n<<CAMBIO>>{no es json}<<FIN>>");
  assert.equal(roto.cambio, null);
  assert.match(roto.avisos.join(" "), /no era JSON válido/);

  assert.equal(extraerCambio("Sin cambios propuestos.").cambio, null);
});

test("la evidencia se formatea con id, página y sección citables", () => {
  const texto = formatearEvidencia(ENTREGADOS);
  assert.ok(texto.includes(`[id:${CHUNK_A.id}]`), "el id debe ir completo: es lo que se valida después");
  assert.ok(texto.includes("pág. 4"));
  assert.ok(texto.includes("sección discussion"));
  assert.ok(texto.includes("evidencia fuerte"));
  assert.ok(texto.includes("pág. 8-9"), "un fragmento a caballo entre dos páginas muestra el rango");
  assert.ok(texto.includes("SIN RELACIÓN DIRECTA CON LA CONSULTA"), "el relleno va marcado en el prompt");
});
