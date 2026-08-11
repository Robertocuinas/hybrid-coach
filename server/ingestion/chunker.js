/* Troceado por sección (docs/05-rag.md §3).

   Decisión de diseño, no detalle de implementación: se trocea por SECCIÓN del
   paper y no cada N caracteres. Cortar a ciegas parte frases y mezcla métodos
   con resultados, y la sección es señal aprovechable en el retrieval — una
   pregunta aplicada se responde en Discussion, la magnitud del efecto en
   Results, la aplicabilidad en Methods.

   Un chunk nunca cruza el límite de una sección: prefiero un chunk corto al
   final de Methods que uno que empieza en Methods y acaba en Results. */

export const OBJETIVO_MIN_TOKENS = 400;
export const OBJETIVO_MAX_TOKENS = 600;
export const SOLAPE = 0.15;

/* Aproximación deliberada: ~4 caracteres por token. Un tokenizador real es
   otra dependencia y aquí solo hace falta para agrupar párrafos dentro de un
   rango, no para facturar. El tamaño real de chunk se mide en la Fase 10 con
   el dataset de evaluación. */
export const contarTokens = (texto) => Math.ceil(String(texto || "").trim().length / 4);

/* Un párrafo más largo que el máximo no cabe en ningún chunk: se parte por
   frases. Sin esto, un bloque de método largo generaría un chunk gigante que
   diluye el embedding. */
function partirParrafoLargo(parrafo, maxTokens) {
  if (contarTokens(parrafo.texto) <= maxTokens) return [parrafo];

  const frases = parrafo.texto.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [parrafo.texto];
  const trozos = [];
  let actual = "";

  for (const frase of frases) {
    if (actual && contarTokens(actual + frase) > maxTokens) {
      trozos.push({ ...parrafo, texto: actual.trim() });
      actual = "";
    }
    actual += frase;
  }
  if (actual.trim()) trozos.push({ ...parrafo, texto: actual.trim() });
  return trozos;
}

/* El solape se toma en frases completas del final del chunk anterior, no
   cortando por carácter: así el fragmento repetido sigue siendo legible y
   citable si el retrieval lo devuelve. */
function colaParaSolape(texto, tokensSolape) {
  const frases = texto.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [];
  const cola = [];
  let tokens = 0;
  for (let i = frases.length - 1; i >= 0; i--) {
    const frase = frases[i];
    if (tokens && tokens + contarTokens(frase) > tokensSolape) break;
    cola.unshift(frase);
    tokens += contarTokens(frase);
    if (tokens >= tokensSolape) break;
  }
  return cola.join("").trim();
}

/**
 * @param parrafos  [{ texto, pagina, seccion }] tal como los devuelve pdf-extractor
 * @returns         [{ chunk_index, seccion, pagina_inicio, pagina_fin, texto, num_tokens }]
 */
export function trocear(parrafos, opciones = {}) {
  const min = opciones.minTokens ?? OBJETIVO_MIN_TOKENS;
  const max = opciones.maxTokens ?? OBJETIVO_MAX_TOKENS;
  const solape = opciones.solape ?? SOLAPE;

  const chunks = [];
  let indice = 0;

  for (const grupo of agruparPorSeccion(parrafos)) {
    let buffer = [];             // párrafos acumulados en el chunk en curso
    let textoPrevio = "";        // cola solapada que arrastra el chunk anterior
    let paginaInicio = null;
    let paginaFin = null;

    const cerrar = () => {
      if (!buffer.length) return;
      const cuerpo = buffer.join("\n\n").trim();
      const texto = textoPrevio ? `${textoPrevio}\n\n${cuerpo}` : cuerpo;
      if (!texto) return;
      chunks.push({
        chunk_index: indice++,
        seccion: grupo.seccion,
        pagina_inicio: paginaInicio,
        pagina_fin: paginaFin,
        texto,
        num_tokens: contarTokens(texto),
      });
      textoPrevio = solape > 0 ? colaParaSolape(cuerpo, Math.round(max * solape)) : "";
      buffer = [];
      paginaInicio = null;
      paginaFin = null;
    };

    for (const original of grupo.parrafos) {
      for (const parrafo of partirParrafoLargo(original, max)) {
        const acumulado = contarTokens([...buffer, parrafo.texto].join("\n\n"));
        /* Se cierra ANTES de meter el párrafo que desbordaría, no después:
           el chunk se mantiene por debajo del máximo salvo que un solo
           párrafo ya lo supere por sí mismo. */
        if (buffer.length && acumulado > max) cerrar();

        buffer.push(parrafo.texto);
        paginaInicio = paginaInicio === null ? parrafo.pagina : Math.min(paginaInicio, parrafo.pagina);
        paginaFin = paginaFin === null ? parrafo.pagina : Math.max(paginaFin, parrafo.pagina);

        if (contarTokens(buffer.join("\n\n")) >= min) cerrar();
      }
    }
    cerrar();   // resto de la sección, aunque no llegue al mínimo
  }

  return chunks;
}

/* Los párrafos vienen en orden de lectura; una sección puede reaparecer si el
   detector se confunde a mitad del paper, así que se agrupan por tramos
   consecutivos y no por nombre de sección. */
export function agruparPorSeccion(parrafos) {
  const grupos = [];
  for (const parrafo of parrafos) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.seccion === parrafo.seccion) ultimo.parrafos.push(parrafo);
    else grupos.push({ seccion: parrafo.seccion || "other", parrafos: [parrafo] });
  }
  return grupos;
}
