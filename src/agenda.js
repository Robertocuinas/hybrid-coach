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
  const hecha = !!(asignada && (semana?.done || []).includes(asignada.code));
  return { ...wk, semana, code: asignada?.code || null, hecha, planificada: !!semana?.assign?.length };
}

/* Estado visible de un día. "Omitida" solo existe en el pasado: una sesión sin
   registrar de mañana está pendiente, no perdida. */
export function estadoDia(P, fecha, hoy) {
  const { code, hecha, fuera, planificada } = sesionDeFecha(P, fecha);
  if (fuera) return "fuera";
  if (!planificada) return "sinplan";
  if (!code) return "descanso";
  if (hecha) return "hecha";
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

/* Título corto de una conversación: lo primero que preguntó el usuario. */
export const tituloConversacion = (msgs) => {
  const primera = (msgs || []).find((m) => m.role === "user");
  return primera ? primera.content.slice(0, 60) : "Conversación vacía";
};
