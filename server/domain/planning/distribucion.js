/* Reparto de sesiones en días de la semana.
 *
 * Los guardarraíles de agenda no son independientes entre sí: el tope de días
 * consecutivos, el descanso mínimo, la separación entre fuerza pesada y tirada
 * larga, la calidad después de pesada y las dos fuerzas seguidas se restringen
 * unos a otros. Con cuatro días disponibles y cuatro sesiones del plan maestro
 * el conjunto de repartos válidos llega a tener UN solo elemento, y a veces
 * ninguno sin retirar alguna sesión.
 *
 * Pedirle eso a un modelo de lenguaje era la causa del bucle: cada generación
 * fallaba en un guardarraíl distinto —HEAVY_BEFORE_LONG_RUN, luego
 * QUALITY_AFTER_HEAVY, luego MAX_STREAK— porque al arreglar uno rompía otro.
 * No es un problema de redacción del prompt: es una búsqueda combinatoria, y
 * eso lo hace el código exacto y en milisegundos.
 *
 * Encaja con el reparto del proyecto (CLAUDE.md §4.1): la estructura la decide
 * el motor determinista, el modelo adapta prescripción y justificación.
 *
 * Los predicados se importan de guardrails.js a propósito, en vez de
 * reescribirse: si el solucionador y el validador clasificaran distinto una
 * sesión, propondríamos repartos que el validador rechaza.
 */
import {
  DEFAULT_GUARDRAIL_CONFIG,
  codigo,
  esCalidad,
  esFuerza,
  esFuerzaPesada,
  esTirada,
} from "./guardrails.js";

const DIAS_SEMANA = 7;
/* Tope defensivo: la búsqueda es exponencial en el número de sesiones y una
   semana real nunca pasa de seis. Por encima se devuelve null y el prompt
   sigue sin sugerencia, que es degradar, no romper. */
const MAX_SESIONES = 8;

const clave = (s) => String(s?.session_key ?? s?.sessionKey ?? codigo(s) ?? "");

/* Qué se retira primero cuando no cabe todo. La tirada larga es el ancla de la
   semana en un plan de resistencia; la calidad, lo siguiente en valor. El
   trabajo de apoyo es lo que se sacrifica. */
export const prioridadSesion = (s) => (esTirada(s) ? 0 : esCalidad(s) ? 1 : esFuerza(s) ? 2 : 3);

function rachaMaxima(dias) {
  const orden = [...dias].sort((a, b) => a - b);
  let racha = orden.length ? 1 : 0, maxima = racha;
  for (let i = 1; i < orden.length; i++) {
    racha = orden[i] - orden[i - 1] === 1 ? racha + 1 : 1;
    maxima = Math.max(maxima, racha);
  }
  return maxima;
}

/* Mismas comprobaciones que evaluarGuardrailsPlan hace sobre fechas, aquí sobre
   índices de día. Dentro de una misma semana la diferencia entre índices y la
   diferencia entre fechas es la misma, así que no hay divergencia posible.
   `parcial` omite el descanso mínimo: durante la búsqueda aún faltan sesiones
   por colocar y ese límite solo se puede juzgar sobre el reparto completo. */
function repartoValido(reparto, cfg, { parcial = false } = {}) {
  const dias = reparto.map((r) => r.dia);
  if (new Set(dias).size !== dias.length) return false;
  if (rachaMaxima(dias) > cfg.maxConsecutiveTrainingDays) return false;
  if (!parcial && DIAS_SEMANA - dias.length < cfg.minRestDays) return false;

  const pesadas = reparto.filter((r) => esFuerzaPesada(r.sesion));
  const tiradas = reparto.filter((r) => esTirada(r.sesion));
  const calidades = reparto.filter((r) => esCalidad(r.sesion));

  for (const pesada of pesadas) {
    for (const tirada of tiradas) {
      const separacion = tirada.dia - pesada.dia;
      if (separacion > 0 && separacion < cfg.minHeavyBeforeLongRunDays) return false;
    }
    for (const calidad of calidades) if (calidad.dia - pesada.dia === 1) return false;
  }

  const fuerzas = reparto.filter((r) => esFuerza(r.sesion)).sort((a, b) => a.dia - b.dia);
  if (fuerzas.length <= 2) {
    for (let i = 1; i < fuerzas.length; i++) {
      if (Math.abs(fuerzas[i].dia - fuerzas[i - 1].dia) <= 1) return false;
    }
  }
  return true;
}

