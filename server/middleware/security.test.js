import test from "node:test";
import assert from "node:assert/strict";
import { requireTrustedOrigin, securityHeaders } from "./security.js";

test("las respuestas API incluyen hardening y no se cachean", () => {
  const headers = {};
  securityHeaders({ path: "/api/profile" }, { setHeader: (key, value) => { headers[key] = value; } }, () => {});
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(headers["Cache-Control"], "no-store");
});

test("una mutación autenticada sin Origin se rechaza si APP_ORIGIN está fijado", () => {
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://app.example";
  let status;
  requireTrustedOrigin(
    { method: "POST", headers: { cookie: "hc_session=x" }, get: () => undefined },
    { status: (value) => { status = value; return { json: () => {} }; } },
    () => { status = 200; },
  );
  if (previous === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previous;
  assert.equal(status, 403);
});

test("una mutación autenticada sin Origin se rechaza aunque APP_ORIGIN no esté fijado", () => {
  const previous = process.env.APP_ORIGIN;
  delete process.env.APP_ORIGIN;
  let status;
  requireTrustedOrigin(
    { method: "POST", headers: { cookie: "hc_session=x" }, get: () => undefined },
    { status: (value) => { status = value; return { json: () => {} }; } },
    () => { status = 200; },
  );
  if (previous !== undefined) process.env.APP_ORIGIN = previous;
  assert.equal(status, 403);
});

test("sin APP_ORIGIN solo se acepta un origen con el mismo Host", () => {
  const previous = process.env.APP_ORIGIN;
  delete process.env.APP_ORIGIN;
  const request = (origin) => ({
    method: "POST",
    headers: { cookie: "hc_session=x" },
    get: (name) => ({
      origin,
      host: "app.example",
    })[name],
  });
  const execute = (origin) => {
    let status;
    requireTrustedOrigin(
      request(origin),
      { status: (value) => { status = value; return { json: () => {} }; } },
      () => { status = 200; },
    );
    return status;
  };
  assert.equal(execute("https://app.example"), 200);
  assert.equal(execute("https://evil.example"), 403);
  if (previous !== undefined) process.env.APP_ORIGIN = previous;
});

/* El limitador de IA protege el bolsillo de quien pone la clave, no es una
   restricción de producto: tiene que poder apagarse. Y apagarlo NO puede
   hacerse con limit:0 —desde express-rate-limit v7 eso bloquea todo, que es
   justo lo contrario— así que se comprueba que la lectura devuelve `skip`. */
test("el límite de IA se puede subir y apagar sin tocar código", async () => {
  const { leerLimiteIA } = await import("./auth.js");

  assert.deepEqual(leerLimiteIA({}), { desactivado: false, limite: 30 }, "por defecto, 30 por minuto");
  assert.equal(leerLimiteIA({ AI_RATE_LIMIT_PER_MINUTE: "120" }).limite, 120);
  assert.equal(leerLimiteIA({ AI_RATE_LIMIT_PER_MINUTE: "120" }).desactivado, false);

  for (const valor of ["0", "-1", "no-es-un-numero", ""]) {
    const leido = leerLimiteIA({ AI_RATE_LIMIT_PER_MINUTE: valor });
    assert.equal(leido.desactivado, true, `${valor} debe desactivar el límite`);
    assert.ok(leido.limite > 0, "y nunca dejar limit en 0, que en v7+ bloquea todo");
  }
});
