import express from "express";
import { createHash } from "node:crypto";
import { pool } from "../db/repositories/_helpers.js";
import { requireAuth } from "../middleware/auth.js";
import { requireActiveProfile } from "../middleware/authorization.js";

const router = express.Router();
router.use(requireAuth, requireActiveProfile);

const numberOrNull = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const intOrNull = (value) => {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number);
};
const paceOrNull = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value || "").match(/^(\d+):(\d{1,2})$/);
  return match ? Number(match[1]) + Number(match[2]) / 60 : numberOrNull(value);
};
const source = (value) => value === "strava" ? "strava" : "manual";

const stableObject = (value) => {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
};

export const planStructureHash = (plan = {}) => createHash("sha256")
  .update(JSON.stringify(stableObject({
    totalSemanas: plan.totalSemanas,
    taper: plan.taper,
    runDias: plan.runDias,
    gymDias: plan.gymDias,
    techo: plan.techo,
    riesgo: plan.riesgo,
    gymCodes: plan.gymCodes,
    semanas: (plan.semanas || []).map((week) => ({
      w: week.w, inicio: week.inicio, fase: week.fase, cp: week.cp,
      gym: week.gym, deload: week.deload, taper: week.taper, runs: week.runs,
    })),
  })))
  .digest("hex");

const sameArray = (left, right) => JSON.stringify([...(left || [])].map(Number).sort())
  === JSON.stringify([...(right || [])].map(Number).sort());

export function compareSnapshotTimes(incoming, stored) {
  const incomingMs = Date.parse(String(incoming || ""));
  if (!Number.isFinite(incomingMs)) return { valid: false, newer: false };
  if (!stored) return { valid: true, newer: true };
  const storedMs = Date.parse(String(stored));
  return { valid: true, newer: !Number.isFinite(storedMs) || incomingMs > storedMs };
}

