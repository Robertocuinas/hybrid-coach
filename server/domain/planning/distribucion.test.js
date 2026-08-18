import test from "node:test";
import assert from "node:assert/strict";
import { distribuirSesiones, prioridadSesion } from "./distribucion.js";
import { evaluarGuardrailsPlan } from "./guardrails.js";

const sesion = (codigoSesion, tipo, titulo = "") => ({
  session_key: codigoSesion, codigo_sesion: codigoSesion, tipo, title: titulo, duracion_min: 45,
});

/* Las cuatro del plan maestro real: dos de gimnasio, tirada larga y calidad. */
const MAESTRO = [
  sesion("GYM A", "strength", "Fuerza pesada de piernas"),
  sesion("GYM B", "strength", "Fuerza de empuje"),
  sesion("RUN A", "running", "Tirada larga"),
  sesion("RUN B", "running", "Series"),
];

const LUNES_A_JUEVES = [0, 1, 2, 3];

/* El caso que tenía la aplicación bloqueada: cuatro días seguidos disponibles y
   cuatro sesiones. Con tope de 3 consecutivos solo caben 3, y las que quedan
   tienen que respetar además la separación pesada-tirada y calidad-tras-pesada.
   El modelo fallaba una restricción distinta en cada intento. */
test("con L-M-X-J y cuatro sesiones devuelve un reparto válido retirando una", () => {
  const reparto = distribuirSesiones({ sesiones: MAESTRO, diasDisponibles: LUNES_A_JUEVES });

  assert.ok(reparto, "tiene que encontrar algo, no rendirse");
  assert.equal(reparto.completo, false, "las cuatro no caben y hay que decirlo");
  assert.equal(reparto.asignaciones.length, 3);
  assert.equal(reparto.descartadas.length, 1);

  for (const asignacion of reparto.asignaciones) {
    assert.ok(LUNES_A_JUEVES.includes(asignacion.day_of_week), "solo días disponibles");
  }
  const dias = reparto.asignaciones.map((a) => a.day_of_week);
  assert.equal(new Set(dias).size, dias.length, "un día, una sesión");

  /* Lo que se retira es apoyo, nunca la tirada larga. */
  assert.ok(!reparto.descartadas.some((d) => d.master_session_code === "RUN A"),
    "la tirada larga es el ancla de la semana y no se sacrifica");
});

/* La comprobación que de verdad importa: el reparto propuesto tiene que pasar
   los guardarraíles REALES, no una copia de sus reglas. Si divergieran,
   estaríamos sugiriendo al modelo algo que luego se le rechaza. */
test("el reparto que propone supera los guardarraíles de verdad", () => {
  const inicio = "2026-08-17";
  const fechaDe = (dia) => {
    const d = new Date(`${inicio}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dia);
    return d.toISOString().slice(0, 10);
  };

  for (const disponibles of [[0, 1, 2, 3], [0, 1, 3, 5], [0, 2, 4, 6], [0, 1, 2, 3, 4, 5, 6], [1, 3, 5]]) {
    const reparto = distribuirSesiones({ sesiones: MAESTRO, diasDisponibles: disponibles });
    assert.ok(reparto?.asignaciones.length, `sin reparto para ${disponibles}`);

    const sessions = reparto.asignaciones.map((a) => {
      const original = MAESTRO.find((s) => s.session_key === a.session_key);
      return {
        session_key: a.session_key, master_session_code: a.master_session_code,
        date: fechaDe(a.day_of_week), day_of_week: a.day_of_week,
        modality: original.tipo === "strength" ? "strength" : "running",
        session_type: original.tipo, title: original.title,
        duration_min: 45, priority: "support",
        intensity: { rpe_min: 3, rpe_max: 4, rir_min: null, rir_max: null, pace_zone: null },
        prescription: { distance_km: null, sets: null, reps: null, notes: null },
        evidence_ids: ["ev-1"], change_from_master: { type: "moved", master_session_id: null },
      };
    });

    const resultado = evaluarGuardrailsPlan({ sessions, warnings: [], changes_from_master_plan: [] }, {}, {});
    const agenda = resultado.hard.filter((x) => [
      "MAX_STREAK", "MIN_REST", "HEAVY_BEFORE_LONG_RUN", "QUALITY_AFTER_HEAVY",
      "CONSECUTIVE_STRENGTH", "MULTIPLE_SESSIONS_SAME_DAY_UNSUPPORTED",
    ].includes(x.code));
    assert.deepEqual(agenda, [], `reparto inválido con ${disponibles}: ${JSON.stringify(agenda)}`);
  }
});

test("con la semana entera libre caben las cuatro", () => {
  const reparto = distribuirSesiones({ sesiones: MAESTRO, diasDisponibles: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(reparto.completo, true);
  assert.equal(reparto.descartadas.length, 0);
});

test("la prioridad decide qué se sacrifica primero", () => {
  assert.ok(prioridadSesion(sesion("RUN A", "running", "Tirada larga"))
    < prioridadSesion(sesion("RUN B", "running", "Series")));
  assert.ok(prioridadSesion(sesion("RUN B", "running", "Series"))
    < prioridadSesion(sesion("GYM A", "strength", "Fuerza")));
});

test("sin días o sin sesiones no inventa nada", () => {
  assert.equal(distribuirSesiones({ sesiones: MAESTRO, diasDisponibles: [] }), null);
  assert.equal(distribuirSesiones({ sesiones: [], diasDisponibles: [0, 1] }), null);
});

/* Un solo día disponible: solo cabe una sesión, y tiene que ser la tirada. */
test("con un único día disponible conserva la sesión más valiosa", () => {
  const reparto = distribuirSesiones({ sesiones: MAESTRO, diasDisponibles: [2] });
  assert.equal(reparto.asignaciones.length, 1);
  assert.equal(reparto.asignaciones[0].master_session_code, "RUN A");
});
