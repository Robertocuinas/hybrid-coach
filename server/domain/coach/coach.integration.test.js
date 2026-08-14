import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import * as documentsRepo from "../../db/repositories/documents.js";
import { NoopRerankProvider } from "../../ai/providers/rerank/noop.js";
import { buildContext } from "./context.js";
import { responder } from "./chat.js";
import { decisionesIA } from "./decisiones.js";
import { compactarSiHaceFalta, guardarMensaje, historialParaPrompt, obtenerOCrearConversacion } from "./conversacion.js";
import { listarDecisionesConCitas } from "../../db/repositories/trainingPlans.js";

const INDICE = { provider: "local", model: "test-model", dimensions: 1024 };
const CONFIG = { topKRetrieval: 25, topKFinal: 8, minResults: 3, minScore: 0.25, rrfK: 60, weightByGrade: false };
const HOY = new Date("2026-08-14T12:00:00Z");

const vectorDe = (similitud) => {
  const v = new Array(1024).fill(0);
  v[0] = similitud;
  v[1] = Math.sqrt(Math.max(0, 1 - similitud * similitud));
  return v;
};
const embeddingProvider = { embed: async (t) => ({ vectors: t.map(() => vectorDe(1)), dimensions: 1024 }), dimensions: () => 1024 };

const ESQUEMA = `
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TYPE study_type AS ENUM ('meta_analysis','systematic_review','rct','observational','position_statement','narrative_review','preprint');
  CREATE TYPE evidence_grade AS ENUM ('fuerte','moderada','debil','practica');
  CREATE TYPE population_type AS ENUM ('runners','strength_athletes','general_population','mixed');
  CREATE TABLE athlete_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text, edad int, sexo text,
    altura_cm int, peso_kg numeric, grasa_pct numeric, distancia_objetivo text, fecha_carrera date, meta_tipo text,
    meta_tiempo text, prioridades text[], exp_carrera text, km_semana int, sesiones_carrera int, tirada_larga_min int,
    paron text, exp_fuerza text, tecnica text, equipamiento text, cargas jsonb, estructural text[], cirugias text,
    horas_sueno numeric, calidad_sueno text, estres numeric, nutricion_objetivo text, suplementos text[], reloj text);
  CREATE TABLE injuries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid, zona text,
    recurrente boolean, contexto text, activa boolean DEFAULT true, created_at timestamptz DEFAULT now());
  CREATE TABLE availability (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid,
    vigente_desde date, dias int[], min_gym int, min_run int, min_finde int);
  CREATE TABLE training_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid,
    total_semanas int, taper_semanas int, run_dias int, gym_dias int, techo_tirada_larga_min int,
    riesgo_score numeric, riesgo_causas jsonb, fecha_carrera date, distancia_objetivo text,
    activo boolean DEFAULT true, generado_en timestamptz DEFAULT now());
  CREATE TABLE training_weeks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), training_plan_id uuid,
    numero_semana int, inicio date, fase text, techo_tirada_larga_min int, es_deload boolean,
    es_taper boolean, checkpoint text);
  CREATE TABLE planned_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), training_week_id uuid,
    dia_semana int, codigo_sesion text, tipo text, descripcion text, duracion_min int, intensidad text);
  CREATE TABLE weekly_plan_revisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), training_week_id uuid,
    revision int, status text, week_start date, week_end date);
  CREATE TABLE weekly_plan_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), weekly_plan_revision_id uuid,
    fecha date, codigo_sesion text, modality text, session_type text, titulo text, duracion_min int,
    intensity jsonb, priority text);
  CREATE TABLE plan_decisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), training_plan_id uuid,
    titulo text, justificacion text, fuente text, confianza text, estado text DEFAULT 'pendiente',
    sin_respaldo boolean DEFAULT false, invade_estructura boolean DEFAULT false, created_at timestamptz DEFAULT now());
  CREATE TABLE completed_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid,
    fecha date, tipo text, semana int, created_at timestamptz DEFAULT now());
  CREATE TABLE running_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), completed_session_id uuid,
    codigo_sesion text, distancia_km numeric, duracion_min int, rpe int, dolor int, notas text);
  CREATE TABLE strength_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), completed_session_id uuid, codigo_sesion text);
  CREATE TABLE strength_exercises (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text, athlete_profile_id uuid);
  CREATE TABLE strength_sets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), strength_session_id uuid,
    strength_exercise_id uuid, orden int, peso_kg numeric, reps int, rir int, created_at timestamptz DEFAULT now());
  CREATE TABLE feedback_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid, fecha date,
    semana int, rpe int, sensacion text, dolor numeric, zona_dolor text, tipo_dolor text, cuando_aparece text,
    energia numeric, comentario text);
  CREATE TABLE recovery_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid, fecha date,
    horas_sueno numeric, calidad_sueno numeric, fatiga numeric, agujetas numeric, estres numeric, motivacion numeric, dolor numeric);
  CREATE TABLE nutrition_targets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid, fecha date,
    kcal numeric, proteina_g numeric, carbohidrato_g numeric, grasa_g numeric, fibra_g numeric, agua_l numeric,
    momento_entreno text, fijado_por_usuario boolean, recortado_por_suelo boolean);
  CREATE TABLE documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), titulo text, autores text, anio int,
    fuente_revista text, doi text, study_type study_type, evidence_grade evidence_grade, poblacion text,
    population_type population_type, sample_size int, tema_principal text, tags text[], resumen text, limites text,
    aplicacion_practica text, storage_key text, origen text DEFAULT 'manual', revisado boolean DEFAULT true);
  CREATE TABLE document_chunks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index int, seccion text, pagina_inicio int, pagina_fin int, texto text, num_tokens int,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(texto,''))) STORED);
  CREATE TABLE chunk_embeddings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_chunk_id uuid REFERENCES document_chunks(id) ON DELETE CASCADE,
    provider text, model text, dimensions int, embedding vector(1024));
  CREATE TABLE plan_decision_citations (plan_decision_id uuid REFERENCES plan_decisions(id) ON DELETE CASCADE,
    document_chunk_id uuid REFERENCES document_chunks(id) ON DELETE CASCADE, similarity_score real, rank int,
    score_type text, es_relleno boolean NOT NULL DEFAULT false,
    PRIMARY KEY (plan_decision_id, document_chunk_id));
  CREATE TABLE ai_recommendations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid,
    origen text, tipo text, contenido jsonb, confianza text, estado text, provider text, model text,
    created_at timestamptz DEFAULT now());
  CREATE TABLE conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), athlete_profile_id uuid, titulo text,
    resumen text, iniciada_en timestamptz, ultimo_mensaje_en timestamptz);
  CREATE TABLE messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
    role text, contenido text, cambio_propuesto jsonb, citas uuid[], created_at timestamptz DEFAULT now());
`;

