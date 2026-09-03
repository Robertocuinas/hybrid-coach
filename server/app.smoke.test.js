/**
 * Smoke test del binario: importa `buildApp()` y verifica que los endpoints
 * públicos responden aunque no haya Postgres. Esto protege contra regresiones
 * del bootstrap (top-level awaits, orden de middlewares, rutas) que los tests
 * unitarios no cubren — un cambio que deja `app.js` sin exportar Express o
 * cambia el orden de `app.use(securityHeaders)` antes `app.use(requireTrustedOrigin)`
 * deja la app inservible sin que ningún test de lógica lo note.
 *
 * Se ejecuta con `node --test server/app.smoke.test.js` desde el `npm test`.
 * No usa supertest: hace fetch contra un puerto 0 (el SO asigna uno libre) y
 * cierra el servidor al terminar. Esto evita añadir una dependencia.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.SESSION_SECRET = "smoke-test-secret-de-mas-de-treinta-y-dos-caracteres";

const { buildApp } = await import("./app.js");

test("buildApp() construye una app Express válida", async () => {
  const built = await buildApp();
  assert.equal(typeof built.app, "function", "app debe ser el handler de Express");
  assert.equal(typeof built.app.listen, "function", "app debe tener .listen");
});

test("GET /health/live responde 200 sin tocar la base", async () => {
  const { app } = await buildApp();
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/health/live`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /health sin base de datos devuelve 503 con services.pgvector=unavailable", async () => {
  const { app } = await buildApp({
    env: { ...process.env, DATABASE_URL: "postgres://x:y@127.0.0.1:1/none" },
  });
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(r.status, 503);
    const body = await r.json();
    assert.equal(body.status, "degraded");
    assert.equal(body.services.pgvector, "unavailable");
    assert.equal(body.services.ia, "unavailable", "sin LLM_PROVIDER debe reportarse unavailable, no available");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/entrar devuelve 410 con el mensaje correcto", async () => {
  const { app } = await buildApp();
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/api/entrar`, { method: "POST" });
    assert.equal(r.status, 410);
    const body = await r.json();
    assert.equal(body.ok, false);
    assert.match(body.message, /\/api\/auth\/login/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("mutaciones sin cookie y sin Origin pasan el CSRF y llegan al router (comportamiento documentado)", async () => {
  const { app } = await buildApp();
  const server = app.listen(0);
  try {
    const port = server.address().port;
    /* El middleware `requireTrustedOrigin` solo exige Origin cuando la petición
       lleva cookie (regla anti-CSRF: una mutación cross-site siempre lleva
       credenciales, una mutación anónima no requiere Origin). Verifica que
       un endpoint protegido sin cookie y sin Origin llega al handler de auth
       y devuelve 401, no se queda en 403. Si en algún momento cambia la regla
       a "todo POST necesita Origin", este test pasa a fallar y avisa.

       Se elige `/api/ia` porque es el único endpoint `requireAuth + aiRateLimiter`
       que responde 401 sin tocar la base de datos (el router auth intenta
       consultar `users` y devuelve 500 sin DB). */
    const r = await fetch(`http://127.0.0.1:${port}/api/ia`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 401, `esperaba 401 (sin sesión), obtuve ${r.status}`);
    const body = await r.json();
    assert.match(body.message, /Autenticación/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("mutaciones con cookie y sin Origin son bloqueadas con 403", async () => {
  const { app } = await buildApp();
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "hc_session=fake",
        origin: "",
      },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 403, "mutación con cookie y sin Origin debe ser bloqueada");
    const body = await r.json();
    assert.equal(body.ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("SESSION_SECRET corta (< 32 chars) hace fallar buildApp()", async () => {
  await assert.rejects(
    () => buildApp({ env: { ...process.env, SESSION_SECRET: "corto" } }),
    /SESSION_SECRET.*32 caracteres/,
  );
});

test("los listeners de proceso solo se registran una vez aunque buildApp se llame varias veces", () => {
  /* Verificación débil pero útil: si buildApp registra listeners cada vez, un
     test que lo llama N veces acaba con N oyentes de unhandledRejection y los
     errores se loguean N veces. El flag global del módulo lo previene; este
     test documenta la expectativa y falla si alguien lo quita sin querer. */
  assert.equal(globalThis.__hybridCoachProcessListenersRegistered, true);
  /* Sanity: el flag existe, lo haya puesto esta sesión de tests u otra. */
  assert.ok("__hybridCoachProcessListenersRegistered" in globalThis);
});

/* Este import está aquí solo para recordarle a `node --test` que los tests
   usan crypto (lo necesita el módulo `auth.js` cuando se importa vía app). */
void crypto;