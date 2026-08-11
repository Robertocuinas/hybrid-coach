/* Ampliación de consulta (docs/05-rag.md §6).

   Mismo patrón que `consultaAmpliada` en buildContext() del cliente: un "me
   duele el gemelo" suelto recupera poco; ampliado con "media maratón, fase de
   construcción, historial de sóleo y Aquiles recurrente" recupera lo que hace
   falta. Aquí se hace en servidor y se produce UNA consulta por componente,
   porque el vectorial y el léxico necesitan cosas distintas. */
import { terminosIngleses } from "./diccionario-es-en.js";

const limpio = (valor) => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

function contextoDelAtleta(contexto = {}) {
  const lesiones = (contexto.lesiones || [])
    .map((l) => [limpio(l.zona), l.recurrente ? "(recurrente)" : null].filter(Boolean).join(" "))
    .filter(Boolean);
  const molestias = (contexto.molestias || [])
    .map((m) => [limpio(m.zona), m.intensidad != null ? `${m.intensidad}/10` : null].filter(Boolean).join(" "))
    .filter(Boolean);

  return [
    limpio(contexto.distanciaObjetivo),
    limpio(contexto.fase),
    lesiones.length ? `historial: ${lesiones.join(", ")}` : null,
    molestias.length ? `molestias: ${molestias.join(", ")}` : null,
    limpio(contexto.prioridad),
  ].filter(Boolean);
}

/* Siglas, nombres propios y cifras: justo donde la coincidencia léxica es más
   fiable que la semántica (docs/05-rag.md §5). "ACWR", "RIR", "VO2max",
   "Bosquet", "2015" se buscan tal cual; el resto lo cubre el vectorial. */
function terminosLiterales(consulta) {
  const encontrados = new Set();
  for (const token of String(consulta || "").split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 2) continue;
    const tieneMayuscula = /\p{Lu}/u.test(token.slice(1)) || /^\p{Lu}/u.test(token);
    const tieneDigito = /\p{N}/u.test(token);
    if (tieneMayuscula || tieneDigito) encontrados.add(token);
  }
  return [...encontrados];
}

/* La primera palabra de una frase va en mayúscula por ortografía, no por ser
   una sigla: se descarta para no meter ruido en el componente léxico. */
function sinPrimeraPalabra(consulta, terminos) {
  /* filter(Boolean): una consulta que empieza por "¿" produce un primer token
     vacío, y entonces la palabra inicial real se colaría como si fuera sigla. */
  const primera = String(consulta || "").trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean)[0];
  return terminos.filter((t) => t !== primera || /\p{N}/u.test(t) || t === t.toUpperCase());
}

/**
 * @param consulta  lo que pregunta el atleta, en español
 * @param contexto  { distanciaObjetivo, fase, lesiones[], molestias[], prioridad }
 * @returns { original, paraEmbedding, paraLexico, terminosEN, terminosLiterales, contexto }
 */
export function ampliarConsulta(consulta, contexto = {}) {
  const original = String(consulta || "").trim();
  const partes = contextoDelAtleta(contexto);
  const terminosEN = terminosIngleses([original, ...partes].join(" "));
  const literales = sinPrimeraPalabra(original, terminosLiterales(original));

  /* El vectorial recibe lenguaje natural: es cross-lingual, así que se le da
     la consulta en español CON el contexto y además los términos ingleses,
     que acercan el vector al vocabulario real del corpus. */
  const paraEmbedding = [original, ...partes, ...terminosEN].filter(Boolean).join(". ");

  /* El léxico recibe términos, no una frase. Y unidos por OR: con AND (que es
     lo que hacen plainto_/websearch_to_tsquery por defecto con palabras
     sueltas) una consulta de seis palabras no encontraría nunca nada. */
  const paraLexico = [...new Set([...terminosEN, ...literales])].join(" OR ");

  return {
    original,
    paraEmbedding: paraEmbedding || original,
    paraLexico,
    terminosEN,
    terminosLiterales: literales,
    contexto: partes,
  };
}
