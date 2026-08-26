import test from "node:test";
import assert from "node:assert/strict";
import { createExerciseProvider, readExerciseConfig } from "./factory.js";
import { ExerciseDBProvider } from "./exercisedb.js";
import { nombreCanonico, normalizarEjercicio } from "./types.js";

/* ---------- Identidad ---------- */

/* Es la defensa contra el problema real: tres nombres del mismo ejercicio
   generando tres historiales de carga separados. */
test("el nombre canónico colapsa las variantes tipográficas del mismo ejercicio", () => {
  const iguales = ["Press banca", "PRESS BANCA", "press  banca", "Press-banca", "  Press Banca  "];
  const canonicos = new Set(iguales.map(nombreCanonico));
  assert.equal(canonicos.size, 1, `deberían colapsar en uno: ${[...canonicos]}`);
  assert.equal(nombreCanonico("Press banca"), "press banca");
});

test("los acentos y la puntuación no crean ejercicios distintos", () => {
  assert.equal(nombreCanonico("Elevación de gemelo"), nombreCanonico("Elevacion de gemelo"));
  assert.equal(nombreCanonico("Sentadilla búlgara"), "sentadilla bulgara");
  assert.equal(nombreCanonico("Curl 21's"), "curl 21 s");
  assert.equal(nombreCanonico(""), "");
  assert.equal(nombreCanonico(null), "");
});

/* Distinto ejercicio debe seguir siendo distinto: la normalización agresiva no
   puede llegar a fusionar cosas que no son lo mismo. */
test("ejercicios realmente distintos no colapsan", () => {
  assert.notEqual(nombreCanonico("Press banca"), nombreCanonico("Press militar"));
  assert.notEqual(nombreCanonico("Sentadilla trasera"), nombreCanonico("Sentadilla frontal"));
  assert.notEqual(nombreCanonico("Elevación de gemelo sentado"), nombreCanonico("Elevación de gemelo de pie"));
});

/* ---------- Normalización del modelo ---------- */

const BRUTO = {
  exerciseId: "abc123",
  name: "Barbell Bench Press",
  targetMuscles: ["pectorals"],
  secondaryMuscles: ["triceps", "deltoids"],
  bodyParts: ["chest"],
  equipments: ["barbell"],
  instructions: ["Lie on the bench.", "Lower the bar.", "Press up."],
  imageUrl: "https://ejemplo/gif.gif",
  videoUrl: "https://ejemplo/video.mp4",
};

test("la respuesta externa se traduce a nuestro modelo, no al revés", () => {
  const e = normalizarEjercicio(BRUTO, { provider: "exercisedb" });

  assert.equal(e.externalId, "abc123");
  assert.equal(e.provider, "exercisedb");
  assert.equal(e.nombre, "Barbell Bench Press");
  assert.equal(e.canonico, "barbell bench press");
  assert.equal(e.target, "pectorals", "las listas de uno se aplanan al principal");
  assert.deepEqual(e.secundarios, ["triceps", "deltoids"]);
  assert.equal(e.equipamiento, "barbell");
  assert.equal(e.bodyPart, "chest");
  assert.equal(e.instrucciones.length, 3);
  /* Referencia, no binario: no se descarga el GIF. */
  assert.equal(e.media, "https://ejemplo/video.mp4");
  /* Ningún nombre de campo del proveedor sobrevive al adaptador. */
  for (const campo of ["exerciseId", "targetMuscles", "bodyParts", "equipments", "imageUrl"]) {
    assert.ok(!(campo in e), `${campo} no debe salir del adaptador`);
  }
});

test("un ejercicio sin nombre se descarta en vez de entrar a medias", () => {
  assert.equal(normalizarEjercicio({ exerciseId: "x" }, { provider: "exercisedb" }), null);
  assert.equal(normalizarEjercicio({ name: "   " }, { provider: "exercisedb" }), null);
});

test("los campos que faltan quedan a null o lista vacía, nunca undefined", () => {
  const e = normalizarEjercicio({ exerciseId: "y", name: "Sentadilla" }, { provider: "exercisedb" });
  assert.equal(e.target, null);
  assert.deepEqual(e.secundarios, []);
  assert.deepEqual(e.instrucciones, []);
  assert.equal(e.media, null);
});

/* ---------- Envoltorios de la respuesta ---------- */

/* La API envuelve la lista de tres formas distintas según endpoint y versión.
   Si el desenvolvedor falla, la búsqueda devuelve vacío en silencio. */
