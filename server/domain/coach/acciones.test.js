import test from "node:test";
import assert from "node:assert/strict";
import { catalogoParaPrompt, diaAIndice, ejecutorDe, extraerAccion, nivelDe, validarAccion } from "./acciones.js";

test("los días se aceptan por nombre, con acentos y por índice", () => {
  assert.equal(diaAIndice("lunes"), 0);
  assert.equal(diaAIndice("Miércoles"), 2);
  assert.equal(diaAIndice("MIERCOLES"), 2);
  assert.equal(diaAIndice("sábado"), 5);
  assert.equal(diaAIndice(6), 6);
  assert.equal(diaAIndice(7), null, "fuera de rango");
  assert.equal(diaAIndice("pasado mañana"), null);
});

/* La lista es cerrada a propósito: es la frontera entre lo que el modelo
   puede pedir y lo que la aplicación sabe hacer. */
test("una acción que no está en el catálogo se descarta", () => {
  const { accion, aviso } = validarAccion({ accion: "borrar_cuenta", parametros: {} });
  assert.equal(accion, null);
  assert.match(aviso, /no está permitida/);
});

test("los parámetros fuera de rango se descartan, no se recortan en silencio", () => {
  const malo = validarAccion({ accion: "registrar_recuperacion", parametros: { fecha: "2026-08-14", sueno: 40 } });
  assert.equal(malo.accion, null, "40 horas de sueño no es un dato, es un error");

  const bueno = validarAccion({ accion: "registrar_recuperacion", parametros: { fecha: "2026-08-14", sueno: 7, fatiga: 4 } });
  assert.equal(bueno.accion.parametros.sueno, 7);
  assert.equal(bueno.accion.parametros.fatiga, 4);
});

test("una fecha mal formada invalida la acción entera", () => {
  for (const f of ["14/08/2026", "ayer", "2026-8-4", "", null]) {
    assert.equal(validarAccion({ accion: "consultar_entreno", parametros: { fecha: f } }).accion, null, `debería rechazar ${f}`);
  }
  assert.ok(validarAccion({ accion: "consultar_entreno", parametros: { fecha: "2026-08-14" } }).accion);
});

test("registrar sin ningún dato no es una escritura válida", () => {
  const vacio = validarAccion({ accion: "registrar_sensaciones", parametros: { fecha: "2026-08-14" } });
  assert.equal(vacio.accion, null);
  assert.match(vacio.aviso, /al menos un dato/);
});

/* Lista blanca de campos de perfil: el mismo criterio que CAMPOS_BLOQUEADOS.
   Que el modelo proponga un campo no significa que se pueda tocar. */
test("actualizar_perfil ignora los campos que no están en la lista blanca", () => {
  const { accion } = validarAccion({
    accion: "actualizar_perfil",
    parametros: { campos: { dias: ["lunes", "miercoles", "viernes"], techo: 999, totalSemanas: 2, edad: 30 } },
  });
  assert.deepEqual(accion.parametros.campos.dias, [0, 2, 4]);
  assert.equal(accion.parametros.campos.edad, 30);
  assert.ok(!("techo" in accion.parametros.campos), "techo es estructural: no se toca");
  assert.ok(!("totalSemanas" in accion.parametros.campos));
});

test("los días duplicados se colapsan y se ordenan", () => {
  const { accion } = validarAccion({
    accion: "generar_semana",
    parametros: { dias: ["sabado", "martes", "martes", "jueves"] },
  });
  assert.deepEqual(accion.parametros.dias, [1, 3, 5]);
});

/* Las ediciones del calendario las posee el planificador IA + RAG, que tiene
   su propio contrato de propuesta y aceptación. Tenerlas también aquí serían
   las dos lógicas de planificación que el proyecto quiere evitar. */
test("el catálogo del coach no incluye ediciones del calendario", () => {
  for (const nombre of ["mover_sesion", "quitar_sesion", "regenerar_semana"]) {
    assert.equal(validarAccion({ accion: nombre, parametros: {} }).accion, null, `${nombre} no debe estar en el catálogo del coach`);
  }
});

test("generar_semana se delega en el planificador, no la ejecuta el cliente", () => {
  assert.equal(ejecutorDe("generar_semana"), "planificador");
  assert.equal(ejecutorDe("registrar_recuperacion"), "cliente");
});

/* Sin planificador desplegado, sus acciones no se le enseñan al modelo: así no
   ofrece algo que después no se puede cumplir. */
test("el catálogo del prompt oculta las acciones del planificador si no está", () => {
  const sin = catalogoParaPrompt({ planificador: false });
  const con = catalogoParaPrompt({ planificador: true });

  assert.ok(!sin.includes("generar_semana"));
  assert.ok(con.includes("generar_semana"));
  for (const catalogo of [sin, con]) {
    assert.ok(catalogo.includes("registrar_recuperacion"), "las del cliente están siempre");
    assert.ok(catalogo.includes("consultar_entreno"));
  }
});

/* El nivel es lo que decide si algo se aplica solo o se propone. Ante algo
   desconocido, la respuesta segura es pedir confirmación. */
