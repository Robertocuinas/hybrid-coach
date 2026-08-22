import test from "node:test";
import assert from "node:assert/strict";
import {
  actualizarPerfil, consultarEntreno, ejecutarAccion, EJECUTORES,
  registrarEntreno, registrarRecuperacion, registrarSensaciones,
} from "./acciones.js";

const PLAN = {
  totalSemanas: 3,
  semanas: [
    { w: 1, inicio: "2026-08-10", fase: "carga" },
    { w: 2, inicio: "2026-08-17", fase: "carga" },
    { w: 3, inicio: "2026-08-24", fase: "descarga" },
  ],
};

/* Perfil mínimo con el mismo `update` inmutable que usa la aplicación: recibe
   un reductor, lo aplica sobre el estado y devuelve el resultado. */
function entorno(perfilExtra = {}) {
  const estado = {
    perfiles: {
      p1: {
        id: "p1", plan: PLAN, perfil: { distancia: "Media maratón", dias: [0, 2, 4] },
        weeks: { 1: { assign: [{ day: 0, code: "GYM A" }, { day: 3, code: "RUN B" }], done: ["GYM A"] } },
        recovery: [], checkins: [], running: [], strength: [], ...perfilExtra,
      },
    },
  };
  const deps = {
    hoy: "2026-08-13",
    update: (fn) => { fn(estado); },
    detalle: (w, code) => ({ titulo: code === "RUN B" ? "Rodaje medio" : "Fuerza A", dur: 40, desc: "descripción" }),
    semanaDe: () => 1,
  };
  return { estado, P: estado.perfiles.p1, deps };
}

/* ---------- Lectura ---------- */

test("consultar_entreno distingue sesión, descanso, semana sin programar y fuera de plan", () => {
  const { P, deps } = entorno();

  const jueves = consultarEntreno(P, { fecha: "2026-08-13" }, deps);
  assert.match(jueves.mensaje, /Rodaje medio/);
  assert.equal(jueves.resumen.code, "RUN B");
  assert.equal(jueves.resumen.hecha, false);

  const lunes = consultarEntreno(P, { fecha: "2026-08-10" }, deps);
  assert.match(lunes.mensaje, /ya registrado/, "GYM A está en done");

  assert.match(consultarEntreno(P, { fecha: "2026-08-11" }, deps).mensaje, /descanso/i);
  assert.match(consultarEntreno(P, { fecha: "2026-08-18" }, deps).mensaje, /no está programada/i);
  assert.match(consultarEntreno(P, { fecha: "2026-09-20" }, deps).mensaje, /fuera de tu plan/i);
});

/* Preguntar por un día sin sesión prevista pero CON entrenamiento registrado
   devolvía "descanso" o "fuera de tu plan" a secas, ignorando lo que el atleta
   había hecho. El plan recomienda; el registro es un hecho y se cuenta. */
test("consultar_entreno cuenta lo registrado aunque el plan no previera nada", () => {
  const { P, deps } = entorno({
    running: [
      { date: "2026-08-11", session_code: "LIBRE", duracion_min: 45 },
      { date: "2026-09-20", session_code: "RUN C", duracion_min: 30 },
    ],
    strength: [{ date: "2026-08-18", session: "GYM B", set: 1 }],
  });

  assert.match(consultarEntreno(P, { fecha: "2026-08-11" }, deps).mensaje, /Entrenamiento libre/,
    "día de descanso con registro");
  assert.match(consultarEntreno(P, { fecha: "2026-08-18" }, deps).mensaje, /Fuerza B/,
    "semana sin programar con registro");
  assert.match(consultarEntreno(P, { fecha: "2026-09-20" }, deps).mensaje, /Rodaje suave/,
    "fuera del plan con registro");
});

test("registrar_entreno anota una carrera cualquier día, esté planificado o no", () => {
  const { estado, P, deps } = entorno();
  /* Martes de la semana 1: el plan no propone nada ese día. */
  const r = registrarEntreno(P, { fecha: "2026-08-11", tipo: "run", codigo: "LIBRE", minutos: 45, km: 8 }, deps);

  assert.equal(r.ok, true);
  assert.match(r.mensaje, /Entrenamiento libre/);
  const guardado = estado.perfiles.p1.running;
  assert.equal(guardado.length, 1);
  assert.equal(guardado[0].date, "2026-08-11");
  assert.equal(guardado[0].session_code, "LIBRE");
  assert.equal(guardado[0].duracion_min, 45);
  assert.equal(guardado[0].semana, 1, "se guarda en la semana del plan que le corresponde");
  assert.equal(guardado[0].ritmo, "5:38", "el ritmo se calcula si hay distancia y tiempo");
  assert.ok(estado.perfiles.p1.weeks[1].done.includes("LIBRE"), "el día queda marcado como hecho");
});