test("se desenvuelve la lista venga como venga", () => {
  const uno = [{ name: "a" }];
  assert.deepEqual(ExerciseDBProvider.desenvolver(uno), uno);
  assert.deepEqual(ExerciseDBProvider.desenvolver({ data: uno }), uno);
  assert.deepEqual(ExerciseDBProvider.desenvolver({ data: { exercises: uno } }), uno);
  assert.deepEqual(ExerciseDBProvider.desenvolver({ exercises: uno }), uno);
  assert.deepEqual(ExerciseDBProvider.desenvolver({ otra: "cosa" }), []);
  assert.deepEqual(ExerciseDBProvider.desenvolver(null), []);
});

/* ---------- Configuración ---------- */

test("sin EXERCISE_PROVIDER el catálogo externo queda desactivado, no roto", () => {
  assert.equal(readExerciseConfig({}).enabled, false);
  assert.equal(createExerciseProvider({}), null, "la app sigue con PAT y los ejercicios propios");
});

test("una configuración a medias falla al arrancar, no en la primera búsqueda", () => {
  assert.throws(() => readExerciseConfig({ EXERCISE_PROVIDER: "exercisedb" }), /EXERCISEDB_API_KEY/);
  assert.throws(() => readExerciseConfig({ EXERCISE_PROVIDER: "inventado" }), /desconocido/);
});

/* Las dos vías de acceso exigen cabeceras distintas; el resto de la aplicación
   no debe enterarse de cuál se usa. */
test("con host firma como RapidAPI y sin host como acceso directo", () => {
  const conHost = new ExerciseDBProvider({ apiKey: "k", host: "exercisedb.p.rapidapi.com", baseURL: "https://x/api/v1" });
  assert.equal(conHost.cabeceras()["x-rapidapi-key"], "k");
  assert.equal(conHost.cabeceras()["x-rapidapi-host"], "exercisedb.p.rapidapi.com");
  assert.ok(!conHost.cabeceras().authorization);

  const directo = new ExerciseDBProvider({ apiKey: "k", host: "", baseURL: "https://x/api/v1" });
  assert.equal(directo.cabeceras().authorization, "Bearer k");
  assert.ok(!directo.cabeceras()["x-rapidapi-key"]);
});

/* ---------- Peticiones ---------- */

test("la búsqueda envía los filtros y devuelve el modelo interno", async () => {
  let pedida = null;
  const provider = createExerciseProvider(
    { EXERCISE_PROVIDER: "exercisedb", EXERCISEDB_API_KEY: "k", EXERCISEDB_BASE_URL: "https://x/api/v1" },
    { fetchImpl: async (url) => { pedida = url; return { ok: true, json: async () => ({ data: [BRUTO] }) }; } },
  );

  const salida = await provider.buscar({ musculo: "pectorals", equipamiento: "barbell", limite: 5 });

  assert.match(pedida, /targetMuscles=pectorals/);
  assert.match(pedida, /equipments=barbell/);
  assert.match(pedida, /limit=5/);
  assert.equal(salida[0].canonico, "barbell bench press");
});

test("los criterios vacíos no viajan como parámetros sueltos", async () => {
  let pedida = null;
  const provider = createExerciseProvider(
    { EXERCISE_PROVIDER: "exercisedb", EXERCISEDB_API_KEY: "k", EXERCISEDB_BASE_URL: "https://x/api/v1" },
    { fetchImpl: async (url) => { pedida = url; return { ok: true, json: async () => ({ data: [] }) }; } },
  );
  await provider.buscar({ musculo: "quads" });
  assert.ok(!pedida.includes("equipments="), `no debe mandar filtros vacíos: ${pedida}`);
  assert.ok(!pedida.includes("search="));
});

/* Un fallo del catálogo no puede tumbar el entrenamiento: se propaga con un
   mensaje legible para que arriba se decida mantener la rutina actual (§59). */
test("los errores de la API llegan con mensaje legible y su status", async () => {
  const con = (status) => createExerciseProvider(
    { EXERCISE_PROVIDER: "exercisedb", EXERCISEDB_API_KEY: "k", EXERCISEDB_BASE_URL: "https://x/api/v1" },
    { fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }) },
  );

  await assert.rejects(() => con(429).buscar({}), /límite de peticiones/);
  await assert.rejects(() => con(401).buscar({}), /clave de ExerciseDB no es válida/);
  await assert.rejects(() => con(500).buscar({}), /respondió 500/);
});

