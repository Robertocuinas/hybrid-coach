import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays, contextoDelDia, daysBetween, eligeEstable, estadoDia, etiquetaCodigo, iso, lunesDe,
  mejorReparto, registrosDeFecha, sesionDeFecha, tituloConversacion, ultimaVezEjercicio, weekOf,
} from "./agenda.js";

/* Plan de 3 semanas que arranca el lunes 2026-08-10. */
const PLAN = {
  totalSemanas: 3,
  semanas: [
    { w: 1, inicio: "2026-08-10", fase: "carga" },
    { w: 2, inicio: "2026-08-17", fase: "carga" },
    { w: 3, inicio: "2026-08-24", fase: "descarga" },
  ],
};

const perfilCon = (weeks) => ({ plan: PLAN, weeks });

/* ---------- Fechas ---------- */

test("las fechas no se desplazan al cruzar cambio de mes ni de horario", () => {
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-03-28", 2), "2026-03-30", "el cambio de hora no debe restar un día");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(daysBetween("2026-08-10", "2026-08-17"), 7);
});

test("lunesDe devuelve el lunes de esa semana, y es idempotente sobre un lunes", () => {
  assert.equal(lunesDe("2026-08-13"), "2026-08-10", "jueves → lunes de su semana");
  assert.equal(lunesDe("2026-08-16"), "2026-08-10", "domingo pertenece a la semana que empezó el lunes");
  assert.equal(lunesDe("2026-08-10"), "2026-08-10");
});

test("weekOf sitúa la fecha en semana y día, y marca lo que cae fuera del plan", () => {
  assert.deepEqual(weekOf(PLAN, "2026-08-10"), { w: 1, dayIdx: 0, fuera: false });
  assert.deepEqual(weekOf(PLAN, "2026-08-16"), { w: 1, dayIdx: 6, fuera: false }, "domingo es el día 6");
  assert.deepEqual(weekOf(PLAN, "2026-08-18"), { w: 2, dayIdx: 1, fuera: false });
  assert.equal(weekOf(PLAN, "2026-08-09").fuera, true, "antes de empezar el plan");
  assert.equal(weekOf(PLAN, "2026-09-05").fuera, true, "después de la última semana");
});

/* ---------- Fecha → sesión ---------- */

test("sesionDeFecha traduce una fecha a la sesión que toca ese día", () => {
  const P = perfilCon({ 1: { assign: [{ day: 0, code: "GYM A" }, { day: 3, code: "RUN B" }], done: ["GYM A"] } });

  const lunes = sesionDeFecha(P, "2026-08-10");
  assert.equal(lunes.code, "GYM A");
  assert.equal(lunes.hecha, true);

  const jueves = sesionDeFecha(P, "2026-08-13");
  assert.equal(jueves.code, "RUN B");
  assert.equal(jueves.hecha, false);

  const martes = sesionDeFecha(P, "2026-08-11");
  assert.equal(martes.code, null, "un día sin asignar es descanso");
  assert.equal(martes.planificada, true, "pero la semana sí está programada");
});

test("una semana sin generar no se confunde con una semana de descanso", () => {
  const P = perfilCon({});
  const dia = sesionDeFecha(P, "2026-08-12");
  assert.equal(dia.planificada, false);
  assert.equal(estadoDia(P, "2026-08-12", "2026-08-12"), "sinplan");
});

/* ---------- Estado del día ---------- */

test("omitida solo existe en el pasado: lo de mañana está pendiente", () => {
  const P = perfilCon({ 1: { assign: [{ day: 0, code: "RUN A" }, { day: 2, code: "RUN B" }, { day: 4, code: "GYM A" }], done: ["RUN A"] } });
  const hoy = "2026-08-13";   // jueves de la semana 1

  assert.equal(estadoDia(P, "2026-08-10", hoy), "hecha", "lunes registrado");
  assert.equal(estadoDia(P, "2026-08-12", hoy), "omitida", "miércoles pasado y sin registrar");
  assert.equal(estadoDia(P, "2026-08-14", hoy), "pendiente", "viernes todavía no ha llegado");
  assert.equal(estadoDia(P, "2026-08-13", hoy), "descanso", "jueves no tiene sesión asignada");
  assert.equal(estadoDia(P, "2026-09-20", hoy), "fuera", "fuera del plan");
});

