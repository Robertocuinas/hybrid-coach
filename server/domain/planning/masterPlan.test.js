import { test } from "node:test";
import assert from "node:assert/strict";
import { generarPlanMaestro } from "./masterPlan.js";
import { validarPlanMaestro, MASTER_PLAN_SCHEMA_VERSION } from "./masterPlanSchema.js";

const CHUNK = (over = {}) => ({
  id: "c1", documentId: "d1", titulo: "T", autores: "A", anio: 2024,
  studyType: "rct", evidenceGrade: "fuerte", texto: "La progresión de volumen debe ser gradual para reducir el riesgo de lesión.",
  scores: { umbral: 0.9 }, ...over,
});

const EVIDENCE = [CHUNK()];

function planMaestroValido() {
  return {
    schema_version: MASTER_PLAN_SCHEMA_VERSION,
    distancia_objetivo: "Media maratón",
    fecha_carrera: "2026-12-01",
    total_semanas: 12,
    riesgo: { score: 3, causas: ["perfil base"] },
    mezcla: { run: 3, gym: 2 },
    techo_tirada_larga_min: 90,
    taper_semanas: 2,
    semanas: Array.from({ length: 12 }, (_, i) => ({
      numero: i + 1,
      fase: i < 2 ? "adaptacion" : i < 8 ? "construccion" : i < 10 ? "especifica" : "taper",
      nota: "nota",
      checkpoint: null,
      gym: "carga",
      deload: i === 4 || i === 8,
      taper: i >= 10,
      sesiones: [
        { codigo: "RUN A", modalidad: "running", tipo: "long_run", titulo: "Tirada larga", objetivo: "Tiempo", duracion_min: 30 + i * 5, evidence_ids: ["c1"] },
        { codigo: "GYM A", modalidad: "strength", tipo: "strength", titulo: "Fuerza", objetivo: "Fuerza", duracion_min: 60, evidence_ids: ["c1"] },
      ],
    })),
    decisiones: [{ t: "Tirada por tiempo", p: "Controla recuperación", refs: ["c1"] }],
    evidence_state: "sufficient",
  };
}

function contextoBase() {
  return {
    profile: {
      distancia_objetivo: "Media maratón", fecha_carrera: "2026-12-01", dias: [1, 2, 3, 4],
      prioridades: ["Salud"], lesiones: [], molestias: [], banderas: ["Ninguna"],
    },
    now: "2026-09-01",
  };
}

test("validarPlanMaestro acepta un plan bien formado", () => {
  const r = validarPlanMaestro(planMaestroValido());
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
});

test("validarPlanMaestro rechaza versión incorrecta", () => {
  const r = validarPlanMaestro({ ...planMaestroValido(), schema_version: "otra" });
  assert.equal(r.ok, false);
});

test("generarPlanMaestro delega en el LLM y valida la salida", async () => {
  const llm = async () => JSON.stringify(planMaestroValido());
  const retrieve = async () => ({ chunks: EVIDENCE, hayEvidencia: true });
  const result = await generarPlanMaestro(contextoBase(), { llmProvider: llm, retrieve });
  assert.equal(result.status, "proposal");
  assert.ok(result.output);
  assert.equal(result.output.total_semanas, 12);
  assert.ok(result.evidence.length >= 1);
});

test("generarPlanMaestro cae a fallback si no hay evidencia", async () => {
  const llm = async () => JSON.stringify(planMaestroValido());
  const retrieve = async () => ({ chunks: [], hayEvidencia: false });
  const result = await generarPlanMaestro(contextoBase(), { llmProvider: llm, retrieve });
  assert.equal(result.status, "no_evidence");
  assert.equal(result.output, null);
  assert.ok(result.fallback);
});

test("generarPlanMaestro rechaza propuesta que viola guardarraíles no corregibles", async () => {
  const malo = planMaestroValido();
  // Más de 4 sesiones de carrera en una semana (TOO_MANY_RUN_SESSIONS): el
  // guardarraíl es duro y no se auto-corrige, así que se rechaza.
  malo.semanas[0].sesiones = [
    { codigo: "RUN A", modalidad: "running", tipo: "long_run", duracion_min: 50 },
    { codigo: "RUN B", modalidad: "running", tipo: "easy_run", duracion_min: 40 },
    { codigo: "RUN C", modalidad: "running", tipo: "intervals", duracion_min: 45 },
    { codigo: "RUN D", modalidad: "running", tipo: "tempo", duracion_min: 40 },
    { codigo: "RUN D2", modalidad: "running", tipo: "recovery_run", duracion_min: 30 },
  ];
  const llm = async () => JSON.stringify(malo);
  const retrieve = async () => ({ chunks: EVIDENCE, hayEvidencia: true });
  const result = await generarPlanMaestro(contextoBase(), { llmProvider: llm, retrieve });
  assert.equal(result.status, "invalid");
  assert.equal(result.output, null);
});

test("generarPlanMaestro corrige deterministicamente la progresión de tirada larga (>25%)", async () => {
  const plan = planMaestroValido();
  // Salto de tirada larga >25% entre semanas 0 y 1: el código lo limita a +25%.
  plan.semanas[1].sesiones[0].duracion_min = 80;
  const llm = async () => JSON.stringify(plan);
  const retrieve = async () => ({ chunks: EVIDENCE, hayEvidencia: true });
  const result = await generarPlanMaestro(contextoBase(), { llmProvider: llm, retrieve });
  assert.equal(result.status, "proposal");
  // La corrección debe haber limitado la semana 1 a <= 1.25x la semana 0.
  assert.ok(result.output.semanas[1].sesiones[0].duracion_min <= Math.floor(plan.semanas[0].sesiones[0].duracion_min * 1.25));
});

test("generarPlanMaestro exige contexto y retrieve", async () => {
  const result = await generarPlanMaestro({}, {});
  assert.equal(result.status, "invalid");
});
