/* ============================================================
   BÚSQUEDA Y SUSTITUCIÓN DE EJERCICIOS

   Punto de entrada del dominio: recibe un patrón o un ejercicio actual y
   devuelve candidatos reales del catálogo, ya filtrados por el equipamiento
   del atleta y ordenados por lo que mejor sirve al patrón.

   Nunca decide qué patrón toca. Eso viene dado.

   Si el catálogo externo no está configurado o falla, se devuelve una lista
   vacía con motivo, jamás una invención: quien llama mantiene la rutina que
   ya tenía (§59 del encargo).
   ============================================================ */
import { criteriosDe, ordenarCandidatos, PATRONES } from "./patrones.js";

const vacio = (motivo) => ({ candidatos: [], motivo, criterios: null });

/**
 * @param provider  ExerciseProvider o null
 * @param opciones  { patron, equipamiento, limite, excluir }
 */
export async function buscarPorPatron(provider, { patron, equipamiento, limite = 5, excluir = [] } = {}) {
  const criterios = criteriosDe(patron, equipamiento);
  if (!criterios) return vacio(`No conozco el patrón "${patron}".`);
  if (!provider) return vacio("El catálogo de ejercicios no está configurado en este servidor.");

  let brutos;
  try {
    /* Se pide por el músculo principal y se filtra en local: la API no siempre
       acepta varios músculos por consulta, y pedir de más sale más caro que
       descartar de más aquí. */
    brutos = await provider.buscar({
      musculo: criterios.musculos[0],
      bodyPart: criterios.bodyPart,
      limite: Math.max(limite * 4, 20),
    });
  } catch (error) {
    return vacio(`No se pudo consultar el catálogo: ${error.message}`);
  }

  const fuera = new Set(excluir.filter(Boolean).map((x) => String(x)));
  const candidatos = ordenarCandidatos(
    brutos.filter((e) => !fuera.has(e.externalId) && !fuera.has(e.canonico)),
    criterios,
    { limite },
  );

  return {
    candidatos,
    criterios,
    motivo: candidatos.length ? null : "El catálogo no tiene ejercicios que encajen con ese patrón y ese equipamiento.",
  };
}

/**
 * Alternativas a un ejercicio concreto: mismo patrón, distinto ejercicio.
 *
 * El patrón es obligatorio y viene del plan, no se deduce del nombre: adivinar
 * el patrón a partir de "Press banca" sería exactamente el tipo de inferencia
 * que convierte una sustitución en un ejercicio que no toca lo que debía.
 */
export async function alternativasA(provider, { patron, equipamiento, ejercicioActual, limite = 3, soloEquipo = null } = {}) {
  const excluir = [ejercicioActual?.externalId, ejercicioActual?.canonico].filter(Boolean);
  const resultado = await buscarPorPatron(provider, { patron, equipamiento, limite: limite * 3, excluir });
  if (!resultado.candidatos.length) return resultado;

  /* "Quiero uno con mancuernas" restringe sobre lo ya filtrado por nivel: no
     amplía el equipamiento disponible, solo elige dentro de él. */
  const filtrados = soloEquipo
    ? resultado.candidatos.filter((e) => String(e.equipamiento || "").toLowerCase().includes(String(soloEquipo).toLowerCase()))
    : resultado.candidatos;

  return {
    ...resultado,
    candidatos: filtrados.slice(0, limite),
    motivo: filtrados.length ? null : `No hay alternativas con ${soloEquipo} para ese patrón.`,
  };
}

/* Resumen legible para el Coach y la interfaz. El "por qué" es del patrón, no
   del catálogo: la evidencia la aporta el RAG, aquí solo se dice qué cumple. */
export function explicarCandidato(ejercicio, criterios) {
  const partes = [];
  if (ejercicio.target) partes.push(`principal ${ejercicio.target}`);
  if (ejercicio.equipamiento) partes.push(ejercicio.equipamiento);
  return `${ejercicio.nombre} — ${partes.join(" · ")}${criterios ? ` (patrón: ${criterios.etiqueta})` : ""}`;
}

export const patronesDisponibles = () =>
  Object.entries(PATRONES).map(([clave, d]) => ({ clave, etiqueta: d.etiqueta }));
