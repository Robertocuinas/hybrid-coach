/* ============================================================
   AGENDA — fechas, semanas y estado de cada día

   Vive fuera de HybridCoach.jsx por una razón práctica: es lógica pura y aquí
   se puede probar con `node --test`, cosa que no se puede hacer con un archivo
   JSX. Es el cimiento de Entrenar, el calendario mensual y la nutrición, así
   que un fallo silencioso aquí se nota en tres pantallas a la vez.

   No contiene ninguna regla de entrenamiento: solo traduce entre fechas y la
   estructura semana/día en la que el motor guarda el plan.
   ============================================================ */

/* Mediodía y no medianoche: evita que un cambio de horario o un desfase de
   zona horaria mueva la fecha un día al convertir a ISO. */
export const parse = (s) => new Date(s + "T12:00:00");
export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const DSHORT = ["L", "M", "X", "J", "V", "S", "D"];
export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export const esGym = (c) => String(c || "").startsWith("GYM");
export const colorOf = (c) => (esGym(c) ? "gym" : c === "RECOVERY" ? "rest" : "run");

/* Códigos de sesión que la aplicación entiende siempre, haya o no un plan
   generado. Registrar no depende de que el planificador haya pasado por ahí:
   el plan es una recomendación y el registro es un hecho.

   LIBRE es la vía de escape deliberada: cubre lo que no encaja en ninguna
   categoría —una pachanga, una clase, una caminata larga— y evita que el
   atleta tenga que mentir eligiendo un código que no hizo. */
export const CODIGOS_RUN = ["RUN A", "RUN B", "RUN C", "RUN D", "RECOVERY", "LIBRE"];
export const CODIGOS_GYM = ["GYM A", "GYM B", "GYM C", "GYM D"];

/* Etiquetas legibles. El código a secas ("RUN B") no dice nada a quien no se
   ha leído la nomenclatura del plan. */
export const NOMBRE_CODIGO = Object.freeze({
  "RUN A": "Tirada larga",
  "RUN B": "Calidad / series",
  "RUN C": "Rodaje suave",
  "RUN D": "Rodaje regenerativo",
  RECOVERY: "Movilidad / recuperación",
  LIBRE: "Entrenamiento libre",
  "GYM A": "Fuerza A",
  "GYM B": "Fuerza B",
  "GYM C": "Fuerza C",
  "GYM D": "Fuerza D",
});
export const etiquetaCodigo = (code) => NOMBRE_CODIGO[code] || code || "Sesión";

/* Lunes de la semana natural que contiene esa fecha. El plan empieza en lunes
   y el calendario mensual también, así que la conversión es siempre la misma. */
export function lunesDe(fecha) {
  const d = parse(fecha);
  const dow = (d.getDay() + 6) % 7;          // 0 = lunes
  return addDays(fecha, -dow);
}

/* Semana del plan y día 0-6 a los que corresponde una fecha. `fuera` marca
   tanto las fechas anteriores al arranque del plan como las posteriores a su
   última semana: en ambos casos no hay nada que entrenar. */
export function weekOf(plan, dateStr) {
  if (!plan) return { w: 1, dayIdx: 0, fuera: true };
  const first = plan.semanas[0].inicio;
  const diff = daysBetween(first, dateStr);
  if (diff < 0) return { w: 1, dayIdx: 0, fuera: true };
  const w = Math.floor(diff / 7) + 1;
  return { w: clamp(w, 1, plan.totalSemanas), dayIdx: ((diff % 7) + 7) % 7, fuera: w > plan.totalSemanas };
}

export const semanaPlan = (plan, w) => plan.semanas.find((s) => s.w === w) || plan.semanas[plan.semanas.length - 1];

/* El paso que necesita toda la interfaz nueva: dada una fecha, qué toca.
   El plan se guarda por número de semana y día, nunca por fecha. */
export function sesionDeFecha(P, fecha) {
  const wk = weekOf(P.plan, fecha);
  const semana = P.weeks?.[wk.w];
  const asignada = wk.fuera ? null : (semana?.assign || []).find((a) => a.day === wk.dayIdx) || null;
  const registros = registrosDeFecha(P, fecha);
  /* Una sesión está hecha si el plan la marcó como hecha O si hay un registro
     real de ese día. Antes solo contaba lo primero, y eso significaba que
     entrenar algo distinto a lo previsto dejaba el día marcado como "omitido"
     por mucho que estuviera registrado: la app llamaba fallo a haber
     entrenado. */
  const hecha = !!(asignada && (semana?.done || []).includes(asignada.code)) || registros.length > 0;
  return {
    ...wk,
    semana,
    code: asignada?.code || null,
    hecha,
    planificada: !!semana?.assign?.length,
    registros,
  };
}

/* Todo lo registrado en una fecha, mire o no el plan hacia ese día. Es la
   pieza que sostiene el registro libre: carreras y sesiones de fuerza se
   guardan con su fecha, así que se pueden recuperar sin pasar por la agenda
   del planificador. */
export function registrosDeFecha(P, fecha) {
  const carreras = (P?.running || [])
    .filter((r) => r.date === fecha)
    .map((r) => ({ tipo: "run", code: r.session_code || "LIBRE", ref: r }));
  /* Las series de fuerza se agrupan por sesión: cuatro series de sentadilla
     son UN registro de fuerza, no cuatro entradas en la lista del día. */
  const fuerza = [];
  for (const serie of (P?.strength || []).filter((r) => r.date === fecha)) {
    const code = serie.session || "GYM";
    const previo = fuerza.find((x) => x.code === code);
    if (previo) { previo.series.push(serie); continue; }
    fuerza.push({ tipo: "gym", code, series: [serie] });
  }
  return [...carreras, ...fuerza];
}

