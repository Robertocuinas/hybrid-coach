import test from "node:test";
import assert from "node:assert/strict";
import { presupuestoEntrada, presupuestoSalida, topeSalida, topeSalidaPeticion } from "./limits.js";

/* El presupuesto de tokens estaba repartido en literales por seis ficheros y
   todos eran de un modelo pequeño. Lo que estos tests protegen no es una cifra
   concreta, sino tres propiedades: que subir LLM_MAX_TOKENS sube TODO a la vez,
   que cada tarea se puede ajustar por su cuenta, y que una variable mal puesta
   degrada a algo utilizable en vez de romper la aplicación. */

test("sin configuración el tope de salida es holgado, no el de un modelo pequeño", () => {
  assert.equal(topeSalida({}), 8000);
  const p = presupuestoSalida({});
  assert.equal(p.planificador, 8000, "el planificador escribe la semana entera: nunca por debajo del tope");
  assert.ok(p.coach >= 1500);
  assert.ok(p.decisiones >= 2400);
  assert.ok(p.resumen >= 600);
});

test("subir LLM_MAX_TOKENS sube todas las tareas sin tocar seis variables", () => {
  const base = presupuestoSalida({});
  const grande = presupuestoSalida({ LLM_MAX_TOKENS: "32000" });
  assert.equal(grande.tope, 32000);
  assert.ok(grande.planificador > base.planificador);
  assert.ok(grande.coach > base.coach);
  assert.ok(grande.decisiones > base.decisiones);
});

test("cada tarea se puede fijar por su cuenta y nunca supera el tope global", () => {
  const p = presupuestoSalida({ LLM_MAX_TOKENS: "10000", LLM_MAX_TOKENS_COACH: "2500" });
  assert.equal(p.coach, 2500);
  const recortado = presupuestoSalida({ LLM_MAX_TOKENS: "4000", LLM_MAX_TOKENS_COACH: "999999" });
  assert.equal(recortado.coach, 4000, "una tarea no puede pedir más que el tope del servidor");
});

test("una variable inservible degrada al valor por defecto en vez de romper", () => {
  assert.equal(topeSalida({ LLM_MAX_TOKENS: "" }), 8000);
  assert.equal(topeSalida({ LLM_MAX_TOKENS: "muchos" }), 8000);
  assert.equal(topeSalida({ LLM_MAX_TOKENS: "0" }), 256, "se acota por abajo, no se acepta cero");
  assert.equal(topeSalida({ LLM_MAX_TOKENS: "99999999" }), 200_000, "y también por arriba");
});

test("una petición a /api/ia no puede superar el tope del servidor", () => {
  assert.equal(topeSalidaPeticion(1000, { LLM_MAX_TOKENS: "8000" }), 1000, "pedir menos es válido");
  assert.equal(topeSalidaPeticion(999_999, { LLM_MAX_TOKENS: "8000" }), 8000, "pedir más se recorta al tope");
  assert.equal(topeSalidaPeticion(undefined, { LLM_MAX_TOKENS: "8000" }), 4000, "sin pedir nada, un valor razonable");
  assert.equal(
    topeSalidaPeticion(undefined, { LLM_MAX_TOKENS: "2000" }), 2000,
    "y ese valor razonable tampoco puede pasarse del tope",
  );
});

test("el presupuesto de entrada deja de ser el cuello de botella y sigue acotado", () => {
  const e = presupuestoEntrada({});
  assert.ok(e.evidenciaChars >= 3000, "un fragmento de evidencia entra entero, no cortado a media frase");
  assert.ok(e.reparacionChars >= 60_000, "el modelo ve el intento rechazado completo al repararlo");
  assert.ok(e.turnosLiterales >= 24, "no se resume la conversación antes de tiempo");
  assert.ok(e.umbralResumen > e.turnosLiterales, "compactar tiene que dejar algo que compactar");
});
