import test from "node:test";
import assert from "node:assert/strict";
import { alternativasA, buscarPorPatron } from "./busqueda.js";
import {
  compatible, criteriosDe, EQUIPO_POR_NIVEL, nivelEquipamiento,
  ordenarCandidatos, PATRONES, PATRONES_CONOCIDOS, puntuar,
} from "./patrones.js";

/* Las claves de PATRONES deben cubrir las de PAT en el cliente. Si alguien
   añade un patrón allí y no aquí, el planificador pedirá algo que este módulo
   no sabe traducir y la búsqueda devolverá vacío en silencio. */
const PAT_CLIENTE = ["rodilla", "rodilla_alt", "cadera", "gluteo", "isquios", "unilateral",
  "soleo", "gastro", "tibial", "emp_h", "emp_h2", "emp_v", "trac_h", "trac_v",
  "delt_lat", "biceps", "triceps", "core_ext", "core_rot", "cadera_abd"];

test("todos los patrones del cliente tienen traducción a criterios", () => {
  for (const clave of PAT_CLIENTE) {
    assert.ok(PATRONES[clave], `falta el patrón ${clave}`);
    assert.ok(PATRONES[clave].musculos.length, `${clave} sin músculo objetivo`);
    assert.ok(PATRONES[clave].etiqueta, `${clave} sin etiqueta legible`);
  }
  assert.equal(PATRONES_CONOCIDOS.length, PAT_CLIENTE.length);
});

/* ---------- Equipamiento ---------- */

test("el nivel de equipamiento sale del texto del perfil", () => {
  assert.equal(nivelEquipamiento("Gimnasio completo"), "full");
  assert.equal(nivelEquipamiento("Básico (mancuernas y máquinas)"), "basico");
  assert.equal(nivelEquipamiento("En casa (peso corporal y gomas)"), "casa");
});

/* Ante lo desconocido se asume lo más restrictivo: proponer un ejercicio
   imposible es peor que proponer uno pobre. */
test("un equipamiento desconocido cae al nivel más restrictivo", () => {
  assert.equal(nivelEquipamiento(""), "casa");
  assert.equal(nivelEquipamiento(null), "casa");
  assert.equal(nivelEquipamiento("lo que sea"), "casa");
});

test("los niveles son acumulativos hacia abajo", () => {
  for (const equipo of EQUIPO_POR_NIVEL.casa) {
    assert.ok(EQUIPO_POR_NIVEL.basico.includes(equipo), `${equipo} debería estar en basico`);
    assert.ok(EQUIPO_POR_NIVEL.full.includes(equipo), `${equipo} debería estar en full`);
  }
  assert.ok(!EQUIPO_POR_NIVEL.casa.includes("barbell"), "en casa no hay barra");
  assert.ok(!EQUIPO_POR_NIVEL.basico.includes("barbell"), "el nivel básico tampoco tiene barra");
  assert.ok(EQUIPO_POR_NIVEL.full.includes("barbell"));
});

test("un patrón desconocido no devuelve criterios en vez de devolver cualquiera", () => {
  assert.equal(criteriosDe("inventado", "Gimnasio completo"), null);
  const c = criteriosDe("rodilla", "Gimnasio completo");
  assert.equal(c.musculos[0], "quads");
  assert.equal(c.nivel, "full");
});

/* ---------- Compatibilidad y orden ---------- */

const ej = (nombre, target, equipamiento, extra = {}) => ({
  nombre, canonico: nombre.toLowerCase(), target, equipamiento,
  equipamientos: [equipamiento], secundarios: [], bodyPart: "upper legs", ...extra,
});

/* Es la garantía de §35: no recomendar lo que el atleta no puede hacer,
   independientemente de lo que devuelva la API. */
test("el equipamiento se filtra siempre en local, no se confía en la API", () => {
  const criterios = criteriosDe("rodilla", "En casa (peso corporal y gomas)");
  assert.equal(compatible(ej("Sentadilla", "quads", "body weight"), criterios), true);
  assert.equal(compatible(ej("Prensa", "quads", "leverage machine"), criterios), false);
  assert.equal(compatible(ej("Sentadilla barra", "quads", "barbell"), criterios), false);
});

test("acertar el músculo principal pesa más que rozarlo como secundario", () => {
  const criterios = criteriosDe("rodilla", "Gimnasio completo");
  const principal = puntuar(ej("A", "quads", "barbell"), criterios);
  const secundario = puntuar(ej("B", "calves", "barbell", { secundarios: ["quads"] }), criterios);
  assert.ok(principal > secundario, `${principal} debería superar a ${secundario}`);
});

