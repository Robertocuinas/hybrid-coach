const profileTables = [
  "injuries", "availability", "training_plans", "plan_modifications", "completed_sessions",
  "recovery_logs", "feedback_logs", "routines", "ai_recommendations", "conversations",
  "nutrition_targets", "meal_catalog", "client_state_snapshots", "reconciliation_runs",
  "planning_runs", "weekly_plan_revisions", "plan_change_proposals",
];

export async function exportUserData(userId, db) {
  const accountResult = await db.query(
    `SELECT id,email,role,created_at FROM users WHERE id=$1`, [userId]
  );
  if (!accountResult.rows[0]) return null;
  const profilesResult = await db.query(
    `SELECT * FROM athlete_profiles WHERE user_id=$1 ORDER BY created_at`, [userId]
  );
  const profileIds = profilesResult.rows.map((profile) => profile.id);
  const data = { account: accountResult.rows[0], profiles: profilesResult.rows };

  for (const table of profileTables) {
    const result = profileIds.length
      ? await db.query(`SELECT * FROM ${table} WHERE athlete_profile_id=ANY($1::uuid[])`, [profileIds])
      : { rows: [] };
    data[table] = result.rows;
  }

  const planIds = data.training_plans.map((row) => row.id);
  data.training_weeks = planIds.length
    ? (await db.query(`SELECT * FROM training_weeks WHERE training_plan_id=ANY($1::uuid[])`, [planIds])).rows : [];
  const weekIds = data.training_weeks.map((row) => row.id);
  data.planned_sessions = weekIds.length
    ? (await db.query(`SELECT * FROM planned_sessions WHERE training_week_id=ANY($1::uuid[])`, [weekIds])).rows : [];
  data.plan_decisions = planIds.length
    ? (await db.query(`SELECT * FROM plan_decisions WHERE training_plan_id=ANY($1::uuid[])`, [planIds])).rows : [];
  const decisionIds = data.plan_decisions.map((row) => row.id);
  data.plan_decision_citations = decisionIds.length
    ? (await db.query(`SELECT * FROM plan_decision_citations WHERE plan_decision_id=ANY($1::uuid[])`, [decisionIds])).rows : [];

  /* Las tablas hijas del planificador no llevan athlete_profile_id. Se recorren
     únicamente desde padres ya filtrados por los perfiles de la cuenta para que
     una FK inconsistente nunca convierta la exportación en una fuga entre usuarios. */
  const weeklyRevisionIds = data.weekly_plan_revisions.map((row) => row.id);
  data.weekly_plan_sessions = weeklyRevisionIds.length
    ? (await db.query(
        `SELECT * FROM weekly_plan_sessions WHERE weekly_plan_revision_id=ANY($1::uuid[])`,
        [weeklyRevisionIds],
      )).rows
    : [];

  const planningRunIds = data.planning_runs.map((row) => row.id);
  data.planning_run_evidence = planningRunIds.length
    ? (await db.query(
        `SELECT * FROM planning_run_evidence WHERE planning_run_id=ANY($1::uuid[])`,
        [planningRunIds],
      )).rows
    : [];
  data.guardrail_results = planningRunIds.length
    ? (await db.query(
        `SELECT * FROM guardrail_results WHERE planning_run_id=ANY($1::uuid[])`,
        [planningRunIds],
      )).rows
    : [];

  const completedIds = data.completed_sessions.map((row) => row.id);
  data.running_sessions = completedIds.length
    ? (await db.query(`SELECT * FROM running_sessions WHERE completed_session_id=ANY($1::uuid[])`, [completedIds])).rows : [];
  data.strength_sessions = completedIds.length
    ? (await db.query(`SELECT * FROM strength_sessions WHERE completed_session_id=ANY($1::uuid[])`, [completedIds])).rows : [];
  const strengthSessionIds = data.strength_sessions.map((row) => row.id);
  data.strength_sets = strengthSessionIds.length
    ? (await db.query(`SELECT * FROM strength_sets WHERE strength_session_id=ANY($1::uuid[])`, [strengthSessionIds])).rows : [];
  const exerciseIds = new Set([
    ...data.strength_sets.map((row) => row.strength_exercise_id),
    ...data.routines.map((row) => row.strength_exercise_id),
  ].filter(Boolean));
  data.strength_exercises = exerciseIds.size
    ? (await db.query(`SELECT * FROM strength_exercises WHERE id=ANY($1::uuid[])`, [[...exerciseIds]])).rows : [];

  const conversationIds = data.conversations.map((row) => row.id);
  data.messages = conversationIds.length
    ? (await db.query(`SELECT * FROM messages WHERE conversation_id=ANY($1::uuid[]) ORDER BY created_at`, [conversationIds])).rows : [];
  data.sync_operations = (await db.query(`SELECT operation_id,athlete_profile_id,applied_at
    FROM sync_operations WHERE user_id=$1 ORDER BY applied_at`, [userId])).rows;

  return { exportedAt: new Date().toISOString(), ...data };
}