async function escenario() {
  const db = await PGlite.create({ extensions: { vector, pgcrypto } });
  await db.exec(ESQUEMA);

  const perfil = await db.query(
    `INSERT INTO athlete_profiles (nombre, edad, sexo, altura_cm, peso_kg, distancia_objetivo, fecha_carrera,
       meta_tipo, prioridades, exp_carrera, km_semana, exp_fuerza, horas_sueno, estres)
     VALUES ('Roberto',34,'Hombre',178,74,'Media maratón','2026-10-18','Terminar con un tiempo aproximado',
       ARRAY['Rendimiento en carrera','Masa muscular'],'1-3 años',28,'1-3 años',6.5,5) RETURNING id;`);
  const profileId = perfil.rows[0].id;

  await db.query(`INSERT INTO injuries (athlete_profile_id, zona, recurrente, contexto) VALUES ($1,'Tendón de Aquiles',true,'Carga crónica');`, [profileId]);
  const plan = await db.query(
    `INSERT INTO training_plans (athlete_profile_id, total_semanas, taper_semanas, run_dias, gym_dias,
       techo_tirada_larga_min, riesgo_score, riesgo_causas, activo)
     VALUES ($1,12,2,3,2,110,4,'["lesión recurrente en tendón de aquiles"]'::jsonb,true) RETURNING id;`, [profileId]);
  const planId = plan.rows[0].id;

  await db.query(`INSERT INTO availability (athlete_profile_id,vigente_desde,dias,min_gym,min_run,min_finde)
                  VALUES ($1,'2026-08-01',ARRAY[1,3,5],50,45,90);`, [profileId]);
  const week = await db.query(`INSERT INTO training_weeks
    (training_plan_id,numero_semana,inicio,fase,techo_tirada_larga_min,es_deload,es_taper,checkpoint)
    VALUES ($1,3,'2026-08-10','Base',110,false,false,'Mantener consistencia') RETURNING id;`, [planId]);
  await db.query(`INSERT INTO planned_sessions
    (training_week_id,dia_semana,codigo_sesion,tipo,descripcion,duracion_min,intensidad)
    VALUES ($1,5,'RUN A','run','Rodaje fácil',50,'facil');`, [week.rows[0].id]);
  await db.query(`INSERT INTO plan_decisions (training_plan_id,titulo,justificacion,fuente,confianza,estado)
    VALUES
      ($1,'Separación aceptada','Separar fuerza pesada y series 24 h','ia','alta','aceptada'),
      ($1,'Pendiente invisible','Todavía no fue aceptada','ia','media','pendiente'),
      ($1,'Rechazada invisible','El atleta la rechazó','ia','media','rechazada');`, [planId]);

  // Sesión reciente dentro de la ventana y otra fuera, para comprobar el recorte.
  const hoy = HOY;
  const hace = (d) => new Date(hoy.getTime() - d * 86400000).toISOString().slice(0, 10);
  for (const [dias, km] of [[2, 8.5], [5, 12], [40, 99]]) {
    const cs = await db.query(`INSERT INTO completed_sessions (athlete_profile_id, fecha, tipo, semana) VALUES ($1,$2,'run',3) RETURNING id;`, [profileId, hace(dias)]);
    await db.query(`INSERT INTO running_sessions (completed_session_id, codigo_sesion, distancia_km, duracion_min, rpe, dolor)
                    VALUES ($1,'RUN A',$2,50,5,1);`, [cs.rows[0].id, km]);
  }
  await db.query(`INSERT INTO feedback_logs (athlete_profile_id, fecha, rpe, dolor, zona_dolor, energia, comentario)
                  VALUES ($1,$2,6,3,'Sóleo',3,'cargado al empezar');`, [profileId, hace(1)]);

  const doc = await db.query(
    `INSERT INTO documents (titulo, autores, anio, study_type, evidence_grade, population_type, sample_size, tema_principal, revisado)
     VALUES ('Concurrent training: interference effect','Wilson, J. M. y cols.',2012,'meta_analysis','fuerte','runners',24,'Concurrente',true) RETURNING id;`);
  const chunks = [];
  for (const [i, [seccion, pagina, texto, sim]] of [
    ["discussion", 4, "Heavy strength work should be separated from interval running sessions by 24 hours.", 0.95],
    ["results", 6, "The interference effect was larger for running than for cycling.", 0.8],
  ].entries()) {
    const c = await db.query(
      `INSERT INTO document_chunks (document_id, chunk_index, seccion, pagina_inicio, pagina_fin, texto, num_tokens)
       VALUES ($1,$2,$3,$4,$4,$5,120) RETURNING id;`, [doc.rows[0].id, i, seccion, pagina, texto]);
    await db.query(`INSERT INTO chunk_embeddings (document_chunk_id, provider, model, dimensions, embedding)
                    VALUES ($1,$2,$3,1024,$4);`, [c.rows[0].id, INDICE.provider, INDICE.model, JSON.stringify(vectorDe(sim))]);
    chunks.push(c.rows[0].id);
  }

  return { db, profileId, planId, chunks };
}

