/* ============================================================
   ACCIONES DEL COACH — catálogo, validación y extracción

   El modelo NO ejecuta nada. Propone una acción de una lista cerrada, el
   servidor valida sus parámetros contra un esquema, y quien la ejecuta es
   quien ya sabía hacerlo: el cliente, con las mismas funciones que usa la
   interfaz. Así no hay dos caminos de persistencia ni dos lógicas.

   Por qué un bloque <<ACCION>> y no tool calling nativo del proveedor: el
   formato de herramientas difiere entre Anthropic y OpenAI, y `LLMProvider`
   es neutro a propósito (docs/04-capa-ia.md). Un bloque delimitado funciona
   igual con cualquier proveedor y es el patrón que ya usa <<CAMBIO>>.

   Tres niveles, que responden a §15 y §16 del encargo:

     lectura       se resuelve y se responde, sin confirmar nada
     escritura     reservado; las escrituras actuales requieren confirmación
     confirmacion  cambia el plan: se propone y el usuario acepta o rechaza
   ============================================================ */

const texto = (valor, max) => {
  const limpio = String(valor ?? "").trim();
  return limpio ? limpio.slice(0, max) : null;
};
const entero = (valor, min, max) => {
  const n = Number.parseInt(valor, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const numero = (valor, min, max) => {
  const n = Number(valor);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fecha = (valor) => (FECHA.test(String(valor || "")) ? String(valor) : null);

/* Días de la semana como índice 0-6 (0 = lunes), que es como los guarda el
   plan. Se acepta el nombre porque es lo que escribe una persona. */
const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
export function diaAIndice(valor) {
  if (Number.isInteger(valor)) return valor >= 0 && valor <= 6 ? valor : null;
  const limpio = String(valor || "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
  const i = DIAS.indexOf(limpio);
  return i >= 0 ? i : null;
}

/* ---------- Catálogo ----------
   `parametros` es un validador, no un esquema declarativo: hay una docena de
   acciones y escribir un validador de JSON Schema completo para eso sería
   más código que el que valida. Devuelve { ok, valor } o { ok:false, motivo }. */
export const ACCIONES = Object.freeze({
  consultar_entreno: {
    ejecutor: "cliente",
    nivel: "lectura",
    descripcion: "Qué entrenamiento toca un día concreto.",
    ejemplo: '{ "fecha": "2026-08-14" }',
    parametros: (p) => {
      const f = fecha(p.fecha);
      return f ? { ok: true, valor: { fecha: f } } : { ok: false, motivo: "fecha debe ser AAAA-MM-DD" };
    },
  },

  registrar_recuperacion: {
    ejecutor: "cliente",
    nivel: "confirmacion",
    descripcion: "Anotar sueño, fatiga, estrés o motivación de un día.",
    ejemplo: '{ "fecha": "2026-08-14", "sueno": 7, "fatiga": 4 }',
    parametros: (p) => {
      const f = fecha(p.fecha);
      if (!f) return { ok: false, motivo: "fecha debe ser AAAA-MM-DD" };
      const valor = { fecha: f };
      /* Rangos idénticos a los del formulario de sensaciones: si la interfaz
         no deja registrar 20 horas de sueño, el coach tampoco. */
      const sueno = numero(p.sueno, 0, 24);
      const calidad = entero(p.calidad, 1, 5);
      const fatiga = entero(p.fatiga, 1, 10);
      const estres = entero(p.estres, 1, 10);
      const motivacion = entero(p.motivacion, 1, 5);
      if (sueno !== null) valor.sueno = sueno;
      if (calidad !== null) valor.calidad = calidad;
      if (fatiga !== null) valor.fatiga = fatiga;
      if (estres !== null) valor.estres = estres;
      if (motivacion !== null) valor.motivacion = motivacion;
      if (Object.keys(valor).length === 1) return { ok: false, motivo: "hay que registrar al menos un dato" };
      return { ok: true, valor };
    },
  },

  registrar_sensaciones: {
    ejecutor: "cliente",
    nivel: "confirmacion",
    descripcion: "Anotar cómo fue una sesión: RPE, dolor, energía y comentario.",
    ejemplo: '{ "fecha": "2026-08-14", "rpe": 6, "dolor": 2 }',
    parametros: (p) => {
      const f = fecha(p.fecha);
      if (!f) return { ok: false, motivo: "fecha debe ser AAAA-MM-DD" };
      const valor = { fecha: f };
      const rpe = entero(p.rpe, 1, 10);
      const dolor = entero(p.dolor, 0, 10);
      const energia = entero(p.energia, 1, 5);
      const comentario = texto(p.comentario, 300);
      if (rpe !== null) valor.rpe = rpe;
      if (dolor !== null) valor.dolor = dolor;
      if (energia !== null) valor.energia = energia;
      if (comentario) valor.comentario = comentario;
      if (Object.keys(valor).length === 1) return { ok: false, motivo: "hay que registrar al menos un dato" };
      return { ok: true, valor };
    },
  },

  actualizar_perfil: {
    ejecutor: "cliente",
    nivel: "confirmacion",
    descripcion: "Cambiar datos del perfil: objetivo, fecha de carrera, días habituales, equipamiento.",
    ejemplo: '{ "campos": { "dias": [0,2,4,6] } }',
    parametros: (p) => {
      const campos = p.campos && typeof p.campos === "object" ? p.campos : null;
      if (!campos) return { ok: false, motivo: "falta el objeto campos" };
      const valor = {};
      /* Lista blanca explícita. Un campo que no esté aquí no se toca, aunque
         el modelo lo proponga: es la misma frontera que CAMPOS_BLOQUEADOS. */
      const distancia = texto(campos.distancia, 40);
      const fechaCarrera = fecha(campos.fechaCarrera);
      const edad = entero(campos.edad, 12, 100);
      const peso = numero(campos.peso, 30, 250);
      const altura = entero(campos.altura, 120, 230);
      const equipamiento = texto(campos.equipamiento, 60);
      const expCarrera = texto(campos.expCarrera, 40);
      const expFuerza = texto(campos.expFuerza, 40);
      if (distancia) valor.distancia = distancia;
      if (fechaCarrera) valor.fechaCarrera = fechaCarrera;
      if (edad !== null) valor.edad = edad;
      if (peso !== null) valor.peso = peso;
      if (altura !== null) valor.altura = altura;
      if (equipamiento) valor.equipamiento = equipamiento;
      if (expCarrera) valor.expCarrera = expCarrera;
      if (expFuerza) valor.expFuerza = expFuerza;
      if (Array.isArray(campos.dias)) {
        const dias = [...new Set(campos.dias.map(diaAIndice).filter((d) => d !== null))].sort((a, b) => a - b);
        if (dias.length) valor.dias = dias;
      }
      if (!Object.keys(valor).length) return { ok: false, motivo: "ningún campo reconocido" };
      return { ok: true, valor: { campos: valor } };
    },
  },

  generar_semana: {
    ejecutor: "planificador",
    nivel: "confirmacion",
    descripcion: "Proponer la programación de una semana con los días disponibles indicados.",
    ejemplo: '{ "dias": ["martes","jueves","sabado"], "semana": 3 }',
    parametros: (p) => {
      const dias = Array.isArray(p.dias)
        ? [...new Set(p.dias.map(diaAIndice).filter((d) => d !== null))].sort((a, b) => a - b)
        : [];
      if (!dias.length) return { ok: false, motivo: "hacen falta los días disponibles" };
      const valor = { dias };
      const semana = entero(p.semana, 1, 52);
      if (semana !== null) valor.semana = semana;
      /* Estos dos van al motor tal cual: son los mismos que acepta
         generateWeek() desde la interfaz. */
      if (typeof p.gimnasio === "boolean") valor.gimnasio = p.gimnasio;
      if (typeof p.correr === "boolean") valor.correr = p.correr;
      const dolor = entero(p.dolor, 0, 10);
      const fatiga = entero(p.fatiga, 1, 10);
      if (dolor !== null) valor.dolor = dolor;
      if (fatiga !== null) valor.fatiga = fatiga;
      return { ok: true, valor };
    },
  },


});

export const NOMBRES_ACCION = Object.freeze(Object.keys(ACCIONES));

/* Nivel de una acción, con "confirmacion" como respuesta por defecto ante algo
   desconocido: si no sabemos qué es, no se aplica solo. */
export const nivelDe = (nombre) => ACCIONES[nombre]?.nivel || "confirmacion";

/**
 * Valida una acción propuesta por el modelo.
 * @returns { accion } | { accion: null, aviso }
 */
export function validarAccion(bruto) {
  if (!bruto || typeof bruto !== "object") return { accion: null, aviso: "Acción descartada: no era un objeto." };
  const nombre = String(bruto.accion || bruto.nombre || "").trim();
  const definicion = ACCIONES[nombre];
  if (!definicion) {
    return { accion: null, aviso: `Acción descartada: "${texto(nombre, 40) || "sin nombre"}" no está permitida.` };
  }
  const parametros = bruto.parametros && typeof bruto.parametros === "object" ? bruto.parametros : {};
  const comprobado = definicion.parametros(parametros);
  if (!comprobado.ok) {
    return { accion: null, aviso: `Acción "${nombre}" descartada: ${comprobado.motivo}.` };
  }
  return {
    accion: {
      accion: nombre,
      nivel: definicion.nivel,
      parametros: comprobado.valor,
      motivo: texto(bruto.motivo, 240),
    },
  };
}

/* Extrae el bloque <<ACCION>> de la respuesta. Mismo contrato que
   extraerCambio(): devuelve el texto ya limpio y los avisos de lo descartado. */
export function extraerAccion(respuesta) {
  const encontrado = String(respuesta || "").match(/<<ACCION>>([\s\S]*?)<<FIN>>/);
  if (!encontrado) return { texto: String(respuesta || "").trim(), accion: null, avisos: [] };

  const limpio = String(respuesta).replace(encontrado[0], "").trim();
  try {
    const { accion, aviso } = validarAccion(JSON.parse(encontrado[1].trim()));
    return { texto: limpio, accion, avisos: aviso ? [aviso] : [] };
  } catch {
    return { texto: limpio, accion: null, avisos: ["Acción descartada: el bloque <<ACCION>> no era JSON válido."] };
  }
}

/* Quién ejecuta cada acción. "planificador" significa que NO se resuelve aquí
   ni en el cliente: se delega en el planificador IA + RAG, que es el dueño de
   la programación semanal y tiene su propio contrato de propuesta y
   aceptación. Tenerla también aquí serían dos lógicas de planificación. */
export const ejecutorDe = (nombre) => ACCIONES[nombre]?.ejecutor || null;

/* Lo que se le enseña al modelo. Se genera del catálogo para que añadir una
   acción no exija acordarse de actualizar el prompt por separado.

   `planificador` filtra por ejecutor: mientras sus rutas no existan, sus
   acciones no se le ofrecen al modelo. Prometer "te preparo la semana" y
   fallar después es peor que decir desde el principio que aún no se puede. */
export function catalogoParaPrompt({ planificador = false } = {}) {
  return Object.entries(ACCIONES)
    .filter(([, d]) => d.ejecutor !== "planificador" || planificador)
    .map(([nombre, d]) => `- ${nombre} (${d.nivel}): ${d.descripcion}\n  ejemplo de parámetros: ${d.ejemplo}`)
    .join("\n");
}