test("registrar_entreno anota fuerza sin inventar series que el atleta no ha dicho", () => {
  const { estado, P, deps } = entorno();
  const r = registrarEntreno(P, { fecha: "2026-08-12", tipo: "gym", codigo: "GYM B", minutos: 50 }, deps);

  assert.equal(r.ok, true);
  const filas = estado.perfiles.p1.strength;
  assert.equal(filas.length, 1);
  assert.equal(filas[0].session, "GYM B");
  assert.equal(filas[0].weight, 0, "no se inventa un peso");
  assert.equal(filas[0].reps, 0, "ni unas repeticiones");
  assert.match(filas[0].notes, /sin detalle/i, "y queda dicho que el detalle no está");
});

test("registrar_entreno funciona en una semana que ni siquiera está programada", () => {
  const { estado, P, deps } = entorno();
  registrarEntreno(P, { fecha: "2026-08-19", tipo: "run", codigo: "RUN C", minutos: 30 }, deps);

  assert.equal(estado.perfiles.p1.running[0].semana, 2);
  assert.deepEqual(estado.perfiles.p1.weeks[2].assign, [], "se crea la semana vacía, sin inventar plan");
  assert.deepEqual(estado.perfiles.p1.weeks[2].done, ["RUN C"]);
});

/* ---------- Escritura ---------- */

test("registrar_recuperacion escribe en el estado del cliente, que es la fuente de la verdad", () => {
  const { estado, P, deps } = entorno();
  const r = registrarRecuperacion(P, { fecha: "2026-08-13", sueno: 7, fatiga: 4 }, deps);

  assert.equal(r.ok, true);
  assert.match(r.mensaje, /7 h de sueño/);
  assert.deepEqual(estado.perfiles.p1.recovery, [{ date: "2026-08-13", sueno: 7, fatiga: 4 }]);
});

/* Dos registros del mismo día se fusionan: si no, el historial acumularía
   filas duplicadas del mismo día y la analítica las contaría dos veces. */
test("registrar dos veces el mismo día fusiona en vez de duplicar", () => {
  const { estado, P, deps } = entorno();
  registrarRecuperacion(P, { fecha: "2026-08-13", sueno: 7 }, deps);
  registrarRecuperacion(P, { fecha: "2026-08-13", fatiga: 6 }, deps);

  assert.equal(estado.perfiles.p1.recovery.length, 1);
  assert.deepEqual(estado.perfiles.p1.recovery[0], { date: "2026-08-13", sueno: 7, fatiga: 6 });
});

test("registrar_sensaciones guarda la semana del plan que corresponde a esa fecha", () => {
  const { estado, P, deps } = entorno();
  registrarSensaciones(P, { fecha: "2026-08-18", rpe: 6, dolor: 2 }, deps);

  const fila = estado.perfiles.p1.checkins[0];
  assert.equal(fila.semana, 2, "el 18 de agosto cae en la semana 2");
  assert.equal(fila.rpe, 6);
  assert.equal(fila.dolor, 2);
});

test("actualizar_perfil solo toca los campos recibidos", () => {
  const { estado, P, deps } = entorno();
  actualizarPerfil(P, { campos: { dias: [0, 2, 4, 6] } }, deps);

  assert.deepEqual(estado.perfiles.p1.perfil.dias, [0, 2, 4, 6]);
  assert.equal(estado.perfiles.p1.perfil.distancia, "Media maratón", "lo que no se envía no se pierde");
});

/* ---------- Reparto con el planificador ---------- */

/* La programación semanal la posee el planificador IA + RAG. Que su ejecutor
   no viva aquí es lo que evita las dos lógicas de planificación. */
test("el ejecutor del cliente no sabe generar ni editar semanas por su cuenta", () => {
  const nombres = Object.keys(EJECUTORES);
  assert.ok(!nombres.includes("mover_sesion"));
  assert.ok(!nombres.includes("quitar_sesion"));
  assert.ok(!nombres.includes("aplicar_semana"));
  assert.ok(nombres.includes("generar_semana"), "existe, pero delega en planningApi");
});

/* ---------- Despacho ---------- */

test("una acción desconocida devuelve un fallo, no una excepción", async () => {
  const { P, deps } = entorno();
  const r = await ejecutarAccion({ accion: "hacer_café", parametros: {} }, P, deps);
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /No sé ejecutar/);
});

/* Que el ejecutor reviente no puede tumbar la conversación entera: el fallo
   se devuelve como resultado y el chat sigue. */
test("un fallo dentro del ejecutor se devuelve como resultado", async () => {
  const { P } = entorno();
  const depsRotas = { hoy: "2026-08-13", update: () => { throw new Error("almacenamiento lleno"); } };
  const r = await ejecutarAccion({ accion: "registrar_recuperacion", parametros: { fecha: "2026-08-13", sueno: 7 } }, P, depsRotas);

  assert.equal(r.ok, false);
  assert.match(r.mensaje, /almacenamiento lleno/);
});

test("ejecutarAccion resuelve las acciones síncronas del cliente", async () => {
  const { estado, P, deps } = entorno();
  const r = await ejecutarAccion({ accion: "registrar_sensaciones", parametros: { fecha: "2026-08-13", rpe: 8 } }, P, deps);

  assert.equal(r.ok, true);
  assert.equal(estado.perfiles.p1.checkins[0].rpe, 8);
});
