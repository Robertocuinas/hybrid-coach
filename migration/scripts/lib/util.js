import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
export const SOURCE_DIR = path.join(ROOT, "migration", "source");
export const SHEETS_DIR = path.join(SOURCE_DIR, "sheets");
export const PARSED_DIR = path.join(ROOT, "migration", "parsed");
export const PARSED_LOCAL_DIR = path.join(PARSED_DIR, "localstorage");
export const PARSED_SHEETS_DIR = path.join(PARSED_DIR, "sheets");
export const TRANSFORMED_DIR = path.join(ROOT, "migration", "transformed");
export const TRANSFORMED_FILE = path.join(TRANSFORMED_DIR, "migration.json");

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => e.name);
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

/* "" y undefined son ruido de Sheets/formularios; NULL es la representación
   correcta en la base de datos. */
export function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

export function toNumber(value) {
  const v = normalizeValue(value);
  if (v === null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/* Punto delicado (docs/06-migracion.md §4): la progresión de carga se asocia
   hoy por NOMBRE de ejercicio. Dos grafías distintas del mismo ejercicio
   ("Sentadilla", "sentadilla ", "SENTADILLA") deben normalizar a la misma
   clave o se pierde el historial de progresión al migrar. */
export function normalizeExerciseName(name) {
  const v = normalizeValue(name);
  if (v === null) return null;
  return String(v)
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // quita acentos
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

/* Igual que arriba pero conservando mayúsculas para guardar como nombre
   "bonito" en la base de datos: se usa la primera grafía vista de cada
   ejercicio, no la normalizada. */
export function titleCase(name) {
  const v = normalizeValue(name);
  if (v === null) return null;
  return String(v).trim().replace(/\s+/g, " ");
}

/* "grado" en BIBLIO_SEED mezcla tipo de estudio y confianza (ver
   docs/10-decisiones-tecnicas.md D9). Aquí solo se traduce a los valores del
   enum evidence_grade; study_type queda sin poblar — no hay forma de
   derivarlo con fiabilidad del dato de origen, ver migration/README.md. */
const GRADO_A_EVIDENCE_GRADE = {
  fuerte: "fuerte",
  moderada: "moderada",
  "débil": "debil",
  debil: "debil",
  "practica": "practica",
  "práctica": "practica",
};
export function normalizeEvidenceGrade(grado) {
  const v = normalizeValue(grado);
  if (v === null) return null;
  return GRADO_A_EVIDENCE_GRADE[v.trim().toLowerCase()] ?? null;
}

export function normalizeProfileName(nombre) {
  const v = normalizeValue(nombre);
  if (v === null) return null;
  return String(v).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function isoDate(value) {
  const v = normalizeValue(value);
  if (v === null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/* Rangos válidos de la app (RunForm/CheckIn): RPE 1-10, dolor 0-10. Un valor
   fuera de rango se rechaza y se cuenta, nunca se trunca en silencio
   (docs/06-migracion.md §4). */
export function inRange(value, min, max) {
  const n = toNumber(value);
  if (n === null) return true; // ausente no es inválido
  return n >= min && n <= max;
}

export function logStep(nombre) {
  console.log(`\n=== Paso ${nombre} ===`);
}

/* UUID v5 (determinista) a partir de la clave natural de cada entidad.

   Es lo que hace que la migración sea reejecutable: si los IDs fueran
   aleatorios, volver a lanzar el paso 03 generaría IDs nuevos y la carga
   insertaría filas duplicadas en vez de actualizar las existentes. Derivándolos
   de la clave natural (docs/06-migracion.md §6), el mismo registro de origen
   produce siempre el mismo UUID, y `ON CONFLICT (id)` se comporta como un
   UPSERT sobre clave natural — que es justo lo que exige §1. */
const NAMESPACE = "6f2b1a54-3c47-4f0e-9a1d-2b8e5c7f04a9"; // fijo para este proyecto

export function idDeterminista(tabla, ...partes) {
  const nombre = [tabla, ...partes.map((p) => (p === null || p === undefined ? "" : String(p)))].join("|");
  const nsBytes = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([nsBytes, Buffer.from(nombre, "utf8")])).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // versión 5
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