const deps = (db, llmProvider) => ({
  db, repo: documentsRepo, llmProvider, embeddingProvider,
  rerankProvider: new NoopRerankProvider(), indice: INDICE, config: CONFIG, hoy: HOY,
});

const llmQueDevuelve = (texto) => ({
  call: async (peticion) => { llmQueDevuelve.ultima = peticion; return { text: texto, provider: "local", model: "test-model" }; },
});

test("buildContext arma bloques separados y solo con datos de la ventana", async () => {
  const { db, profileId } = await escenario();
  const { system, chunks } = await buildContext(profileId, "¿cuánto separar fuerza de series?", deps(db, null));

  for (const encabezado of ["DATOS DEL ATLETA", "ESTADO ACTUAL", "PLAN MAESTRO VIGENTE", "REGLAS DE DISTRIBUCIÓN", "EVIDENCIA RECUPERADA", "CÓMO RESPONDES"]) {
    assert.ok(system.includes(encabezado), `falta el bloque ${encabezado}`);
  }
  assert.ok(system.includes("Roberto"));
  assert.ok(system.includes("Tendón de Aquiles (recurrente)"));
  assert.ok(system.includes("Disponibilidad vigente"));
  assert.ok(system.includes("días 1, 3, 5"));
  assert.ok(system.includes("2026-08-15 RUN A 50min"), "el Coach recibe el calendario maestro persistido");
  assert.ok(system.includes("Separación aceptada"));
  assert.ok(!system.includes("Pendiente invisible"), "las decisiones pendientes no son reglas vigentes");
  assert.ok(!system.includes("Rechazada invisible"), "las decisiones rechazadas no son reglas vigentes");
  assert.ok(system.includes("8.5km"), "las carreras recientes deben estar");
  assert.ok(!system.includes("99km"), "una sesión de hace 40 días queda fuera de la ventana de 14");
  assert.ok(system.includes("no cambies objetivo, fecha, fases ni límites"), "el plan maestro se presenta como cerrado");
  assert.ok(chunks.length >= 1);
  assert.ok(system.includes(`[id:${chunks[0].id}]`), "los fragmentos van con su id citable");
  assert.ok(system.includes("pág. 4"));
  await db.close();
});

