import test from "node:test";
import assert from "node:assert/strict";
import { readLegacyStravaConfig, requireLegacyStrava } from "./strava-config.js";

test("Strava heredado permanece cerrado aunque existan credenciales", () => {
  assert.deepEqual(readLegacyStravaConfig({ STRAVA_CLIENT_ID: "123", STRAVA_CLIENT_SECRET: "secret" }), {
    credentialsConfigured: true,
    explicitlyEnabled: false,
    enabled: false,
  });
});

test("Strava heredado exige credenciales y activación monousuario explícita", () => {
  assert.equal(readLegacyStravaConfig({ STRAVA_LEGACY_SINGLE_USER_ENABLED: "true" }).enabled, false);
  assert.equal(readLegacyStravaConfig({
    STRAVA_CLIENT_ID: "123",
    STRAVA_CLIENT_SECRET: "secret",
    STRAVA_LEGACY_SINGLE_USER_ENABLED: "true",
  }).enabled, true);
});

test("el middleware bloquea la ruta cuando el modo heredado está desactivado", () => {
  let status;
  requireLegacyStrava({ enabled: false })(
    {},
    { status: (value) => { status = value; return { json: () => {} }; } },
    () => { status = 200; },
  );
  assert.equal(status, 503);
});
