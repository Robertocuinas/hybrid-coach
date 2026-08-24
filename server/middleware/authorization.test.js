import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { findOwnedProfile } from "../db/repositories/athleteProfiles.js";
import { esUUID } from "./authorization.js";

test("un usuario no puede resolver el athlete_profile_id de otro usuario", async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE athlete_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    nombre text
  );`);
  const firstUser = "11111111-1111-4111-8111-111111111111";
  const secondUser = "22222222-2222-4222-8222-222222222222";
  const inserted = await db.query(
    `INSERT INTO athlete_profiles (user_id, nombre) VALUES ($1, 'Privado') RETURNING id`,
    [firstUser]
  );

  const own = await findOwnedProfile(inserted.rows[0].id, firstUser, db);
  const foreign = await findOwnedProfile(inserted.rows[0].id, secondUser, db);

  assert.equal(own.nombre, "Privado");
  assert.equal(foreign, null);
  await db.close();
});

test("esUUID acepta UUID v4 reales (regresión de T-01: el regex tenía un grupo de más)", () => {
  for (let i = 0; i < 1000; i++) assert.equal(esUUID(randomUUID()), true);
});

test("esUUID rechaza formatos inválidos sin lanzar", () => {
  assert.equal(esUUID(""), false);
  assert.equal(esUUID(null), false);
  assert.equal(esUUID(undefined), false);
  assert.equal(esUUID("null"), false);
  assert.equal(esUUID("1234-5678"), false);
  assert.equal(esUUID("xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"), false);
  assert.equal(esUUID("11111111-1111-1111-1111-111111111111-extra"), false);
});
