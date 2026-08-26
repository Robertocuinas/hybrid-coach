/* Adaptador de Workout Guide (github.com/bryllim/workout-guide).

   A diferencia de ExerciseDB, es un CATÁLOGO LOCAL empaquetado como npm
   (@bryllim/workout-guide): 302 ejercicios, 906 figuras PNG 512×512, 3 frames
   por ejercicio. No necesita clave ni red; se usa para ILUSTRAR los ejercicios
   del catálogo propio (PAT) y las alternativas del coach.

   Licencia: código MIT; ASSETS bajo CC BY-SA 4.0 derivados de Everkinetic. Por
   eso la atribución es OBLIGATORIA y la UI la muestra donde aparecen figuras.

   Cumple el contrato ExerciseProvider (buscar/obtener/capabilities) del
   types.js, igual que exercisedb.js. El modelo interno normalizado es el mismo,
   así que el dominio no nota de qué proveedor viene la figura. La única pieza
   específica es la traducción de vocabulario: Workout Guide nombra los músculos
   en inglés ("Chest", "Quads") y el catálogo propio del cliente los pide en el
   vocabulario de ExerciseDB ("pectorals", "quads"); y su filtro de búsqueda por
   equipamiento es sensible a mayúsculas. Esas tablas viven aquí, no en
   patrones.js, para no acoplar el dominio a este proveedor concreto. */
import { ExerciseProvider, normalizarEjercicio } from "./types.js";
import {
  getExercise, searchExercises, getAssetUrl, normalizeSearchText,
} from "@bryllim/workout-guide";

/* Ruta same-origin donde server.js sirve los PNG de node_modules. La figura se
   referencia por slug+frame; getAssetUrl apuntaría a jsDelivr (CDN), pero servir
   desde la propia app evita depender de un tercero en caliente y respeta la CSP. */
export const RUTA_ASSETS = "/assets/ejercicios";

/* Workout Guide (inglés, title-case) -> vocabulario interno del catálogo
   (ExerciseDB-style, minúsculas). Solo los músculos que el catálogo propio
   entiende; lo que no mapea se queda en null y el dominio lo ignora (mejor que
   inventar un músculo). */
const MUSCULO_A_INTERNO = Object.freeze({
  chest: "pectorals", back: "upper back", lats: "lats", "upper back": "upper back",
  shoulders: "delts", "rear delts": "delts", biceps: "biceps", triceps: "triceps",
  forearms: "forearms", core: "abs", abs: "abs",
  quads: "quads", hamstrings: "hamstrings", glutes: "glutes", calves: "calves",
  "lower back": "lower back", hips: "glutes", adductors: "adductors", groin: "adductors",
  grip: null,
});

/* Interno -> grafía EXACTA que espera el filtro de búsqueda del paquete
   (sensible a mayúsculas). Sin mapeo, no enviamos filtro y deja pasar; el
   filtro local de patrones.js (compatible) descarta lo que el atleta no puede. */
const EQUIPO_A_PAQUETE = Object.freeze({
  "body weight": "Bodyweight",
  band: "Resistance Band", "resistance band": "Resistance Band",
  dumbbell: "Dumbbell", kettlebell: "Kettlebell", cable: "Cable",
  barbell: "Barbell", "ez barbell": "Barbell", "olympic barbell": "Barbell", "trap bar": "Barbell",
  "stability ball": "Stability Ball", "medicine ball": "Stability Ball",
  "leverage machine": "Machine", "smith machine": "Machine", machine: "Machine", bench: "Bench",
  plate: "Plate", "pull-up bar": "Pull-up Bar", doorway: "Doorway", wall: "Wall", box: "Box", chair: "Chair", towel: "Towel",
});

function equipamientoInterno(valor) {
  const limpio = String(valor || "").trim().toLowerCase();
  if (!limpio) return null;
  if (limpio === "bodyweight") return "body weight";
  return limpio;
}

function musculoInterno(valor) {
  const limpio = String(valor || "").trim().toLowerCase();
  return MUSCULO_A_INTERNO[limpio] ?? null;
}

function equipamientoPaquete(valor) {
  return EQUIPO_A_PAQUETE[String(valor || "").trim().toLowerCase()] ?? null;
}

function urlFigura(slug, frame = 1) {
  if (!slug) return null;
  return `${RUTA_ASSETS}/${String(slug).toLowerCase()}/frame-${frame}.png`;
}

/* Traduce un Exercise de Workout Guide a nuestro modelo interno. Reusa
   normalizarEjercicio para mantener un solo sitio de verdad del esquema. El
   modelo interno usa vocabulario en minúsculas para que el filtro local de
   patrones.js (compatible) lo entienda. */
export function mapearEjercicio(ejercicio) {
  if (!ejercicio || !ejercicio.name) return null;

  const equipamiento = equipamientoInterno(ejercicio.equipment);
  const target = musculoInterno(ejercicio.primaryMuscle);
  const secundarios = (ejercicio.secondaryMuscles || [])
    .map(musculoInterno)
    .filter(Boolean);

  return normalizarEjercicio(
    {
      exerciseId: ejercicio.slug,
      name: ejercicio.name,
      targetMuscles: target ? [target] : [],
      secondaryMuscles: secundarios,
      bodyParts: [String(ejercicio.primaryMuscle || "").toLowerCase()].filter(Boolean),
      equipments: equipamiento ? [equipamiento] : [],
      instructions: [],
      imageUrl: urlFigura(ejercicio.slug, 1),
    },
    { provider: "workoutguide" },
  );
}

export class WorkoutGuideProvider extends ExerciseProvider {
  capabilities() {
    return { provider: "workoutguide", media: true, filtroEquipamiento: true, filtroMusculo: true };
  }

  /* Workout Guide se consulta por texto libre + filtros opcionales (músculo,
     equipamiento). El dominio pide por músculo principal (criterios.musculos[0])
     y bodyPart; traducimos el músculo interno de vuelta al vocabulario del
     paquete para aprovechar su índice y el equipamiento a su grafía exacta. */
  async buscar({ musculo, equipamiento, bodyPart, texto, limite = 10 } = {}) {
    const INTERNO_A_MUSCULO = Object.fromEntries(
      Object.entries(MUSCULO_A_INTERNO).filter(([, v]) => v).map(([k, v]) => [v, k]),
    );
    const query = texto || INTERNO_A_MUSCULO[musculo] || bodyPart || "";
    const filtros = {};
    const eq = equipamientoPaquete(equipamiento);
    if (eq) filtros.equipment = eq;
    if (musculo && INTERNO_A_MUSCULO[musculo]) filtros.primaryMuscle = INTERNO_A_MUSCULO[musculo];

    const resultados = searchExercises(query ? normalizeSearchText(query) : "", filtros);
    return resultados
      .slice(0, Math.min(50, Math.max(1, limite)))
      .map(mapearEjercicio)
      .filter(Boolean);
  }

  async obtener(externalId) {
    if (!externalId) return null;
    const ejercicio = getExercise(String(externalId).toLowerCase());
    return ejercicio ? mapearEjercicio(ejercicio) : null;
  }
}

/* Reexportado por si se quiere componer una URL de figura fuera del adaptador
   (p.ej. tests o UI que ya tiene el slug). */
export { getAssetUrl };