test("los candidatos se ordenan por ajuste y se recortan al límite", () => {
  const criterios = criteriosDe("rodilla", "Gimnasio completo");
  const salida = ordenarCandidatos([
    ej("Curl", "biceps", "dumbbell"),
    ej("Sentadilla", "quads", "barbell", { instrucciones: ["a"], media: "x" }),
    ej("Prensa", "quads", "leverage machine"),
  ], criterios, { limite: 2 });

  assert.equal(salida.length, 2);
  assert.equal(salida[0].nombre, "Sentadilla", "el que acierta músculo y trae instrucciones va primero");
  assert.ok(!salida.some((e) => e.nombre === "Curl"), "el bíceps no sirve para dominante de rodilla");
});

/* ---------- Búsqueda ---------- */

const proveedorCon = (lista) => ({
  buscar: async () => lista,
  obtener: async () => null,
  capabilities: () => ({ provider: "test", media: true, filtroEquipamiento: true, filtroMusculo: true }),
});

test("sin catálogo configurado se devuelve vacío con motivo, nunca inventado", async () => {
  const r = await buscarPorPatron(null, { patron: "rodilla", equipamiento: "Gimnasio completo" });
  assert.deepEqual(r.candidatos, []);
  assert.match(r.motivo, /no está configurado/);
});

/* Un fallo del catálogo no puede tumbar el entrenamiento: se informa y quien
   llama mantiene la rutina que ya tenía. */
test("un fallo del proveedor devuelve vacío con motivo, no una excepción", async () => {
  const roto = { ...proveedorCon([]), buscar: async () => { throw new Error("429 límite"); } };
  const r = await buscarPorPatron(roto, { patron: "rodilla", equipamiento: "Gimnasio completo" });
  assert.deepEqual(r.candidatos, []);
  assert.match(r.motivo, /429 límite/);
});

test("la búsqueda filtra por equipamiento aunque la API devuelva de más", async () => {
  const provider = proveedorCon([
    ej("Prensa de piernas", "quads", "leverage machine"),
    ej("Sentadilla búlgara", "quads", "body weight"),
    ej("Sentadilla con barra", "quads", "barbell"),
  ]);
  const r = await buscarPorPatron(provider, { patron: "rodilla", equipamiento: "En casa (peso corporal y gomas)" });

  assert.equal(r.candidatos.length, 1);
  assert.equal(r.candidatos[0].nombre, "Sentadilla búlgara");
  assert.equal(r.criterios.nivel, "casa");
});

test("un patrón que el catálogo no cubre lo dice, no devuelve cualquier cosa", async () => {
  const r = await buscarPorPatron(proveedorCon([ej("Curl", "biceps", "dumbbell")]), {
    patron: "rodilla", equipamiento: "Gimnasio completo",
  });
  assert.deepEqual(r.candidatos, []);
  assert.match(r.motivo, /no tiene ejercicios que encajen/);
});

/* ---------- Sustituciones ---------- */

test("las alternativas excluyen el ejercicio actual", async () => {
  const provider = proveedorCon([
    ej("Sentadilla con barra", "quads", "barbell"),
    ej("Prensa de piernas", "quads", "leverage machine"),
    ej("Sentadilla goblet", "quads", "dumbbell"),
  ]);
  const r = await alternativasA(provider, {
    patron: "rodilla", equipamiento: "Gimnasio completo",
    ejercicioActual: { nombre: "Sentadilla con barra", canonico: "sentadilla con barra" },
  });

  assert.ok(!r.candidatos.some((e) => e.canonico === "sentadilla con barra"), "no se propone lo mismo que ya tenía");
  assert.ok(r.candidatos.length >= 1);
});

/* "Quiero uno con mancuernas" restringe dentro de lo disponible; nunca amplía
   el equipamiento por encima del nivel del atleta. */
test("pedir un material concreto filtra dentro de lo disponible", async () => {
  const provider = proveedorCon([
    ej("Prensa de piernas", "quads", "leverage machine"),
    ej("Sentadilla goblet", "quads", "dumbbell"),
  ]);
  const r = await alternativasA(provider, {
    patron: "rodilla", equipamiento: "Gimnasio completo",
    ejercicioActual: { canonico: "otra cosa" }, soloEquipo: "dumbbell",
  });

  assert.equal(r.candidatos.length, 1);
  assert.equal(r.candidatos[0].nombre, "Sentadilla goblet");
});

test("si no hay alternativas con ese material se dice, no se ofrece otro", async () => {
  const provider = proveedorCon([ej("Prensa de piernas", "quads", "leverage machine")]);
  const r = await alternativasA(provider, {
    patron: "rodilla", equipamiento: "Gimnasio completo",
    ejercicioActual: { canonico: "x" }, soloEquipo: "dumbbell",
  });
  assert.deepEqual(r.candidatos, []);
  assert.match(r.motivo, /No hay alternativas con dumbbell/);
});
