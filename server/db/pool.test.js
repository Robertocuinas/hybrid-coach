import test from "node:test";
import assert from "node:assert/strict";
import pkg from "pg";
import { resolveDatabaseSSL } from "./pool.js";

test("las conexiones públicas exigen TLS por defecto", () => {
  assert.deepEqual(resolveDatabaseSSL({ mode: "auto", local: false, railwayPrivate: false }), { rejectUnauthorized: false });
});

test("localhost y Railway privado no fuerzan TLS en auto", () => {
  assert.equal(resolveDatabaseSSL({ mode: "auto", local: true, railwayPrivate: false }), false);
  assert.equal(resolveDatabaseSSL({ mode: "auto", local: false, railwayPrivate: true }), false);
});

test("desactivar TLS requiere una elección explícita", () => {
  assert.equal(resolveDatabaseSSL({ mode: "disable", local: false, railwayPrivate: false }), false);
  assert.deepEqual(resolveDatabaseSSL({ mode: "require", local: true, railwayPrivate: false }), { rejectUnauthorized: false });
});

/* Regresión: una columna `date` es un día del calendario, no un instante.
   Antes de fijar el parser, node-pg devolvía un Date interpretado en la zona
   horaria del proceso y al serializar a JSON salía el día ANTERIOR en España
   (UTC+1/+2): registrabas una tirada el 25 y la aplicación te la pintaba el 24.
   Importar ./pool.js instala el parser; aquí se comprueba que sigue instalado. */
test("una fecha de PostgreSQL vuelve como YYYY-MM-DD, no como instante UTC", () => {
  const parser = pkg.types.getTypeParser(1082);
  assert.equal(parser("2026-12-25"), "2026-12-25");
  assert.equal(typeof parser("2026-12-25"), "string",
    "si esto es un objeto Date, el día se desplaza al serializar a JSON");
});

test("el desplazamiento de día ya no ocurre al pasar por JSON", () => {
  const parser = pkg.types.getTypeParser(1082);
  const serializado = JSON.parse(JSON.stringify({ fecha: parser("2026-01-01") }));
  assert.equal(serializado.fecha, "2026-01-01",
    "Año Nuevo no puede convertirse en Nochevieja del año anterior");
});
