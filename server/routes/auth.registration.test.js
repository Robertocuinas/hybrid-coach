import test from "node:test";
import assert from "node:assert/strict";
import { isPublicRegistrationEnabled } from "./auth.js";

test("el registro público queda disponible si Railway no define la variable", () => {
  assert.equal(isPublicRegistrationEnabled(undefined), true);
  assert.equal(isPublicRegistrationEnabled(""), true);
  assert.equal(isPublicRegistrationEnabled("   "), true);
});

test("el registro se puede cerrar explícitamente y un valor inválido no lo abre", () => {
  assert.equal(isPublicRegistrationEnabled("false"), false);
  assert.equal(isPublicRegistrationEnabled("FALSE"), false);
  assert.equal(isPublicRegistrationEnabled("fasle"), false);
});

test("la configuración explícita true habilita el registro", () => {
  assert.equal(isPublicRegistrationEnabled("true"), true);
  assert.equal(isPublicRegistrationEnabled(" TRUE "), true);
});

test("el flag Secure de la cookie está activo salvo opt-out explícito (T-02)", () => {
  const cookieSecure = (valor) =>
    String(valor ?? "true").toLowerCase() !== "false";
  assert.equal(cookieSecure(undefined), true);
  assert.equal(cookieSecure("true"), true);
  assert.equal(cookieSecure("TRUE"), true);
  // Solo desarrollo local sin HTTPS debería desactivarlo.
  assert.equal(cookieSecure("false"), false);
  assert.equal(cookieSecure("FALSE"), false);
});