/* Estado visible de un día. "Omitida" solo existe en el pasado: una sesión sin
   registrar de mañana está pendiente, no perdida. */
export function estadoDia(P, fecha, hoy) {
  const { code, hecha, fuera, planificada, registros } = sesionDeFecha(P, fecha);
  /* Un registro real manda sobre cualquier otra consideración. Un día fuera
     del plan o sin semana generada en el que SÍ se entrenó no puede seguir
     mostrándose como vacío: eso es lo que hacía sentir que registrar algo no
     previsto no contaba. */
  if (registros.length && !code) return "libre";
  if (hecha && code) return "hecha";
  if (fuera) return "fuera";
  if (!planificada) return "sinplan";
  if (!code) return "descanso";
  return fecha < hoy ? "omitida" : "pendiente";
}

/* Tipo de día para la nutrición. No decide nada nutricional: solo clasifica lo
   que ya calculó el motor para que las recetas se puedan contextualizar. */
export function contextoDelDia(sesiones) {
  const reales = (sesiones || []).filter((x) => x.code !== "RECOVERY");
  if (!reales.length) return "descanso";
  const correr = reales.find((x) => !esGym(x.code));
  if (correr && (correr.dur || 0) >= 75) return "larga";
  if (reales.some((x) => x.intensidad === "calidad")) return "calidad";
  if (reales.some((x) => esGym(x.code))) return "fuerza";
  return "suave";
}

/* Última vez que se hizo un ejercicio dentro de una rutina concreta: peso de la
   serie más pesada y repeticiones de cada serie de aquel día. Es lo que precarga
   el formulario de fuerza y lo que se enseña como referencia.

   Se filtra por sesión porque el mismo ejercicio puede ir a cargas distintas
   según la rutina en la que aparezca. */
export function ultimaVezEjercicio(strength, ejercicio, sesion) {
  const previas = (strength || []).filter((r) => r.exercise === ejercicio && (!sesion || r.session === sesion));
  if (!previas.length) return null;
  const fecha = previas.reduce((max, r) => (r.date > max ? r.date : max), previas[0].date);
  const series = previas.filter((r) => r.date === fecha).sort((a, b) => a.set - b.set);
  if (!series.length) return null;
  return {
    fecha,
    peso: Math.max(...series.map((r) => +r.weight || 0)) || null,
    reps: series.map((r) => r.reps).filter(Boolean),
  };
}

/* Elección estable: el mismo día propone siempre lo mismo. Con Math.random()
   las recetas cambiarían al volver a la pestaña y parecerían un sorteo. */
export const eligeEstable = (lista, semilla) => (lista && lista.length ? lista[Math.abs(semilla) % lista.length] : null);

/* ============================================================
   REPARTO DE SESIONES EN DÍAS

   Búsqueda combinatoria pura: prueba todas las formas de colocar `sesiones`
   en `diasDisponibles` y devuelve la mejor según `puntuar`. No sabe NADA de
   entrenamiento —quién puntúa y con qué reglas es cosa de quien la llama—,
   así que las reglas R1-R9 del motor determinista siguen intactas donde
   estaban.

   Vive aquí, y no dentro del JSX, por lo mismo que el resto de este fichero:
   para poder probarla con `node --test`. Y hacía falta, porque tenía un fallo
   que solo se veía en un caso concreto y en silencio:

   la permutación se hacía sobre `diasDisponibles.slice(0, 6)` cuando había más
   de 6 sesiones, de modo que la rama de corte —`acc.length === sesiones.length`—
   no se alcanzaba NUNCA: con 7 sesiones y 7 días no quedaba ningún reparto
   candidato, `best` seguía a null y la semana se devolvía vacía. El atleta
   pulsaba "generar" y la aplicación le decía después que la semana no estaba
   programada, sin ningún error por medio.
   Un reparto de 7 sobre 7 son 5.040 combinaciones: se calculan de sobra. El
   tope era una defensa contra una explosión que no puede darse, porque una
   semana tiene siete días y nunca se colocan más sesiones que días hay.
   ============================================================ */
export function mejorReparto(sesiones, diasDisponibles, puntuar) {
  const dias = [...new Set(diasDisponibles)].sort((a, b) => a - b);
  if (!sesiones.length || !dias.length) return null;
  /* Nunca más sesiones que días: colocar dos el mismo día no es un reparto
     que esta agenda sepa representar. */
  const aColocar = sesiones.slice(0, Math.min(sesiones.length, dias.length));

  let mejor = null;
  const acc = [];
  const explorar = (restantes) => {
    if (acc.length === aColocar.length) {
      const puntuacion = puntuar(acc);
      if (!mejor || puntuacion.score > mejor.score) mejor = { assign: [...acc], ...puntuacion };
      return;
    }
    for (let i = 0; i < restantes.length; i++) {
      acc.push({ day: restantes[i], code: aColocar[acc.length] });
      explorar(restantes.filter((_, j) => j !== i));
      acc.pop();
    }
  };
  explorar(dias);
  return mejor;
}

/* Título corto de una conversación: lo primero que preguntó el usuario. */
export const tituloConversacion = (msgs) => {
  const primera = (msgs || []).find((m) => m.role === "user");
  return primera ? primera.content.slice(0, 60) : "Conversación vacía";
};