test("el coach responde citando y persiste la conversación con las citas", async () => {
  const { db, profileId, chunks } = await escenario();
  const llm = llmQueDevuelve(`Separa al menos 24 h [Wilson 2012, pág. 4]. Fragmento ${chunks[0]}.`);
  const salida = await responder(profileId, "¿por qué debo separar la fuerza de las series?", deps(db, llm));

  assert.equal(salida.hayEvidencia, true);
  assert.equal(salida.citas.length, 1, "solo se registra el fragmento realmente citado");
  assert.equal(salida.citas[0].paginaInicio, 4);
  assert.equal(salida.provider, "local");

  const mensajes = await db.query(`SELECT role, contenido, citas FROM messages ORDER BY created_at;`);
  assert.equal(mensajes.rows.length, 2);
  assert.equal(mensajes.rows[0].role, "user");
  assert.deepEqual(mensajes.rows[1].citas, [chunks[0]]);
  await db.close();
});

test("un cambio propuesto se valida y se registra en ai_recommendations", async () => {
  const { db, profileId, chunks } = await escenario();
  const llm = llmQueDevuelve(`Descansa hoy con respaldo del fragmento ${chunks[0]}.\n<<CAMBIO>>{"tipo":"descansar","dia":"jueves","de":"RUN B","a":"","motivo":"dolor 3/10"}<<FIN>>`);
  let linked = null;
  const salida = await responder(profileId, "me duele el sóleo", {
    ...deps(db, llm),
    onValidatedChange: async (request) => {
      linked = request;
      return { proposalId: "33333333-3333-4333-8333-333333333333", proposalRevision: 2, semana: 3 };
    },
  });

  assert.equal(salida.cambio.tipo, "descansar");
  assert.equal(salida.cambio.proposalRevision, 2);
  assert.equal(linked.cambio.tipo, "descansar", "el cambio validado se delega en el planificador semanal");
  assert.equal(salida.citas[0].id, chunks[0], "todo CAMBIO aceptado por el backend conserva una cita UUID entregada");
  assert.ok(!salida.texto.includes("<<CAMBIO>>"), "el bloque no se muestra al usuario");
  const rec = await db.query(`SELECT origen, tipo, provider, model FROM ai_recommendations;`);
  assert.deepEqual(rec.rows[0], { origen: "coach_chat", tipo: "descansar", provider: "local", model: "test-model" });
  const mensajes = await db.query(`SELECT citas,cambio_propuesto FROM messages WHERE role='assistant';`);
  assert.deepEqual(mensajes.rows[0].citas, [chunks[0]]);
  assert.equal(mensajes.rows[0].cambio_propuesto.proposalId, "33333333-3333-4333-8333-333333333333");
  await db.close();
});

