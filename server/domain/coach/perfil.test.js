import test from "node:test";
import assert from "node:assert/strict";
import { bloquePerfil, ESENCIALES, estadoPerfil } from "./perfil.js";

const completo = {
  perfil: {
    distancia_objetivo: "Media maratón",
    fecha_carrera: "2026-10-18",
    exp_carrera: "1-3 años",
    equipamiento: "Gimnasio completo",
  },
  disponibilidad: { dias: [0, 2, 4, 6] },
};

test("la lista de esenciales es corta: solo lo que cambia la programación", () => {
  /* Si esta lista crece, el coach se convierte en el cuestionario que §4 pide
     evitar. Cualquier añadido debería ser una decisión consciente. */
  assert.equal(ESENCIALES.length, 5);
  assert.deepEqual(ESENCIALES.map((e) => e.clave).sort(),
    ["dias", "distancia", "equipamiento", "expCarrera", "fechaCarrera"]);
});

test("un perfil con los cinco esenciales está completo", () => {
  const estado = estadoPerfil(completo);
  assert.equal(estado.completo, true);
  assert.deepEqual(estado.faltan, []);
  assert.equal(estado.tiene.length, 5);
});

/* La disponibilidad no vive en el perfil sino en su propia tabla: si se leyera
   solo de `perfil` daría siempre por ausente y el coach la pediría cada vez. */
test("la disponibilidad se lee de su tabla, no del perfil", () => {
  const sinDias = estadoPerfil({ ...completo, disponibilidad: null });
  assert.equal(sinDias.completo, false);
  assert.deepEqual(sinDias.faltan.map((e) => e.clave), ["dias"]);

  const listaVacia = estadoPerfil({ ...completo, disponibilidad: { dias: [] } });
  assert.equal(listaVacia.completo, false, "una lista vacía es tan ausente como null");
});

test("un perfil vacío echa en falta los cinco", () => {
  const estado = estadoPerfil({});
  assert.equal(estado.completo, false);
  assert.equal(estado.faltan.length, 5);
  assert.equal(estado.tiene.length, 0);
});

/* Lo que más molesta de un asistente es que vuelva a preguntar algo ya dicho.
   El bloque lo prohíbe de forma explícita, no por omisión. */
test("el bloque enumera lo que ya sabe para que no lo vuelva a preguntar", () => {
  const bloque = bloquePerfil({
    perfil: { distancia_objetivo: "Media maratón", fecha_carrera: "2026-10-18" },
    disponibilidad: null,
  });

  assert.match(bloque, /NO lo vuelvas a preguntar/);
  assert.match(bloque, /objetivo/);
  assert.match(bloque, /fecha de la carrera/);
  assert.match(bloque, /Te falta:.*días que puedes entrenar/s);
  assert.match(bloque, /¿Cuántos días por semana puedes entrenar/);
});

test("con el perfil completo el bloque prohíbe preguntar por lo básico", () => {
  const bloque = bloquePerfil(completo);
  assert.match(bloque, /Completo para planificar/);
  assert.match(bloque, /NO preguntes/);
  assert.ok(!bloque.includes("Te falta"), "no hay nada que pedir");
});

/* Con plan activo lo básico ya se contestó: interrumpir una consulta cualquiera
   para completar el perfil sería intrusivo. */
test("con plan activo, lo que falte no interrumpe la conversación", () => {
  const bloque = bloquePerfil({ ...completo, disponibilidad: null, plan: { total_semanas: 12 } });
  assert.match(bloque, /no interrumpas/i);
  assert.ok(!bloque.includes("sin estos datos no se puede planificar"));
});
