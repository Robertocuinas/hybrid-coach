export const shorthands = undefined;

/* Los "origen" de documents / running_sessions / plan_modifications / routines son
   dominios de valores distintos (un paper no viene "de Strava", una rutina no se
   "regenera"). Un enum por tabla en vez de un enum origen compartido evita que la
   base de datos acepte una combinación que no tiene sentido. */
const ENUMS = [
  ["study_type", ["meta_analysis", "systematic_review", "rct", "observational", "position_statement", "narrative_review", "preprint"]],
  ["evidence_grade", ["fuerte", "moderada", "debil", "practica"]],
  ["population_type", ["runners", "strength_athletes", "general_population", "mixed"]],
  ["document_origen", ["semilla", "manual", "pdf"]],
  ["running_origen", ["manual", "strava"]],
  ["plan_modification_origen", ["usuario", "coach_ia", "regenerado"]],
  ["routine_origen", ["generada", "editada"]],
];

export async function up(pgm) {
  pgm.sql("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
  pgm.sql("CREATE EXTENSION IF NOT EXISTS vector;");

  for (const [nombre, valores] of ENUMS) {
    pgm.sql(`DO $$ BEGIN
      CREATE TYPE ${nombre} AS ENUM (${valores.map((v) => `'${v}'`).join(", ")});
    EXCEPTION WHEN duplicate_object THEN null; END $$;`);
  }

  pgm.sql(`CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text UNIQUE NOT NULL,
    password_hash text,
    role text NOT NULL DEFAULT 'athlete',
    created_at timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS athlete_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nombre text,
    edad int,
    sexo text,
    altura_cm int,
    peso_kg numeric,
    grasa_pct numeric,
    distancia_objetivo text,
    fecha_carrera date,
    meta_tipo text,
    meta_tiempo text,
    prioridades text[],
    exp_carrera text,
    km_semana int,
    sesiones_carrera int,
    tirada_larga_min int,
    ritmo_comodo text,
    paron text,
    superficie text[],
    exp_fuerza text,
    equipamiento text,
    cargas jsonb,
    tecnica text,
    estructural text[],
    cirugias text,
    banderas text[],
    momento_entreno text,
    cross_training text,
    horas_sueno numeric,
    calidad_sueno text,
    estres numeric,
    trabajo text,
    nutricion_objetivo text,
    suplementos text[],
    reloj text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS injuries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    zona text,
    recurrente boolean DEFAULT false,
    contexto text,
    activa boolean DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS training_plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    version int NOT NULL DEFAULT 1,
    distancia_objetivo text,
    fecha_carrera date,
    total_semanas int,
    taper_semanas int,
    run_dias int,
    gym_dias int,
    techo_tirada_larga_min int,
    riesgo_score numeric,
    riesgo_causas jsonb,
    activo boolean DEFAULT true,
    generado_en timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS training_weeks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    training_plan_id uuid NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
    numero_semana int NOT NULL,
    fase text,
    techo_tirada_larga_min int,
    es_deload boolean DEFAULT false,
    es_taper boolean DEFAULT false,
    checkpoint text,
    UNIQUE (training_plan_id, numero_semana)
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS planned_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    training_week_id uuid NOT NULL REFERENCES training_weeks(id) ON DELETE CASCADE,
    dia_semana int,
    codigo_sesion text,
    tipo text,
    descripcion text,
    duracion_min int,
    intensidad text
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS plan_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    training_plan_id uuid NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
    titulo text,
    justificacion text,
    fuente text,
    confianza text,
    estado text,
    sin_respaldo boolean DEFAULT false,
    invade_estructura boolean DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS plan_modifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    fecha date,
    semana int,
    plan_original jsonb,
    cambio jsonb,
    motivo text,
    origen plan_modification_origen,
    created_at timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS availability (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    vigente_desde date,
    dias int[],
    min_gym int,
    min_run int,
    min_finde int
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS completed_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    planned_session_id uuid REFERENCES planned_sessions(id) ON DELETE SET NULL,
    fecha date,
    tipo text,
    semana int,
    created_at timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS running_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    completed_session_id uuid NOT NULL REFERENCES completed_sessions(id) ON DELETE CASCADE,
    codigo_sesion text,
    distancia_km numeric,
    duracion_min int,
    ritmo numeric,
    fc_media numeric,
    fc_max numeric,
    desnivel numeric,
    cadencia numeric,
    rpe int,
    dolor int,
    notas text,
    origen running_origen,
    external_id text
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS strength_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    completed_session_id uuid NOT NULL REFERENCES completed_sessions(id) ON DELETE CASCADE,
    codigo_sesion text
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS strength_exercises (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre text NOT NULL,
    grupo_muscular text,
    patron text,
    incremento_kg_default numeric,
    athlete_profile_id uuid REFERENCES athlete_profiles(id) ON DELETE CASCADE
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS strength_sets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    strength_session_id uuid NOT NULL REFERENCES strength_sessions(id) ON DELETE CASCADE,
    strength_exercise_id uuid NOT NULL REFERENCES strength_exercises(id) ON DELETE CASCADE,
    orden int,
    peso_kg numeric,
    reps int,
    rir int,
    notas text,
    created_at timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS routines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    codigo_sesion text,
    orden int,
    strength_exercise_id uuid NOT NULL REFERENCES strength_exercises(id) ON DELETE CASCADE,
    series int,
    reps int,
    rir int,
    prioritario boolean DEFAULT false,
    nota text,
    origen routine_origen
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS recovery_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    fecha date,
    horas_sueno numeric,
    calidad_sueno numeric,
    fatiga numeric,
    agujetas numeric,
    estres numeric,
    motivacion numeric,
    dolor numeric
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS feedback_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    fecha date,
    semana int,
    rpe int,
    sensacion text,
    dolor numeric,
    zona_dolor text,
    tipo_dolor text,
    cuando_aparece text,
    energia numeric,
    comentario text,
    created_at timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo text,
    autores text,
    anio int,
    fuente_revista text,
    doi text UNIQUE,
    hash_archivo text UNIQUE,
    study_type study_type,
    evidence_grade evidence_grade,
    poblacion text,
    population_type population_type,
    sample_size int,
    tema_principal text,
    tags text[],
    resumen text,
    limites text,
    aplicacion_practica text,
    storage_key text,
    origen document_origen,
    revisado boolean DEFAULT false,
    subido_por uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS document_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index int,
    seccion text,
    pagina_inicio int,
    pagina_fin int,
    texto text,
    num_tokens int,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(texto, ''))) STORED
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS chunk_embeddings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_chunk_id uuid NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
    provider text,
    model text,
    dimensions int,
    embedding vector(1024),
    created_at timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS plan_decision_citations (
    plan_decision_id uuid NOT NULL REFERENCES plan_decisions(id) ON DELETE CASCADE,
    document_chunk_id uuid NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
    similarity_score real,
    rank int,
    PRIMARY KEY (plan_decision_id, document_chunk_id)
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS ai_recommendations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    origen text,
    tipo text,
    contenido jsonb,
    confianza text,
    estado text,
    provider text,
    model text,
    created_at timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    titulo text,
    resumen text,
    iniciada_en timestamptz,
    ultimo_mensaje_en timestamptz
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role text,
    contenido text,
    cambio_propuesto jsonb,
    citas uuid[],
    created_at timestamptz NOT NULL DEFAULT now()
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS nutrition_targets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    fecha date,
    semana int,
    sesiones int,
    min_entreno int,
    kcal numeric,
    proteina_g numeric,
    carbohidrato_g numeric,
    grasa_g numeric,
    fibra_g numeric,
    agua_l numeric,
    momento_entreno text,
    fijado_por_usuario boolean DEFAULT false,
    recortado_por_suelo boolean DEFAULT false
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS meal_catalog (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    categoria text,
    opcion text
  );`);

  pgm.sql(`CREATE TABLE IF NOT EXISTS strava_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    athlete_id_strava text,
    access_token text,
    refresh_token text,
    expires_at timestamptz,
    scope text,
    created_at timestamptz NOT NULL DEFAULT now()
  );`);

  /* Índices críticos: además de los que exige cada consulta concreta (documentados
     en 03-modelo-datos.md §10), toda tabla que cuelga de athlete_profile_id lleva un
     índice compuesto (athlete_profile_id, <columna temporal>) para listar "lo último
     de este atleta" sin escanear la tabla entera. Donde no hay created_at se usa la
     columna temporal real de la tabla (fecha, generado_en, vigente_desde...). */
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_athlete_profiles_user_id ON athlete_profiles(user_id);`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_injuries_profile_activa ON injuries(athlete_profile_id, activa);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_injuries_profile_created_at ON injuries(athlete_profile_id, created_at);`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_training_plans_profile_activo ON training_plans(athlete_profile_id, activo);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_training_plans_profile_generado_en ON training_plans(athlete_profile_id, generado_en);`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_training_weeks_plan_numero ON training_weeks(training_plan_id, numero_semana);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_planned_sessions_week_dia ON planned_sessions(training_week_id, dia_semana);`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_plan_modifications_profile_created_at ON plan_modifications(athlete_profile_id, created_at);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_availability_profile_vigente_desde ON availability(athlete_profile_id, vigente_desde);`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_completed_sessions_profile_fecha ON completed_sessions(athlete_profile_id, fecha DESC);`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_running_sessions_external_id ON running_sessions(external_id) WHERE external_id IS NOT NULL;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_strength_sets_exercise_created_at ON strength_sets(strength_exercise_id, created_at DESC);`);

  /* Un registro de recuperación por día y atleta: la app hace upsert sobre esta
     combinación, no un insert libre. */
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_logs_profile_fecha ON recovery_logs(athlete_profile_id, fecha);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_feedback_logs_profile_fecha ON feedback_logs(athlete_profile_id, fecha DESC);`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_documents_tags ON documents USING GIN(tags);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_document_chunks_doc_chunk ON document_chunks(document_id, chunk_index);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_document_chunks_tsv ON document_chunks USING GIN(tsv);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_hnsw ON chunk_embeddings USING hnsw (embedding vector_cosine_ops);`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_ai_recommendations_profile_created_at ON ai_recommendations(athlete_profile_id, created_at);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_conversations_profile_ultimo_mensaje ON conversations(athlete_profile_id, ultimo_mensaje_en DESC);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at);`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_nutrition_targets_profile_fecha ON nutrition_targets(athlete_profile_id, fecha);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_strava_connections_user_id ON strava_connections(user_id);`);
}

export async function down(pgm) {
  pgm.sql(`DROP TABLE IF EXISTS strava_connections;`);
  pgm.sql(`DROP TABLE IF EXISTS meal_catalog;`);
  pgm.sql(`DROP TABLE IF EXISTS nutrition_targets;`);
  pgm.sql(`DROP TABLE IF EXISTS messages;`);
  pgm.sql(`DROP TABLE IF EXISTS conversations;`);
  pgm.sql(`DROP TABLE IF EXISTS ai_recommendations;`);
  pgm.sql(`DROP TABLE IF EXISTS plan_decision_citations;`);
  pgm.sql(`DROP TABLE IF EXISTS chunk_embeddings;`);
  pgm.sql(`DROP TABLE IF EXISTS document_chunks;`);
  pgm.sql(`DROP TABLE IF EXISTS documents;`);
  pgm.sql(`DROP TABLE IF EXISTS feedback_logs;`);
  pgm.sql(`DROP TABLE IF EXISTS recovery_logs;`);
  pgm.sql(`DROP TABLE IF EXISTS routines;`);
  pgm.sql(`DROP TABLE IF EXISTS strength_sets;`);
  pgm.sql(`DROP TABLE IF EXISTS strength_exercises;`);
  pgm.sql(`DROP TABLE IF EXISTS strength_sessions;`);
  pgm.sql(`DROP TABLE IF EXISTS running_sessions;`);
  pgm.sql(`DROP TABLE IF EXISTS completed_sessions;`);
  pgm.sql(`DROP TABLE IF EXISTS availability;`);
  pgm.sql(`DROP TABLE IF EXISTS plan_modifications;`);
  pgm.sql(`DROP TABLE IF EXISTS plan_decisions;`);
  pgm.sql(`DROP TABLE IF EXISTS planned_sessions;`);
  pgm.sql(`DROP TABLE IF EXISTS training_weeks;`);
  pgm.sql(`DROP TABLE IF EXISTS training_plans;`);
  pgm.sql(`DROP TABLE IF EXISTS injuries;`);
  pgm.sql(`DROP TABLE IF EXISTS athlete_profiles;`);
  pgm.sql(`DROP TABLE IF EXISTS users;`);

  for (const [nombre] of ENUMS) {
    pgm.sql(`DROP TYPE IF EXISTS ${nombre};`);
  }

  pgm.sql(`DROP EXTENSION IF EXISTS vector;`);
}