test("sin evidencia y con pregunta que la pide, no se llama al modelo", async () => {
  const { db, profileId } = await escenario();
  let llamado = false;
  const llm = { call: async () => { llamado = true; return { text: "no debería llegar aquí" }; } };
  const salida = await responder(profileId, "¿qué evidencia hay sobre el protector solar en carrera?", {
    ...deps(db, llm), config: { ...CONFIG, minScore: 0.99 },
  });

  assert.equal(salida.hayEvidencia, false);
  assert.match(salida.texto, /No existe evidencia suficiente/);
  assert.equal(llamado, false, "el umbral se comprueba ANTES de gastar una llamada");
  await db.close();
});

test("decisionesIA valida las citas y las persiste con score y rank", async () => {
  const { db, profileId, planId, chunks } = await escenario();
  const llm = llmQueDevuelve(JSON.stringify({
    decisiones: [
      { t: "Separar fuerza pesada de series", p: "Con historial de Aquiles conviene 24 h [Wilson 2012, pág. 4].", refs: [chunks[0], chunks[1]], confianza: "alta" },
      { t: "Decisión inventada", p: "Esto lo dice un paper que no existe.", refs: ["44444444-4444-4444-8444-444444444444"], confianza: "alta" },
    ],
    ajustes: [{ campo: "rir", valor: "RIR 3 en pierna", motivo: "proteger el tendón" }],
    evidencia_mixta: [],
    sin_respaldo: [],
  }));

  const salida = await decisionesIA(profileId, deps(db, llm));
  assert.equal(salida.hayEvidencia, true);
  assert.equal(salida.decisiones.length, 2);
  assert.deepEqual(salida.decisiones[0].refs, [chunks[0], chunks[1]]);
  assert.deepEqual(salida.decisiones[1].refs, [], "la cita inventada se descarta");
  assert.equal(salida.decisiones[1].sinRespaldo, true);
  assert.equal(salida.persistido.citas, 2);

  const guardadas = await listarDecisionesConCitas(planId, db);
  const conCitas = guardadas.find((d) => d.titulo === "Separar fuerza pesada de series");
  assert.equal(conCitas.citas.length, 2);
  assert.equal(conCitas.citas[0].rank, 1);
  assert.equal(conCitas.citas[0].paginaInicio, 4);
  assert.ok(conCitas.citas[0].similarityScore > 0);
  assert.equal(conCitas.citas[0].scoreType, "coseno");
  assert.equal(conCitas.citas[0].relleno, false);
  assert.equal(conCitas.citas[0].texto.includes("Heavy strength"), true);
  assert.equal(conCitas.citas[0].studyType, "meta_analysis");

  const rec = await db.query(`SELECT provider, model FROM ai_recommendations;`);
  assert.deepEqual(rec.rows[0], { provider: "local", model: "test-model" });
  await db.close();
});

test("una conversación larga se resume y conserva los últimos turnos literales", async () => {
  const { db, profileId } = await escenario();
  const conversacion = await obtenerOCrearConversacion(profileId, { db });
  for (let i = 0; i < 34; i++) {
    await guardarMensaje(conversacion.id, { role: i % 2 ? "assistant" : "user", contenido: `mensaje número ${i}` }, db);
  }

  const llm = llmQueDevuelve("El atleta arrastra molestias en el sóleo y aceptó mover la sesión del jueves.");
  const resultado = await compactarSiHaceFalta(conversacion.id, { db, llmProvider: llm, umbral: 30, literales: 12 });

  assert.equal(resultado.compactado, true);
  assert.equal(resultado.resumidos, 22);
  const restantes = await db.query(`SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1;`, [conversacion.id]);
  assert.equal(restantes.rows[0].n, 12, "los últimos 12 turnos siguen literales");

  const historial = await historialParaPrompt(conversacion.id, { db });
  assert.equal(historial.length, 13, "resumen + 12 literales");
  assert.match(historial[0].content, /RESUMEN DE LO HABLADO ANTES/);
  assert.match(historial[historial.length - 1].content, /mensaje número 33/);
  await db.close();
});

test("por debajo del umbral no se resume nada", async () => {
  const { db, profileId } = await escenario();
  const conversacion = await obtenerOCrearConversacion(profileId, { db });
  for (let i = 0; i < 10; i++) await guardarMensaje(conversacion.id, { role: "user", contenido: `m${i}` }, db);
  const resultado = await compactarSiHaceFalta(conversacion.id, { db, llmProvider: llmQueDevuelve("x"), umbral: 30 });
  assert.equal(resultado.compactado, false);
  await db.close();
});