/* ---------- Registro libre: el plan recomienda, no excluye ----------

   Todo lo de aquí abajo protege la misma idea: lo que el atleta ha hecho de
   verdad se puede anotar SIEMPRE, y una vez anotado la agenda lo reconoce.
   Antes, entrenar algo no previsto quedaba invisible —o peor, el día seguía
   marcado como "omitido"— y la aplicación le decía que había fallado a alguien
   que acababa de entrenar. */

test("registrosDeFecha recoge carreras y agrupa las series de fuerza por sesión", () => {
  const P = {
    ...perfilCon({}),
    running: [
      { date: "2026-08-11", session_code: "LIBRE", duracion_min: 40 },
      { date: "2026-08-12", session_code: "RUN C", duracion_min: 30 },
    ],
    strength: [
      { date: "2026-08-11", session: "GYM A", exercise: "Sentadilla", set: 1 },
      { date: "2026-08-11", session: "GYM A", exercise: "Sentadilla", set: 2 },
      { date: "2026-08-11", session: "GYM A", exercise: "Press", set: 1 },
    ],
  };

  const dia = registrosDeFecha(P, "2026-08-11");
  assert.equal(dia.length, 2, "una carrera y UNA sesión de fuerza, no tres series sueltas");
  assert.deepEqual(dia.map((r) => r.tipo), ["run", "gym"]);
  assert.equal(dia[1].series.length, 3, "las tres series viven dentro de su sesión");
  assert.equal(registrosDeFecha(P, "2026-08-15").length, 0, "un día sin nada no inventa registros");
});

test("un entrenamiento libre en día de descanso cuenta y no se marca como omitido", () => {
  const base = perfilCon({ 1: { assign: [{ day: 0, code: "RUN A" }], done: [] } });
  const hoy = "2026-08-14";
  /* Martes: el plan no propone nada. */
  assert.equal(estadoDia(base, "2026-08-11", hoy), "descanso");

  const conRegistro = { ...base, running: [{ date: "2026-08-11", session_code: "LIBRE", duracion_min: 45 }] };
  assert.equal(estadoDia(conRegistro, "2026-08-11", hoy), "libre", "lo registrado tiene su propio estado");
  assert.equal(sesionDeFecha(conRegistro, "2026-08-11").hecha, true, "y cuenta como hecho");
});

test("registrar fuera del plan o sin semana generada deja de ser un agujero negro", () => {
  const hoy = "2026-09-25";
  /* Fecha posterior a la última semana del plan. */
  const fuera = { ...perfilCon({}), running: [{ date: "2026-09-20", session_code: "LIBRE", duracion_min: 60 }] };
  assert.equal(estadoDia(fuera, "2026-09-20", hoy), "libre", "fuera del plan pero registrado");
  assert.equal(estadoDia(fuera, "2026-09-21", hoy), "fuera", "sin registro sigue siendo fuera de plan");

  /* Semana dentro del plan pero sin generar. */
  const sinPlan = { ...perfilCon({}), strength: [{ date: "2026-08-19", session: "GYM B", set: 1 }] };
  assert.equal(estadoDia(sinPlan, "2026-08-19", hoy), "libre");
  assert.equal(estadoDia(sinPlan, "2026-08-20", hoy), "sinplan");
});