export async function replaceProfileState(client, profileId, snapshot) {
  const wrapper = snapshot.profile || {};
  const profile = wrapper.perfil || {};
  await client.query(`UPDATE athlete_profiles SET
      nombre=$2, edad=$3, sexo=$4, altura_cm=$5, peso_kg=$6, grasa_pct=$7,
      distancia_objetivo=$8, fecha_carrera=$9, meta_tipo=$10, meta_tiempo=$11,
      prioridades=$12, exp_carrera=$13, km_semana=$14, sesiones_carrera=$15,
      tirada_larga_min=$16, ritmo_comodo=$17, paron=$18, superficie=$19,
      exp_fuerza=$20, equipamiento=$21, cargas=$22, tecnica=$23,
      estructural=$24, cirugias=$25, banderas=$26, momento_entreno=$27,
      cross_training=$28, horas_sueno=$29, calidad_sueno=$30, estres=$31,
      trabajo=$32, nutricion_objetivo=$33, suplementos=$34, reloj=$35,
      current_complaints=$36, updated_at=now()
    WHERE id=$1`, [
    profileId, profile.nombre ?? wrapper.nombre ?? null, intOrNull(profile.edad), profile.sexo ?? null,
    intOrNull(profile.altura ?? profile.altura_cm), numberOrNull(profile.peso ?? profile.peso_kg),
    numberOrNull(profile.grasa ?? profile.grasa_pct), profile.distancia ?? profile.distancia_objetivo ?? null,
    profile.fechaCarrera ?? profile.fecha_carrera ?? null, profile.metaTipo ?? profile.meta_tipo ?? null,
    profile.metaTiempo ?? profile.meta_tiempo ?? null, profile.prioridad ?? profile.prioridades ?? [],
    profile.expCarrera ?? profile.exp_carrera ?? null, intOrNull(profile.kmSemana ?? profile.km_semana),
    intOrNull(profile.sesionesCarrera ?? profile.sesiones_carrera),
    intOrNull(profile.tiradaLarga ?? profile.tirada_larga_min), profile.ritmoComodo ?? profile.ritmo_comodo ?? null,
    profile.paron ?? null, profile.superficie ?? [], profile.expFuerza ?? profile.exp_fuerza ?? null,
    profile.equipamiento ?? null, JSON.stringify(profile.cargas || {}), profile.tecnica ?? null,
    profile.estructural ?? [], profile.cirugias ?? null, profile.banderas ?? [],
    profile.momento ?? profile.momento_entreno ?? null, profile.crossTraining ?? profile.cross_training ?? null,
    numberOrNull(profile.sueno ?? profile.horas_sueno), profile.calidadSueno ?? profile.calidad_sueno ?? null,
    numberOrNull(profile.estres), profile.trabajo ?? null,
    profile.nutricion ?? profile.nutricion_objetivo ?? null, profile.suplementos ?? [], profile.reloj ?? null,
    JSON.stringify(profile.molestias || []),
  ]);

  /* Lesiones y disponibilidad sí forman parte del contexto científico. Antes
     se quedaban exclusivamente dentro del snapshot y el Coach recibía arrays
     vacíos aunque el usuario los hubiera declarado en el Wizard. */
  if (Array.isArray(profile.lesiones)) {
    await client.query(`DELETE FROM injuries WHERE athlete_profile_id=$1`, [profileId]);
    for (const injury of profile.lesiones) {
      if (!String(injury?.zona || "").trim()) continue;
      await client.query(`INSERT INTO injuries (athlete_profile_id,zona,recurrente,contexto,activa)
        VALUES ($1,$2,$3,$4,true)`, [profileId, String(injury.zona).slice(0, 160), !!injury.recurrente, injury.contexto ?? null]);
    }
  }

  const availableDays = Array.isArray(profile.dias)
    ? [...new Set(profile.dias.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : [];
  if (availableDays.length) {
    const { rows: latestAvailability } = await client.query(`SELECT dias,min_gym,min_run,min_finde
      FROM availability WHERE athlete_profile_id=$1 ORDER BY vigente_desde DESC NULLS LAST,id DESC LIMIT 1`, [profileId]);
    const latest = latestAvailability[0];
    const changed = !latest || !sameArray(latest.dias, availableDays)
      || intOrNull(latest.min_gym) !== intOrNull(profile.minGym)
      || intOrNull(latest.min_run) !== intOrNull(profile.minRun)
      || intOrNull(latest.min_finde) !== intOrNull(profile.finde);
    if (changed) {
      await client.query(`INSERT INTO availability
        (athlete_profile_id,vigente_desde,dias,min_gym,min_run,min_finde)
        VALUES ($1,$2,$3,$4,$5,$6)`, [profileId,
        String(snapshot.capturedAt || new Date().toISOString()).slice(0, 10), availableDays,
        intOrNull(profile.minGym), intOrNull(profile.minRun), intOrNull(profile.finde)]);
    }
  }

  if (wrapper.plan) {
    const plan = wrapper.plan;
    const structureHash = planStructureHash(plan);
    const current = await client.query(`SELECT id,version,structure_hash FROM training_plans
      WHERE athlete_profile_id=$1 AND activo=true ORDER BY generado_en DESC LIMIT 1 FOR UPDATE`, [profileId]);
    let planId = current.rows[0]?.id || null;

    if (!planId) {
      const inserted = await client.query(`INSERT INTO training_plans
        (athlete_profile_id,version,distancia_objetivo,fecha_carrera,total_semanas,taper_semanas,
         run_dias,gym_dias,techo_tirada_larga_min,riesgo_score,riesgo_causas,structure_hash,activo)
        VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) RETURNING id`, [
        profileId, profile.distancia ?? null, profile.fechaCarrera ?? null, intOrNull(plan.totalSemanas),
        intOrNull(plan.taper), intOrNull(plan.runDias), intOrNull(plan.gymDias), intOrNull(plan.techo),
        numberOrNull(plan.riesgo?.score), JSON.stringify(plan.riesgo?.causas || []), structureHash,
      ]);
      planId = inserted.rows[0].id;
    } else if (!current.rows[0].structure_hash) {
      /* Primer snapshot tras la migración: se completa la versión heredada sin
         crear una copia artificial del mismo plan. */
      await client.query(`UPDATE training_plans SET distancia_objetivo=$2,fecha_carrera=$3,
        total_semanas=$4,taper_semanas=$5,run_dias=$6,gym_dias=$7,techo_tirada_larga_min=$8,
        riesgo_score=$9,riesgo_causas=$10,structure_hash=$11 WHERE id=$1`, [
        planId, profile.distancia ?? null, profile.fechaCarrera ?? null, intOrNull(plan.totalSemanas),
        intOrNull(plan.taper), intOrNull(plan.runDias), intOrNull(plan.gymDias), intOrNull(plan.techo),
        numberOrNull(plan.riesgo?.score), JSON.stringify(plan.riesgo?.causas || []), structureHash,
      ]);
    } else if (current.rows[0].structure_hash !== structureHash) {
      const version = await client.query(`SELECT COALESCE(max(version),0)+1 AS version
        FROM training_plans WHERE athlete_profile_id=$1`, [profileId]);
      await client.query(`UPDATE training_plans SET activo=false WHERE id=$1`, [planId]);
      const inserted = await client.query(`INSERT INTO training_plans
        (athlete_profile_id,version,distancia_objetivo,fecha_carrera,total_semanas,taper_semanas,
         run_dias,gym_dias,techo_tirada_larga_min,riesgo_score,riesgo_causas,structure_hash,activo)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) RETURNING id`, [
        profileId, intOrNull(version.rows[0].version), profile.distancia ?? null, profile.fechaCarrera ?? null,
        intOrNull(plan.totalSemanas), intOrNull(plan.taper), intOrNull(plan.runDias), intOrNull(plan.gymDias),
        intOrNull(plan.techo), numberOrNull(plan.riesgo?.score), JSON.stringify(plan.riesgo?.causas || []), structureHash,
      ]);
      planId = inserted.rows[0].id;
    }

    /* La estructura completa deja de ser invisible para el backend. Cada
       código es un slot del plan maestro; el día refleja la última asignación
       local conocida solo durante el periodo de dual-write. */
    for (const masterWeek of plan.semanas || []) {
      const weekNumber = intOrNull(masterWeek.w);
      if (!weekNumber) continue;
      const savedWeek = await client.query(`INSERT INTO training_weeks
        (training_plan_id,numero_semana,inicio,fase,techo_tirada_larga_min,es_deload,es_taper,checkpoint)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (training_plan_id,numero_semana) DO UPDATE SET
          inicio=excluded.inicio,fase=excluded.fase,techo_tirada_larga_min=excluded.techo_tirada_larga_min,
          es_deload=excluded.es_deload,es_taper=excluded.es_taper,checkpoint=excluded.checkpoint
        RETURNING id`, [planId, weekNumber, masterWeek.inicio ?? null, masterWeek.fase ?? null,
        intOrNull(plan.techo), !!masterWeek.deload, !!masterWeek.taper, masterWeek.cp ?? null]);
      const weekId = savedWeek.rows[0].id;
      const localWeek = (wrapper.weeks || {})[weekNumber];
      const tacticalRevision = localWeek?.source === "ai-rag" && !!localWeek?.proposalId;
      const assignments = new Map((localWeek?.assign || []).map((entry) => [entry.code, intOrNull(entry.day)]));
      /* Una revisión IA aceptada es táctica y vive en weekly_plan_*; no debe
         reescribir por dual-write los días del plan maestro. Conservamos los
         slots que ya estaban sincronizados antes de generar la propuesta. */
      const existingDays = tacticalRevision
        ? new Map((await client.query(`SELECT codigo_sesion,dia_semana FROM planned_sessions WHERE training_week_id=$1`, [weekId]))
          .rows.map((row) => [row.codigo_sesion, intOrNull(row.dia_semana)]))
        : new Map();
      const codes = [
        ...Object.keys(masterWeek.runs || {}),
        ...(masterWeek.taper ? (plan.gymCodes || []).slice(0, 1) : (plan.gymCodes || [])),
      ];
      for (const code of [...new Set(codes)]) {
        const running = masterWeek.runs?.[code];
        const type = code.startsWith("RUN") ? "run" : code === "RECOVERY" ? "recovery" : "gym";
        await client.query(`INSERT INTO planned_sessions
          (training_week_id,dia_semana,codigo_sesion,tipo,descripcion,duracion_min,intensidad)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (training_week_id,codigo_sesion) DO UPDATE SET
            dia_semana=excluded.dia_semana,tipo=excluded.tipo,descripcion=excluded.descripcion,
            duracion_min=excluded.duracion_min,intensidad=excluded.intensidad`, [
          weekId, (tacticalRevision ? existingDays.get(code) : assignments.get(code)) ?? null, code, type, running?.d ?? null,
          intOrNull(running?.t), /RPE\s*[5-9]|calidad/i.test(String(running?.d || "")) ? "calidad" : "facil",
        ]);
      }
    }
  }

  // Durante dual write localStorage es la fuente de verdad: el historial se reemplaza
  // dentro de la misma transacción y las tablas detalle caen por ON DELETE CASCADE.
  await client.query(`DELETE FROM completed_sessions WHERE athlete_profile_id=$1`, [profileId]);
  for (const run of wrapper.running || []) {
    const completed = await client.query(`INSERT INTO completed_sessions
      (athlete_profile_id,planned_session_id,fecha,tipo,semana)
      VALUES ($1,(SELECT ps.id FROM training_plans tp
        JOIN training_weeks tw ON tw.training_plan_id=tp.id
        JOIN planned_sessions ps ON ps.training_week_id=tw.id
        WHERE tp.athlete_profile_id=$1 AND tp.activo=true
          AND tw.numero_semana=$3 AND ps.codigo_sesion=$4 LIMIT 1),$2,'running',$3)
      RETURNING id`, [profileId, run.date ?? run.fecha ?? null, intOrNull(run.semana), run.session_code ?? run.codigo_sesion ?? null]);
    await client.query(`INSERT INTO running_sessions
      (completed_session_id,codigo_sesion,distancia_km,duracion_min,ritmo,fc_media,fc_max,desnivel,cadencia,rpe,dolor,notas,origen,external_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [
      completed.rows[0].id, run.session_code ?? run.codigo_sesion ?? null, numberOrNull(run.distancia_km ?? run.km),
      intOrNull(run.duracion_min ?? run.min), paceOrNull(run.ritmo), numberOrNull(run.fc_media), numberOrNull(run.fc_max),
      numberOrNull(run.desnivel), numberOrNull(run.cadencia), intOrNull(run.rpe), intOrNull(run.dolor),
      run.notas ?? null, source(run.source ?? run.origen), run.external_id ? String(run.external_id) : null,
    ]);
  }

  const strengthGroups = new Map();
  for (const set of wrapper.strength || []) {
    const key = `${set.date ?? set.fecha ?? ""}|${set.session ?? set.codigo_sesion ?? "GYM"}`;
    if (!strengthGroups.has(key)) strengthGroups.set(key, []);
    strengthGroups.get(key).push(set);
  }
  for (const [key, sets] of strengthGroups) {
    const [date, code] = key.split("|");
    const completed = await client.query(`INSERT INTO completed_sessions
      (athlete_profile_id,planned_session_id,fecha,tipo,semana)
      VALUES ($1,(SELECT ps.id FROM training_plans tp
        JOIN training_weeks tw ON tw.training_plan_id=tp.id
        JOIN planned_sessions ps ON ps.training_week_id=tw.id
        WHERE tp.athlete_profile_id=$1 AND tp.activo=true
          AND tw.numero_semana=$3 AND ps.codigo_sesion=$4 LIMIT 1),$2,'strength',$3)
      RETURNING id`, [profileId, date || null, intOrNull(sets[0]?.semana), code]);
    const strength = await client.query(`INSERT INTO strength_sessions (completed_session_id,codigo_sesion) VALUES ($1,$2) RETURNING id`, [completed.rows[0].id, code]);
    for (const [index, set] of sets.entries()) {
      const name = String(set.exercise ?? set.ejercicio ?? "Ejercicio sin nombre").trim();
      let exercise = await client.query(`SELECT id FROM strength_exercises WHERE lower(trim(nombre))=lower(trim($1)) AND athlete_profile_id IS NOT DISTINCT FROM $2 LIMIT 1`, [name, profileId]);
      if (!exercise.rows[0]) exercise = await client.query(`INSERT INTO strength_exercises (nombre,athlete_profile_id) VALUES ($1,$2) RETURNING id`, [name, profileId]);
      await client.query(`INSERT INTO strength_sets (strength_session_id,strength_exercise_id,orden,peso_kg,reps,rir,notas)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [strength.rows[0].id, exercise.rows[0].id,
        intOrNull(set.set) ?? index + 1, numberOrNull(set.weight ?? set.peso_kg), intOrNull(set.reps), intOrNull(set.rir), set.notes ?? set.notas ?? null]);
    }
  }

  await client.query(`DELETE FROM feedback_logs WHERE athlete_profile_id=$1`, [profileId]);
  for (const row of wrapper.checkins || []) {
    await client.query(`INSERT INTO feedback_logs
      (athlete_profile_id,fecha,semana,rpe,sensacion,dolor,zona_dolor,tipo_dolor,cuando_aparece,energia,comentario)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [profileId, row.date ?? row.fecha ?? null,
      intOrNull(row.semana), intOrNull(row.rpe), row.feelTxt ?? row.sensacion ?? null, numberOrNull(row.dolor),
      row.loc ?? row.zona_dolor ?? null, row.tipo ?? row.tipo_dolor ?? null, row.cuando ?? row.cuando_aparece ?? null,
      numberOrNull(row.energia), row.comentario ?? null]);
  }

  await client.query(`DELETE FROM recovery_logs WHERE athlete_profile_id=$1`, [profileId]);
  const recoveryByDate = new Map((wrapper.recovery || []).map((row) => [row.date ?? row.fecha, row]));
  for (const [date, row] of recoveryByDate) {
    if (!date) continue;
    await client.query(`INSERT INTO recovery_logs
      (athlete_profile_id,fecha,horas_sueno,calidad_sueno,fatiga,agujetas,estres,motivacion,dolor)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [profileId, date, numberOrNull(row.sueno ?? row.horas_sueno),
      numberOrNull(row.calidad ?? row.calidad_sueno), numberOrNull(row.fatiga), numberOrNull(row.agujetas),
      numberOrNull(row.estres), numberOrNull(row.motivacion), numberOrNull(row.dolor)]);
  }
}

router.get("/sync-state", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT state, profile_local_id, state_captured_at
      FROM client_state_snapshots WHERE athlete_profile_id=$1`, [req.auth.athleteProfileId]);
    const row = rows[0];
    res.json({ ok: true, snapshot: row ? {
      profile: row.state,
      profileLocalId: row.profile_local_id,
      capturedAt: row.state_captured_at,
    } : null });
  } catch (error) { next(error); }
});

router.post("/sync", async (req, res, next) => {
  const operationId = String(req.body?.operationId || req.get("Idempotency-Key") || "");
  const snapshot = req.body?.snapshot;
  if (!operationId || operationId.length > 100 || !snapshot?.profile || !snapshot?.totals) {
    return res.status(400).json({ ok: false, message: "Operación de sincronización no válida" });
  }
  const timing = compareSnapshotTimes(snapshot.capturedAt, null);
  if (!timing.valid) return res.status(400).json({ ok: false, message: "capturedAt no es una fecha válida" });
  if (Date.parse(snapshot.capturedAt) > Date.now() + 5 * 60_000) {
    return res.status(400).json({ ok: false, message: "capturedAt está demasiado adelantado" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const operation = await client.query(`INSERT INTO sync_operations (user_id,operation_id,athlete_profile_id)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING operation_id`, [req.auth.userId, operationId, req.auth.athleteProfileId]);
    if (!operation.rowCount) {
      await client.query("ROLLBACK");
      return res.json({ ok: true, duplicate: true });
    }
    const previous = await client.query(`SELECT state_captured_at FROM client_state_snapshots
      WHERE athlete_profile_id=$1 FOR UPDATE`, [req.auth.athleteProfileId]);
    if (!compareSnapshotTimes(snapshot.capturedAt, previous.rows[0]?.state_captured_at).newer) {
      await client.query("COMMIT");
      return res.json({ ok: true, ignored: true, reason: "stale_snapshot" });
    }
    await replaceProfileState(client, req.auth.athleteProfileId, snapshot);
    await client.query(`INSERT INTO client_state_snapshots
      (athlete_profile_id,profile_local_id,state,local_totals,captured_at,state_captured_at,received_at)
      VALUES ($1,$2,$3,$4,$5,$5,now()) ON CONFLICT (athlete_profile_id) DO UPDATE SET
      profile_local_id=excluded.profile_local_id,state=excluded.state,local_totals=excluded.local_totals,
      captured_at=excluded.captured_at,state_captured_at=excluded.state_captured_at,received_at=now()`, [req.auth.athleteProfileId, snapshot.profileLocalId,
      snapshot.profile, snapshot.totals, snapshot.capturedAt]);
    await client.query("COMMIT");
    res.json({ ok: true, operationId });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally { client.release(); }
});

router.post("/reconciliation-snapshot", async (req, res, next) => {
  try {
    const totals = req.body?.totals;
    if (!totals) return res.status(400).json({ ok: false, message: "Faltan totales locales" });
    await pool.query(`INSERT INTO client_state_snapshots
      (athlete_profile_id,profile_local_id,state,local_totals,captured_at,received_at)
      VALUES ($1,$2,'{}'::jsonb,$3,$4,now()) ON CONFLICT (athlete_profile_id) DO UPDATE SET
      profile_local_id=excluded.profile_local_id,local_totals=excluded.local_totals,
      captured_at=excluded.captured_at,received_at=now()`, [req.auth.athleteProfileId,
      req.body?.profileLocalId ?? null, totals, req.body?.capturedAt || new Date().toISOString()]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.get("/reconciliation-status", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT status,differences,local_totals,database_totals,checked_at,day
      FROM (SELECT DISTINCT ON ((checked_at AT TIME ZONE 'UTC')::date)
        status,differences,local_totals,database_totals,checked_at,(checked_at AT TIME ZONE 'UTC')::date AS day
        FROM reconciliation_runs WHERE athlete_profile_id=$1
        ORDER BY (checked_at AT TIME ZONE 'UTC')::date DESC,checked_at DESC) daily
      ORDER BY day DESC LIMIT 7`, [req.auth.athleteProfileId]);
    let greenStreak = 0;
    let previousDay = null;
    for (const row of rows) {
      const day = Date.parse(`${row.day}T00:00:00Z`);
      if (row.status !== "green" || (previousDay !== null && previousDay - day !== 86400000)) break;
      greenStreak += 1;
      previousDay = day;
    }
    res.json({ ok: true, latest: rows[0] || null, greenStreak, readyForCutover: greenStreak >= 7 });
  } catch (error) { next(error); }
});

export default router;
