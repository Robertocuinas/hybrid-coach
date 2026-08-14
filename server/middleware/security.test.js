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