/** Backtracking con poda: las restricciones solo pueden empeorar al añadir una
 *  sesión más, así que una rama inválida no puede volverse válida. */
function buscarReparto(sesiones, dias, cfg) {
  const reparto = [];
  const usados = new Set();
  const paso = (i) => {
    if (i === sesiones.length) return repartoValido(reparto, cfg) ? reparto.map((r) => ({ ...r })) : null;
    for (const dia of dias) {
      if (usados.has(dia)) continue;
      reparto.push({ sesion: sesiones[i], dia });
      usados.add(dia);
      if (repartoValido(reparto, cfg, { parcial: true })) {
        const encontrado = paso(i + 1);
        if (encontrado) return encontrado;
      }
      reparto.pop();
      usados.delete(dia);
    }
    return null;
  };
  return paso(0);
}

/* Subconjuntos de tamaño `k`, ordenados por lo que más interesa conservar. */
function combinaciones(items, k) {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const salida = [];
  const paso = (inicio, actual) => {
    if (actual.length === k) { salida.push([...actual]); return; }
    for (let i = inicio; i < items.length; i++) {
      actual.push(items[i]);
      paso(i + 1, actual);
      actual.pop();
    }
  };
  paso(0, []);
  return salida;
}

/**
 * Reparte las sesiones en los días disponibles cumpliendo TODOS los límites
 * estructurales, retirando las de menor prioridad solo si no hay más remedio.
 *
 * @returns {null | { asignaciones, descartadas, completo }} null si no hay nada
 *   que repartir o si el problema es demasiado grande para resolverlo aquí.
 */
export function distribuirSesiones({ sesiones = [], diasDisponibles = [], config = {} } = {}) {
  const cfg = { ...DEFAULT_GUARDRAIL_CONFIG, ...config };
  const dias = [...new Set(diasDisponibles.filter((d) => Number.isInteger(d) && d >= 0 && d < DIAS_SEMANA))]
    .sort((a, b) => a - b);
  if (!sesiones.length || !dias.length || sesiones.length > MAX_SESIONES) return null;

  /* Conservar antes lo más valioso: se ordena por prioridad y se prueban
     primero los subconjuntos más grandes. El primero que encaja es el que más
     sesiones mantiene con el menor sacrificio. */
  const ordenadas = [...sesiones].sort((a, b) => prioridadSesion(a) - prioridadSesion(b));

  for (let cuantas = Math.min(ordenadas.length, dias.length); cuantas >= 1; cuantas--) {
    const candidatos = combinaciones(ordenadas, cuantas)
      .sort((a, b) => sumaPrioridad(a) - sumaPrioridad(b));
    for (const subconjunto of candidatos) {
      const encontrado = buscarReparto(subconjunto, dias, cfg);
      if (!encontrado) continue;
      const conservadas = new Set(subconjunto.map(clave));
      return {
        asignaciones: encontrado
          .map((r) => ({ session_key: clave(r.sesion), master_session_code: codigo(r.sesion) || null, day_of_week: r.dia }))
          .sort((a, b) => a.day_of_week - b.day_of_week),
        descartadas: sesiones.filter((s) => !conservadas.has(clave(s)))
          .map((s) => ({ session_key: clave(s), master_session_code: codigo(s) || null })),
        completo: conservadas.size === sesiones.length,
      };
    }
  }
  return { asignaciones: [], descartadas: sesiones.map((s) => ({ session_key: clave(s), master_session_code: codigo(s) || null })), completo: false };
}

const sumaPrioridad = (grupo) => grupo.reduce((total, s) => total + prioridadSesion(s), 0);