test("un ejercicio inexistente devuelve null, no un error", async () => {
  const provider = createExerciseProvider(
    { EXERCISE_PROVIDER: "exercisedb", EXERCISEDB_API_KEY: "k", EXERCISEDB_BASE_URL: "https://x/api/v1" },
    { fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) },
  );
  assert.equal(await provider.obtener("noexiste"), null);
  assert.equal(await provider.obtener(""), null, "sin id no se llama a la API");
});

/* ============================================================
   Fase 17 — Workout Guide (catálogo local, sin clave ni red)
   ============================================================ */

test("workoutguide se activa sin API key (catálogo local)", () => {
  const config = readExerciseConfig({ EXERCISE_PROVIDER: "workoutguide" });
  assert.equal(config.enabled, true);
  assert.equal(config.provider, "workoutguide");
  assert.doesNotThrow(() => createExerciseProvider({ EXERCISE_PROVIDER: "workoutguide" }));
});

test("workoutguide NO exige EXERCISEDB_API_KEY y ExerciseDB sigue igual", () => {
  assert.throws(() => readExerciseConfig({ EXERCISE_PROVIDER: "exercisedb" }), /EXERCISEDB_API_KEY/);
  assert.doesNotThrow(() => readExerciseConfig({ EXERCISE_PROVIDER: "workoutguide" }));
});

test("el adaptador cumple el contrato ExerciseProvider", async () => {
  const provider = createExerciseProvider({ EXERCISE_PROVIDER: "workoutguide" });
  assert.ok(provider);
  assert.equal(typeof provider.buscar, "function");
  assert.equal(typeof provider.obtener, "function");
  assert.equal(typeof provider.capabilities, "function");
  const caps = provider.capabilities();
  for (const k of ["provider", "media", "filtroEquipamiento", "filtroMusculo"]) {
    assert.ok(k in caps, `falta capability ${k}`);
  }
  assert.equal(caps.provider, "workoutguide");
});

test("buscar por nombre devuelve el ejercicio con media PNG same-origin y músculo traducido", async () => {
  const provider = createExerciseProvider({ EXERCISE_PROVIDER: "workoutguide" });
  const salida = await provider.buscar({ texto: "push-up", limite: 6 });
  const pushUp = salida.find((e) => e.canonico === "push up");
  assert.ok(pushUp, `push-up debe aparecer: ${salida.map((e) => e.canonico).join(", ")}`);
  assert.equal(pushUp.provider, "workoutguide");
  assert.equal(pushUp.externalId, "push-up");
  assert.equal(pushUp.target, "pectorals", "el músculo del paquete (Chest) se traduce al interno");
  assert.ok(pushUp.media, "trae ilustración");
  assert.match(pushUp.media, /\/assets\/ejercicios\/push-up\/frame-1\.png$/, "media es PNG same-origin");
});

test("buscar por músculo interno devuelve candidatos del grupo con media", async () => {
  const provider = createExerciseProvider({ EXERCISE_PROVIDER: "workoutguide" });
  const salida = await provider.buscar({ musculo: "pectorals", limite: 20 });
  assert.ok(salida.length, "debe haber ejercicios de pecho");
  assert.ok(salida.some((e) => e.target === "pectorals"), "alguno toca pectorals (traducido)");
  assert.ok(salida.every((e) => e.media && e.media.endsWith(".png")), "todos traen figura PNG");
});

test("el filtro de equipamiento local se aplica (body weight excluye barra)", async () => {
  const provider = createExerciseProvider({ EXERCISE_PROVIDER: "workoutguide" });
  const soloCasa = await provider.buscar({ musculo: "pectorals", equipamiento: "body weight", limite: 20 });
  assert.ok(soloCasa.length, "debe haber empujes sin material");
  for (const e of soloCasa) {
    assert.equal(e.equipamiento, "body weight", `sin filtro local entraría ${e.equipamiento}`);
  }
});

test("obtener por slug devuelve el ejercicio y su figura", async () => {
  const provider = createExerciseProvider({ EXERCISE_PROVIDER: "workoutguide" });
  const e = await provider.obtener("push-up");
  assert.ok(e);
  assert.equal(e.canonico, "push up");
  assert.match(e.media, /\/assets\/ejercicios\/push-up\/frame-1\.png$/);
  assert.equal(await provider.obtener(""), null);
});
