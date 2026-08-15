/* Ejecución en paralelo del sistema nuevo (RAG) y el anterior (selección
   léxica sobre fichas resumen) — Fase 8.

   Es la mitigación del riesgo principal de esta fase: que el retrieval nuevo
   sea PEOR que el léxico en algún caso concreto. Se compara lo que cada
   sistema recupera, no las respuestas del modelo: el retrieval es
   determinista y medible; dos respuestas de un LLM a la misma pregunta no son
   comparables entre sí de forma fiable.

   La regresión que importa: un documento que el sistema antiguo encontraba y
   el nuevo no ve en absoluto. */
import { pool } from "../../db/repositories/_helpers.js";
import { recuperar } from "../../rag/retrieval.js";
import { cargarContexto } from "../../db/repositories/coachContext.js";
import { contextoParaRetrieval } from "./context.js";

/* Preguntas de prueba: cubren los temas reales del dominio, incluyendo una
   sin respuesta posible en la biblioteca (control negativo) y varias con
   términos técnicos exactos, que es donde el léxico solía ganar. */
export const PREGUNTAS_COMPARACION = [
  "¿cuánto separar fuerza pesada de intervalos?",
  "¿por qué mi plan tiene una semana de descarga cada tres?",
  "¿cuánta proteína debería tomar al día?",
  "¿el entrenamiento de fuerza me hace más lento corriendo?",
  "me duele el sóleo al empezar a correr, ¿qué hago?",
  "¿cuánto debería bajar el volumen en el taper?",
  "¿sirve de algo la creatina para un corredor?",
  "¿cuántas series semanales necesito para no perder masa muscular?",
  "¿es fiable la puntuación de recuperación de mi reloj?",
  "¿qué dice la evidencia sobre la regla del 10% de progresión?",
  "¿debería correr en ayunas?",
  "¿cuándo tomar carbohidrato durante la tirada larga?",
  "¿qué evidencia hay sobre la prevención de lesiones con fuerza?",
  "¿cómo afecta dormir poco a mi entrenamiento?",
  "¿qué protector solar uso para correr en agosto?",
];

/* ---------- Sistema anterior: refsRelevantes() portado ----------
   Copia fiel de la puntuación léxica del cliente para que la comparación sea
   justa. No se "mejora" al portarla: se compara contra lo que había. */
const STOP = new Set("de la el los las y o en con para por un una unos unas del al que se su sus es son como más menos entre sobre tras cuando si no ni lo the of and in on for to a an is are with".split(" "));
const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ\s]/g, " ");
const tokens = (t) => norm(t).split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
const PESO_GRADO = { fuerte: 1.6, moderada: 1.25, debil: 0.85, practica: 0.6 };

export function refsRelevantesLexico(fichas, consulta, { max = 8, min = 3, umbral = 1 } = {}) {
  const qs = tokens(consulta);
  if (!fichas?.length) return [];
  if (!qs.length) {
    return [...fichas].sort((a, b) => (PESO_GRADO[b.evidence_grade] || 1) - (PESO_GRADO[a.evidence_grade] || 1)).slice(0, min);
  }

  const puntuada = fichas.map((r) => {
    const campos = [
      [r.tema_principal, 4], [(r.tags || []).join(" "), 4], [r.titulo, 2.5],
      [r.aplicacion_practica, 2.5], [r.resumen, 1.5], [r.fuente_revista, 1], [r.autores, 1], [r.poblacion, 0.8],
    ];
    let sc = 0;
    for (const [txt, peso] of campos) {
      const tk = new Set(tokens(txt));
      if (!tk.size) continue;
      for (const q of qs) {
        if (tk.has(q)) sc += peso;
        else if ([...tk].some((w) => w.startsWith(q.slice(0, 5)) || q.startsWith(w.slice(0, 5)))) sc += peso * 0.45;
      }
    }
    return { r, score: sc * (PESO_GRADO[r.evidence_grade] || 1) };
  }).sort((a, b) => b.score - a.score);

  const sel = puntuada.filter((x) => x.score >= umbral).slice(0, max).map((x) => x.r);
  if (sel.length >= min) return sel;
  const resto = puntuada.filter((x) => !sel.includes(x.r)).map((x) => x.r);
  return [...sel, ...resto.slice(0, min - sel.length).map((r) => ({ ...r, _relleno: true }))];
}

/* ---------- Comparación ---------- */

export async function compararSistemas(profileId, preguntas, deps) {
  const { db = pool, repo, embeddingProvider, rerankProvider, indice, config } = deps;
  const datos = await cargarContexto(profileId, { db });
  const contexto = contextoParaRetrieval(datos);

  /* Las fichas del sistema antiguo son las mismas filas de documents, con los
     campos resumen. Solo revisados, igual que el retrieval nuevo. */
  const { rows: fichas } = await db.query(
    `SELECT id, titulo, autores, anio, fuente_revista, tema_principal, tags, resumen,
            aplicacion_practica, poblacion, evidence_grade
       FROM documents d
      WHERE d.revisado = true
        AND EXISTS (SELECT 1 FROM document_chunks dc WHERE dc.document_id = d.id);`
  );

  const resultados = [];
  for (const pregunta of preguntas) {
    const nuevo = await recuperar(pregunta, { db, repo, embeddingProvider, rerankProvider, indice, config, contexto });
    const antiguo = refsRelevantesLexico(fichas, pregunta);

    const docsNuevo = new Set(nuevo.chunks.filter((c) => !c._relleno).map((c) => c.documentId));
    const docsAntiguo = new Set(antiguo.filter((r) => !r._relleno).map((r) => r.id));
    const perdidos = [...docsAntiguo].filter((id) => !docsNuevo.has(id));
    const ganados = [...docsNuevo].filter((id) => !docsAntiguo.has(id));
    const titulo = (id) => fichas.find((f) => f.id === id)?.titulo || id;

    resultados.push({
      pregunta,
      nuevo: {
        hayEvidencia: nuevo.hayEvidencia,
        fragmentos: nuevo.chunks.length,
        documentos: [...docsNuevo].map(titulo),
        /* Lo que el sistema antiguo NO podía dar: página y sección. */
        citasConPagina: nuevo.chunks.filter((c) => c.paginaInicio != null).length,
        motivo: nuevo.motivo || null,
      },
      antiguo: {
        documentos: [...docsAntiguo].map(titulo),
        relleno: antiguo.filter((r) => r._relleno).length,
      },
      /* Una "pérdida" no siempre es una regresión: el sistema antiguo rellenaba
         con lo que fuera y no tenía umbral. Se marca para revisar a mano. */
      posibleRegresion: perdidos.length > 0 && nuevo.hayEvidencia,
      documentosPerdidos: perdidos.map(titulo),
      documentosNuevos: ganados.map(titulo),
    });
  }

  const conRegresion = resultados.filter((r) => r.posibleRegresion);
  return {
    preguntas: resultados.length,
    posiblesRegresiones: conRegresion.length,
    sinEvidenciaEnNuevo: resultados.filter((r) => !r.nuevo.hayEvidencia).length,
    fragmentosConPagina: resultados.reduce((total, r) => total + r.nuevo.citasConPagina, 0),
    resultados,
  };
}