test("el nivel separa lo que se aplica de lo que se propone", () => {
  assert.equal(nivelDe("consultar_entreno"), "lectura");
  assert.equal(nivelDe("registrar_recuperacion"), "confirmacion");
  assert.equal(nivelDe("generar_semana"), "confirmacion");
  assert.equal(nivelDe("mover_sesion"), "confirmacion");
  assert.equal(nivelDe("lo_que_sea"), "confirmacion", "ante la duda, no se aplica solo");
});

/* ---------- Extracción del bloque ---------- */

test("el bloque <<ACCION>> sale del texto y no se muestra al usuario", () => {
  const bruto = `Te lo anoto.\n<<ACCION>>{"accion":"registrar_recuperacion","parametros":{"fecha":"2026-08-14","sueno":7},"motivo":"lo has pedido"}<<FIN>>`;
  const { texto, accion, avisos } = extraerAccion(bruto);

  assert.equal(texto, "Te lo anoto.");
  assert.ok(!texto.includes("<<ACCION>>"));
  assert.equal(accion.accion, "registrar_recuperacion");
  assert.equal(accion.nivel, "confirmacion");
  assert.equal(accion.parametros.sueno, 7);
  assert.deepEqual(avisos, []);
});

test("un bloque roto no rompe la respuesta: se pierde la acción, no el texto", () => {
  const { texto, accion, avisos } = extraerAccion("Aquí tienes.\n<<ACCION>>{esto no es json}<<FIN>>");
  assert.equal(texto, "Aquí tienes.");
  assert.equal(accion, null);
  assert.match(avisos[0], /no era JSON válido/);
});

test("sin bloque, la respuesta pasa intacta", () => {
  const { texto, accion } = extraerAccion("Hoy te toca rodaje suave de 40 minutos.");
  assert.equal(texto, "Hoy te toca rodaje suave de 40 minutos.");
  assert.equal(accion, null);
});

/* ---------- registrar_entreno ----------

   El plan es una recomendación: registrar lo que se ha hecho no puede depender
   de que ese día hubiera algo programado. Lo que sí se valida es la forma del
   dato, porque entra en el historial que después lee el planificador. */

test("registrar_entreno acepta una carrera con lo mínimo y normaliza el código", () => {
  const { accion } = validarAccion({
    accion: "registrar_entreno",
    parametros: { fecha: "2026-08-14", tipo: "run", codigo: "libre", minutos: 45, km: 8.2, rpe: 6 },
  });

  assert.equal(accion.accion, "registrar_entreno");
  assert.equal(accion.nivel, "confirmacion", "una escritura nunca se aplica sola");
  assert.equal(accion.parametros.codigo, "LIBRE", "el código se normaliza a mayúsculas");
  assert.equal(accion.parametros.minutos, 45);
  assert.equal(accion.parametros.km, 8.2);
  assert.equal(accion.parametros.rpe, 6);
});

test("registrar_entreno vale con solo distancia o con solo duración", () => {
  const soloKm = validarAccion({ accion: "registrar_entreno", parametros: { fecha: "2026-08-14", tipo: "run", km: 10 } });
  assert.equal(soloKm.accion.parametros.km, 10);
  assert.equal(soloKm.accion.parametros.minutos, undefined);

  const soloMin = validarAccion({ accion: "registrar_entreno", parametros: { fecha: "2026-08-14", tipo: "run", minutos: 30 } });
  assert.equal(soloMin.accion.parametros.minutos, 30);

  const nada = validarAccion({ accion: "registrar_entreno", parametros: { fecha: "2026-08-14", tipo: "run" } });
  assert.equal(nada.accion, null);
  assert.match(nada.aviso, /minutos o los kilómetros/);
});

test("registrar_entreno no deja pasar datos que ensuciarían el historial", () => {
  const sinTipo = validarAccion({ accion: "registrar_entreno", parametros: { fecha: "2026-08-14", minutos: 30 } });
  assert.equal(sinTipo.accion, null);
  assert.match(sinTipo.aviso, /"run" o "gym"/);

  const fechaMala = validarAccion({ accion: "registrar_entreno", parametros: { fecha: "14/08/2026", tipo: "run", minutos: 30 } });
  assert.equal(fechaMala.accion, null);

  const gymSinMinutos = validarAccion({ accion: "registrar_entreno", parametros: { fecha: "2026-08-14", tipo: "gym", km: 5 } });
  assert.equal(gymSinMinutos.accion, null, "una sesión de fuerza medida en kilómetros no tiene sentido");

  /* Un código inventado no entra: cae al genérico de su modalidad. */
  const codigoRaro = validarAccion({ accion: "registrar_entreno", parametros: { fecha: "2026-08-14", tipo: "run", codigo: "RUN Z", minutos: 30 } });
  assert.equal(codigoRaro.accion.parametros.codigo, "LIBRE");

  const exagerado = validarAccion({ accion: "registrar_entreno", parametros: { fecha: "2026-08-14", tipo: "run", minutos: 5000 } });
  assert.equal(exagerado.accion, null, "1200 km o 83 horas no son un entrenamiento");
});

test("registrar_entreno se le ofrece al modelo y lo ejecuta el cliente", () => {
  assert.equal(ejecutorDe("registrar_entreno"), "cliente");
  assert.equal(nivelDe("registrar_entreno"), "confirmacion");
  assert.match(catalogoParaPrompt({ planificador: false }), /registrar_entreno/,
    "no depende del planificador: registrar siempre está disponible");
});
