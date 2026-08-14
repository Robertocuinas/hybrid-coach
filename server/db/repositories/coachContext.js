/* Lectura del contexto del atleta para el coach (Fase 8).

   Principio: NUNCA se piden datos que el prompt no vaya a usar. Cada columna
   que se trae acaba en el contexto del modelo, y todo lo que va al contexto se
   paga en tokens y diluye la atención. Por eso hay ventanas explícitas
   (7-14 días, últimas N) y no un SELECT * de todo el historial.

   Son datos de salud: nada de esto se registra en logs (CLAUDE.md §4.8). */
import { pool } from "./_helpers.js";

export const VENTANA_DIAS = 14;

export async function cargarContexto(profileId, { db = pool, dias = VENTANA_DIAS, hoy = new Date() } = {}) {
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - dias);
  const desdeISO = desde.toISOString().slice(0, 10);

  const [perfil, lesiones, plan, disponibilidad, planificadas, sesiones, checkins, recuperacion, cargas, nutricion] = await Promise.all([
    unaFila(db, `SELECT nombre, edad, sexo, altura_cm, peso_kg, grasa_pct, distancia_objetivo, fecha_carrera,
                        meta_tipo, meta_tiempo, prioridades, exp_carrera, km_semana, sesiones_carrera,
                        tirada_larga_min, paron, exp_fuerza, tecnica, equipamiento, cargas, estructural,
                        cirugias, horas_sueno, calidad_sueno, estres, nutricion_objetivo, suplementos, reloj
                   FROM athlete_profiles WHERE id = $1;`, [profileId]),

    filas(db, `SELECT zona, recurrente, contexto FROM injuries
                WHERE athlete_profile_id = $1 AND activa = true ORDER BY recurrente DESC;`, [profileId]),

    unaFila(db, `SELECT id, total_semanas, taper_semanas, run_dias, gym_dias, techo_tirada_larga_min,
                        riesgo_score, riesgo_causas, fecha_carrera, distancia_objetivo
                   FROM training_plans
                  WHERE athlete_profile_id = $1 AND activo = true
                  ORDER BY generado_en DESC LIMIT 1;`, [profileId]),

    unaFila(db, `SELECT vigente_desde,dias,min_gym,min_run,min_finde
                   FROM availability WHERE athlete_profile_id=$1
                  ORDER BY vigente_desde DESC NULLS LAST,id DESC LIMIT 1;`, [profileId]),

    /* Calendario real de ayer a los próximos siete días. Si existe una
       revisión IA aceptada manda sobre los slots del plan maestro. */
    filas(db, `WITH active_plan AS (
                 SELECT id FROM training_plans WHERE athlete_profile_id=$1 AND activo=true
                 ORDER BY generado_en DESC LIMIT 1
               ), accepted AS (
                 SELECT wps.fecha,wps.codigo_sesion,wps.modality AS tipo,wps.session_type,
                        wps.titulo,wps.duracion_min,wps.intensity,wps.priority
                   FROM training_weeks tw
                   JOIN active_plan ap ON ap.id=tw.training_plan_id
                   JOIN weekly_plan_revisions wpr ON wpr.training_week_id=tw.id AND wpr.status='accepted'
                   JOIN weekly_plan_sessions wps ON wps.weekly_plan_revision_id=wpr.id
                  WHERE wps.fecha BETWEEN ($2::date - 1) AND ($2::date + 7)
               ), master AS (
                 SELECT (tw.inicio + ps.dia_semana)::date AS fecha,ps.codigo_sesion,ps.tipo,
                        NULL::text AS session_type,ps.codigo_sesion AS titulo,ps.duracion_min,
                        jsonb_build_object('label',ps.intensidad) AS intensity,NULL::text AS priority
                   FROM training_weeks tw
                   JOIN active_plan ap ON ap.id=tw.training_plan_id
                   JOIN planned_sessions ps ON ps.training_week_id=tw.id
                  WHERE ps.dia_semana IS NOT NULL
                    AND (tw.inicio + ps.dia_semana) BETWEEN ($2::date - 1) AND ($2::date + 7)
                    AND NOT EXISTS (
                      SELECT 1 FROM weekly_plan_revisions active_revision
                       WHERE active_revision.training_week_id=tw.id
                         AND active_revision.status='accepted'
                    )
               )
               SELECT * FROM accepted UNION ALL SELECT * FROM master ORDER BY fecha;`, [profileId, hoy.toISOString().slice(0, 10)]),

    /* Sesiones de la ventana, con el detalle de carrera. Se ordena descendente
       porque lo reciente es lo que más pesa al responder. */
    filas(db, `SELECT cs.fecha, cs.tipo, cs.semana,
                      rs.codigo_sesion, rs.distancia_km, rs.duracion_min, rs.rpe, rs.dolor, rs.notas,
                      ss.codigo_sesion AS gym_codigo
                 FROM completed_sessions cs
                 LEFT JOIN running_sessions rs ON rs.completed_session_id = cs.id
                 LEFT JOIN strength_sessions ss ON ss.completed_session_id = cs.id
                WHERE cs.athlete_profile_id = $1 AND cs.fecha >= $2
                ORDER BY cs.fecha DESC LIMIT 40;`, [profileId, desdeISO]),

    filas(db, `SELECT fecha, rpe, sensacion, dolor, zona_dolor, tipo_dolor, cuando_aparece, energia, comentario
                 FROM feedback_logs WHERE athlete_profile_id = $1 AND fecha >= $2
                ORDER BY fecha DESC LIMIT 8;`, [profileId, desdeISO]),

    filas(db, `SELECT fecha, horas_sueno, calidad_sueno, fatiga, agujetas, estres, motivacion, dolor
                 FROM recovery_logs WHERE athlete_profile_id = $1 AND fecha >= $2
                ORDER BY fecha DESC LIMIT 8;`, [profileId, desdeISO]),

    /* Última serie de cada ejercicio: es lo que necesita la progresión de
       carga. DISTINCT ON evita traerse el historial entero para quedarse con
       la última fila de cada uno. */
    filas(db, `SELECT DISTINCT ON (e.nombre) e.nombre, ss2.peso_kg, ss2.reps, ss2.rir, cs.fecha
                 FROM strength_sets ss2
                 JOIN strength_exercises e ON e.id = ss2.strength_exercise_id
                 JOIN strength_sessions s ON s.id = ss2.strength_session_id
                 JOIN completed_sessions cs ON cs.id = s.completed_session_id
                WHERE cs.athlete_profile_id = $1
                ORDER BY e.nombre, cs.fecha DESC, ss2.created_at DESC;`, [profileId]),

    unaFila(db, `SELECT fecha, kcal, proteina_g, carbohidrato_g, grasa_g, fibra_g, agua_l,
                        momento_entreno, fijado_por_usuario, recortado_por_suelo
                   FROM nutrition_targets WHERE athlete_profile_id = $1
                  ORDER BY fecha DESC LIMIT 1;`, [profileId]),
  ]);

  const decisiones = plan
    ? await filas(db, `SELECT titulo, justificacion, fuente, confianza
                         FROM plan_decisions
                        WHERE training_plan_id = $1 AND estado = 'aceptada'
                        ORDER BY created_at LIMIT 12;`, [plan.id])
    : [];

  return { perfil, lesiones, plan, disponibilidad, planificadas, decisiones, sesiones, checkins, recuperacion, cargas, nutricion, ventanaDias: dias };
}

async function unaFila(db, sql, params) {
  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}

async function filas(db, sql, params) {
  const { rows } = await db.query(sql, params);
  return rows;
}