test("un registro no pisa la sesión que el plan sí tenía prevista para ese día", () => {
  const P = {
    ...perfilCon({ 1: { assign: [{ day: 0, code: "RUN A" }], done: [] } }),
    running: [{ date: "2026-08-10", session_code: "RUN A", duracion_min: 70 }],
  };
  const dia = sesionDeFecha(P, "2026-08-10");
  assert.equal(dia.code, "RUN A", "la recomendación del plan se conserva");
  assert.equal(dia.hecha, true, "y el registro la marca como hecha aunque `done` esté vacío");
  assert.equal(estadoDia(P, "2026-08-10", "2026-08-14"), "hecha", "no 'libre': el plan la contemplaba");
});

test("los códigos de sesión tienen nombre legible y LIBRE existe siempre", () => {
  assert.equal(etiquetaCodigo("RUN A"), "Tirada larga");
  assert.equal(etiquetaCodigo("LIBRE"), "Entrenamiento libre");
  assert.equal(etiquetaCodigo("GYM A"), "Fuerza A");
  assert.equal(etiquetaCodigo("LO QUE SEA"), "LO QUE SEA", "un código desconocido se muestra tal cual");
  assert.equal(etiquetaCodigo(null), "Sesión");
});

/* ---------- Reparto de sesiones en días ----------

   El caso que motiva estos tests: la permutación se hacía sobre los 6 primeros
   días cuando había más de 6 sesiones, así que con 7 sesiones y 7 días la
   condición de corte no se cumplía nunca, no quedaba ningún candidato y la
   semana salía VACÍA sin ningún error. El atleta pulsaba "generar" y la
   aplicación le decía después que la semana no estaba programada. */

/* Puntuador de juguete: no sabe de entrenamiento, solo premite comprobar que
   la búsqueda explora y elige. Las reglas reales (R1-R9) siguen en
   scoreAssignment, dentro del motor. */
const puntuadorSimple = (acc) => ({ score: acc.reduce((n, a) => n + a.day, 0), reasons: [], violations: [] });

test("siete sesiones en siete días producen un reparto, no una semana vacía", () => {
  const sesiones = ["RUN A", "GYM A", "GYM B", "RUN B", "GYM C", "RUN C", "RUN D"];
  const mejor = mejorReparto(sesiones, [0, 1, 2, 3, 4, 5, 6], puntuadorSimple);

  assert.ok(mejor, "con siete días y siete sesiones TIENE que haber reparto");
  assert.equal(mejor.assign.length, 7, "se colocan las siete");
  assert.deepEqual([...new Set(mejor.assign.map((a) => a.day))].sort(), [0, 1, 2, 3, 4, 5, 6],
    "un día por sesión, sin repetir");
  assert.deepEqual([...mejor.assign.map((a) => a.code)].sort(), [...sesiones].sort(),
    "no se pierde ni se inventa ninguna sesión");
});

test("el reparto elige de verdad la mejor combinación, no la primera que encuentra", () => {
  /* Puntúa alto solo si la primera sesión cae en el último día disponible:
     obliga a la búsqueda a mirar más allá de la primera hoja. */
  const puntuar = (acc) => ({ score: acc[0].day === 4 ? 100 : 0, reasons: [], violations: [] });
  const mejor = mejorReparto(["A", "B"], [0, 2, 4], puntuar);
  assert.equal(mejor.score, 100);
  assert.equal(mejor.assign[0].day, 4);
});

test("con menos días que sesiones se colocan las que caben, por orden de prioridad", () => {
  /* El orden de entrada ES la prioridad: lo que se cae es lo último. */
  const mejor = mejorReparto(["RUN A", "GYM A", "RUN B"], [1, 3], puntuadorSimple);
  assert.equal(mejor.assign.length, 2);
  assert.deepEqual(mejor.assign.map((a) => a.code).sort(), ["GYM A", "RUN A"]);
});

test("sin sesiones o sin días no se inventa un reparto", () => {
  assert.equal(mejorReparto([], [0, 1, 2], puntuadorSimple), null);
  assert.equal(mejorReparto(["RUN A"], [], puntuadorSimple), null);
});

