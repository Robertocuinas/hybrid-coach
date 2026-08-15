/* ============================================================
   CONTRATO DE PROVEEDORES DE EJERCICIOS

   Mismo patrón que server/ai/providers/types.js: una clase que documenta el
   contrato y una aserción que falla pronto. El dominio habla con esta forma,
   nunca con el JSON de un proveedor concreto (§44 del encargo).

   Un proveedor de ejercicios es un CATÁLOGO. No decide qué entrenar: eso lo
   deciden el planificador y el RAG a partir del patrón de movimiento. Aquí
   solo se responde a "qué ejercicios existen que cumplan estos requisitos".
   ============================================================ */

export class ExerciseProvider {
  /** @returns {Promise<Exercise[]>} */
  async buscar(_criterios) { throw new Error("ExerciseProvider.buscar() no implementado"); }
  /** @returns {Promise<Exercise|null>} */
  async obtener(_externalId) { throw new Error("ExerciseProvider.obtener() no implementado"); }
  capabilities() { throw new Error("ExerciseProvider.capabilities() no implementado"); }
}

export function assertExerciseProvider(provider) {
  if (!provider || typeof provider.buscar !== "function" || typeof provider.obtener !== "function"
      || typeof provider.capabilities !== "function") {
    throw new TypeError("El adaptador no cumple ExerciseProvider { buscar(), obtener(), capabilities() }");
  }
  const capabilities = provider.capabilities();
  for (const key of ["provider", "media", "filtroEquipamiento", "filtroMusculo"]) {
    if (!(key in capabilities)) throw new TypeError(`Falta capability de ejercicios: ${key}`);
  }
  return provider;
}

/* ---------- Normalización del nombre ----------

   Es la identidad interna de un ejercicio y la defensa contra el problema de
   §34: sin ella, "Press Banca", "press banca" y "Press de banca" son tres
   filas distintas con tres historiales de carga separados.

   Deliberadamente agresiva: quita acentos, puntuación y artículos sueltos.
   Un falso positivo (dos ejercicios distintos que colapsan) es más fácil de
   detectar y corregir que un historial partido en tres que nadie nota. */
const ACENTOS = { á: "a", à: "a", ä: "a", â: "a", ã: "a", é: "e", è: "e", ë: "e", ê: "e",
  í: "i", ì: "i", ï: "i", î: "i", ó: "o", ò: "o", ö: "o", ô: "o", õ: "o",
  ú: "u", ù: "u", ü: "u", û: "u", ñ: "n", ç: "c" };

export function nombreCanonico(nombre) {
  return String(nombre || "")
    .toLowerCase()
    .replace(/[áàäâãéèëêíìïîóòöôõúùüûñç]/g, (c) => ACENTOS[c] || c)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* ---------- Modelo interno ----------
   Los campos son los que devuelve ExerciseDB, pero con nombres nuestros: si
   mañana cambia de proveedor, cambia el adaptador y no el resto (§16, §35). */
export function normalizarEjercicio(bruto, { provider }) {
  const lista = (valor) => (Array.isArray(valor) ? valor.map((v) => String(v).trim()).filter(Boolean) : []);
  const primero = (valor) => lista(valor)[0] || null;
  const nombre = String(bruto?.name || "").trim();
  if (!nombre) return null;

  return {
    externalId: String(bruto.exerciseId || bruto.id || "").trim() || null,
    provider,
    nombre,
    canonico: nombreCanonico(nombre),
    /* ExerciseDB devuelve listas para lo que conceptualmente es uno solo
       (`targetMuscles`, `bodyParts`, `equipments`); se conserva el primero como
       principal y la lista completa donde aporta. */
    target: primero(bruto.targetMuscles),
    secundarios: lista(bruto.secondaryMuscles),
    bodyPart: primero(bruto.bodyParts),
    equipamiento: primero(bruto.equipments),
    equipamientos: lista(bruto.equipments),
    instrucciones: lista(bruto.instructions),
    /* Se guarda la referencia, no el binario: descargar los GIF sería copiar
       material de un proveedor sin necesidad (§39). */
    media: bruto.videoUrl || bruto.imageUrl || null,
  };
}
