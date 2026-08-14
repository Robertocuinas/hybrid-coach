/* ============================================================
   EJECUTOR DE ACCIONES DEL COACH

   El servidor decide y valida; aquí se ejecuta. Y se ejecuta llamando a las
   MISMAS funciones que usa la interfaz, no a copias.

   Reparto deliberado, para no duplicar la lógica de planificación:

     cliente        consultas y registros propios (sueño, sensaciones, perfil).
                    Entran en el estado del cliente y viajan por el sync.
     planificador   todo lo que toca la programación semanal. NO se ejecuta
                    aquí: se delega en src/planningApi.js, que es el mismo
                    camino que usa la pantalla de planificación.

   Por eso aquí no hay ningún `generateWeek()` ni escritura sobre `weeks`.

   Vive fuera del JSX para poder probarlo con `node --test`.
   ============================================================ */
import { sesionDeFecha, weekOf } from "./agenda.js";
import { createWeekProposal } from "./planningApi.js";

/* Resultado uniforme: { ok, mensaje, resumen? }. `resumen` es lo que se
   enseña en la tarjeta de la respuesta. */
const bien = (mensaje, resumen = null) => ({ ok: true, mensaje, resumen });
const mal = (mensaje) => ({ ok: false, mensaje });

/* ---------- Lectura ---------- */

export function consultarEntreno(P, { fecha }, { detalle }) {
  const dia = sesionDeFecha(P, fecha);
  if (dia.fuera) return bien("Esa fecha queda fuera de tu plan.");
  if (!dia.planificada) return bien(`La semana ${dia.w} todavía no está programada.`);
  if (!dia.code) return bien("Ese día tienes descanso.");
  const d = detalle(dia.w, dia.code);
  return bien(
    `${d?.titulo || dia.code}${d?.dur ? ` · ${d.dur} min` : ""}${dia.hecha ? " · ya registrado" : ""}`,
    { tipo: "sesion", fecha, code: dia.code, titulo: d?.titulo, dur: d?.dur, desc: d?.desc, hecha: dia.hecha },
  );
}

/* ---------- Escritura simple ---------- */

/* Mismo destino que el formulario de sensaciones: p.recovery. Se fusiona con
   el registro del día si ya existe, en vez de acumular filas duplicadas. */
export function registrarRecuperacion(P, params, { update }) {
  const { fecha, ...datos } = params;
  update((s) => {
    const p = s.perfiles[P.id];
    const i = (p.recovery || []).findIndex((r) => r.date === fecha);
    const fila = { date: fecha, ...(i >= 0 ? p.recovery[i] : {}), ...datos };
    if (i >= 0) p.recovery[i] = fila; else (p.recovery = p.recovery || []).push(fila);
    return s;
  });
  const partes = [];
  if (datos.sueno !== undefined) partes.push(`${datos.sueno} h de sueño`);
  if (datos.fatiga !== undefined) partes.push(`fatiga ${datos.fatiga}/10`);
  if (datos.estres !== undefined) partes.push(`estrés ${datos.estres}/10`);
  if (datos.calidad !== undefined) partes.push(`calidad ${datos.calidad}/5`);
  if (datos.motivacion !== undefined) partes.push(`motivación ${datos.motivacion}/5`);
  return bien(`✓ Anotado para el ${fecha}: ${partes.join(", ")}.`);
}

export function registrarSensaciones(P, params, { update }) {
  const { fecha, ...datos } = params;
  const wk = weekOf(P.plan, fecha);
  update((s) => {
    const p = s.perfiles[P.id];
    const i = (p.checkins || []).findIndex((c) => c.date === fecha);
    const fila = { date: fecha, semana: wk.w, ...(i >= 0 ? p.checkins[i] : {}), ...datos };
    if (i >= 0) p.checkins[i] = fila; else (p.checkins = p.checkins || []).push(fila);
    return s;
  });
  const partes = [];
  if (datos.rpe !== undefined) partes.push(`RPE ${datos.rpe}/10`);
  if (datos.dolor !== undefined) partes.push(`dolor ${datos.dolor}/10`);
  if (datos.energia !== undefined) partes.push(`energía ${datos.energia}/5`);
  return bien(`✓ Anotado para el ${fecha}${partes.length ? ": " + partes.join(", ") : ""}.`);
}

/* ---------- Cambios que exigen confirmación ---------- */

export function actualizarPerfil(P, { campos }, { update }) {
  update((s) => { Object.assign(s.perfiles[P.id].perfil, campos); return s; });
  return bien("✓ Perfil actualizado.");
}

/* ---------- Delegación en el planificador ----------
   No genera nada: pide la propuesta al planificador IA + RAG por la MISMA vía
   que la pantalla de planificación. La propuesta llega con su id, su resumen,
   su estado de evidencia y sus citas, y se acepta o rechaza con
   acceptPlanningProposal(), igual que desde la interfaz. */
export async function proponerSemana(P, params, { semanaDe }) {
  const semana = params.semana || semanaDe(params.hoy);
  const propuesta = await createWeekProposal(semana, {
    availableDays: params.dias,
    gym: params.gimnasio !== false,
    run: params.correr !== false,
    pain: params.dolor ?? null,
    fatigue: params.fatiga ?? null,
  });
  return bien(propuesta.summary, { tipo: "propuesta-semana", semana, propuesta });
}


/* ---------- Despacho ----------
   `deps` trae las funciones de la interfaz (update, generar, detalle) para que
   este módulo no importe nada del JSX y siga siendo probable. */
export const EJECUTORES = {
  consultar_entreno: consultarEntreno,
  registrar_recuperacion: registrarRecuperacion,
  registrar_sensaciones: registrarSensaciones,
  actualizar_perfil: actualizarPerfil,
  generar_semana: proponerSemana,
};

/* Async porque delegar en el planificador es una llamada de red. Un fallo se
   devuelve como resultado, nunca se propaga: que el planificador esté caído no
   puede tumbar la conversación entera. */
export async function ejecutarAccion(accion, P, deps) {
  const fn = EJECUTORES[accion?.accion];
  if (!fn) return mal(`No sé ejecutar "${accion?.accion}".`);
  try { return await fn(P, { ...accion.parametros, hoy: deps.hoy }, deps); }
  catch (e) { return mal(`No se pudo completar: ${e.message}`); }
}