test("un día duplicado en la disponibilidad no coloca dos sesiones el mismo día", () => {
  const mejor = mejorReparto(["RUN A", "GYM A"], [2, 2, 5], puntuadorSimple);
  assert.equal(mejor.assign.length, 2);
  assert.equal(new Set(mejor.assign.map((a) => a.day)).size, 2, "días distintos");
});

/* ---------- Precarga de pesos ---------- */

test("ultimaVezEjercicio devuelve la sesión más reciente de esa misma rutina", () => {
  const strength = [
    { date: "2026-08-03", session: "GYM A", exercise: "Press banca", set: 1, weight: 65, reps: 8 },
    { date: "2026-08-03", session: "GYM A", exercise: "Press banca", set: 2, weight: 65, reps: 8 },
    { date: "2026-08-10", session: "GYM A", exercise: "Press banca", set: 1, weight: 70, reps: 8 },
    { date: "2026-08-10", session: "GYM A", exercise: "Press banca", set: 2, weight: 70, reps: 8 },
    { date: "2026-08-10", session: "GYM A", exercise: "Press banca", set: 3, weight: 67.5, reps: 7 },
    /* Mismo ejercicio en OTRA rutina y más reciente: no debe contaminar. */
    { date: "2026-08-12", session: "GYM B", exercise: "Press banca", set: 1, weight: 50, reps: 12 },
  ];

  const ult = ultimaVezEjercicio(strength, "Press banca", "GYM A");
  assert.equal(ult.fecha, "2026-08-10");
  assert.equal(ult.peso, 70, "el peso de referencia es el más alto de aquella sesión");
  assert.deepEqual(ult.reps, [8, 8, 7]);

  assert.equal(ultimaVezEjercicio(strength, "Press banca", "GYM B").peso, 50);
  assert.equal(ultimaVezEjercicio(strength, "Sentadilla", "GYM A"), null, "sin historial no hay precarga");
  assert.equal(ultimaVezEjercicio([], "Press banca", "GYM A"), null);
});

/* ---------- Nutrición ---------- */

test("el tipo de día se deduce de las sesiones, sin decidir nada nutricional", () => {
  assert.equal(contextoDelDia([]), "descanso");
  assert.equal(contextoDelDia([{ code: "RECOVERY", dur: 30 }]), "descanso", "la recuperación no cuenta como sesión");
  assert.equal(contextoDelDia([{ code: "RUN A", dur: 90 }]), "larga");
  assert.equal(contextoDelDia([{ code: "RUN B", dur: 45, intensidad: "calidad" }]), "calidad");
  assert.equal(contextoDelDia([{ code: "GYM A", dur: 60 }]), "fuerza");
  assert.equal(contextoDelDia([{ code: "RUN C", dur: 35 }]), "suave");
});

test("la receta del día es estable: el mismo día propone siempre lo mismo", () => {
  const lista = ["a", "b", "c"];
  assert.equal(eligeEstable(lista, 7), eligeEstable(lista, 7));
  assert.notEqual(eligeEstable(lista, 7), eligeEstable(lista, 8), "días distintos, propuestas distintas");
  assert.equal(eligeEstable(lista, -1), "b", "una semilla negativa no rompe el índice");
  assert.equal(eligeEstable([], 3), null);
  assert.equal(eligeEstable(undefined, 3), null);
});

/* ---------- Coach ---------- */

test("el título de una conversación es la primera pregunta del usuario", () => {
  assert.equal(tituloConversacion([{ role: "assistant", content: "Hola" }, { role: "user", content: "¿Qué toca hoy?" }]), "¿Qué toca hoy?");
  assert.equal(tituloConversacion([]), "Conversación vacía");
  assert.equal(tituloConversacion(null), "Conversación vacía");
  assert.equal(tituloConversacion([{ role: "user", content: "x".repeat(90) }]).length, 60, "se recorta para caber en el historial");
});

test("iso conserva el día al ir y volver", () => {
  for (const f of ["2026-01-01", "2026-03-29", "2026-08-13", "2026-12-31"]) {
    assert.equal(iso(new Date(f + "T12:00:00")), f);
  }
});
