/* Paso 05 — verificación. Los checks de docs/06-migracion.md §7 en un solo
   comando, con reporte ROJO/VERDE. Sale con código 1 si algo falla, para que
   sirva en CI o encadenado con &&.

   Compara el fichero transformado (lo que se pretendía cargar) contra lo que
   hay REALMENTE en la base de datos. Los totales de origen declarados a mano
   en migration/TOTALES-ORIGEN.md se comprueban aparte, al final, si están
   rellenos: son la única defensa contra un error en el propio paso 03. */
import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { TRANSFORMED_FILE, ROOT, readJson } from "./lib/util.js";

const VERDE = "\x1b[32m", ROJO = "\x1b[31m", AMARILLO = "\x1b[33m", GRIS = "\x1b[90m", RESET = "\x1b[0m", NEGRITA = "\x1b[1m";

const checks = [];
function check(nombre, esperado, real, nota = null) {
  const ok = JSON.stringify(esperado) === JSON.stringify(real);
  checks.push({ nombre, esperado, real, ok, nota });
}

const num = (r) => Number(r.rows[0].v);
const round2 = (n) => Math.round(Number(n) * 100) / 100;

/* Los totales declarados a mano en TOTALES-ORIGEN.md siguen el formato
   "- Nº de sesiones: 128". Se leen si están rellenos; "(pendiente)" se ignora. */
async function leerTotalesOrigen() {
  const file = path.join(ROOT, "migration", "TOTALES-ORIGEN.md");
  let texto;
  try { texto = await fs.readFile(file, "utf8"); } catch { return null; }
  const leer = (etiqueta) => {
    const m = texto.match(new RegExp(`- ${etiqueta}:\\s*(.+)`, "i"));
    if (!m) return null;
    const valor = m[1].trim();
    if (/pendiente/i.test(valor)) return null;
    const n = Number(valor.replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : valor;
  };
  return {
    running_count: leer("N\\u00ba de sesiones"),
    running_km: leer("Suma de km"),
    sets_count: leer("N\\u00ba de series"),
    sets_kg: leer("Suma de kg movidos \\(peso × reps\\)"),
    checkins: leer("N\\u00ba de check-ins"),
    recovery: leer("N\\u00ba de registros de recuperaci\\u00f3n"),
    documents: leer("N\\u00ba de referencias"),
  };
}

export async function run() {
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL.");
  const data = await readJson(TRANSFORMED_FILE);
  const esLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: esLocal ? false : { rejectUnauthorized: false } });
  await client.connect();

  try {
    // --- Recuentos por tabla ---
    check("Perfiles: nº de filas", data.athlete_profiles.length, num(await client.query("SELECT COUNT(*) v FROM athlete_profiles")));
    check("Lesiones: nº de filas", data.injuries.length, num(await client.query("SELECT COUNT(*) v FROM injuries")));
    check("Sesiones completadas: nº de filas", data.completed_sessions.length, num(await client.query("SELECT COUNT(*) v FROM completed_sessions")));
    check("Carreras: nº de sesiones", data.running_sessions.length, num(await client.query("SELECT COUNT(*) v FROM running_sessions")));
    check("Fuerza: nº de sesiones", data.strength_sessions.length, num(await client.query("SELECT COUNT(*) v FROM strength_sessions")));
    check("Fuerza: nº de series", data.strength_sets.length, num(await client.query("SELECT COUNT(*) v FROM strength_sets")));
    check("Ejercicios: nº de filas", data.strength_exercises.length, num(await client.query("SELECT COUNT(*) v FROM strength_exercises")));
    check("Check-ins: nº de filas", data.feedback_logs.length, num(await client.query("SELECT COUNT(*) v FROM feedback_logs")));
    check("Recuperación: nº de filas", data.recovery_logs.length, num(await client.query("SELECT COUNT(*) v FROM recovery_logs")));
    check("Cambios de plan: nº de filas", data.plan_modifications.length, num(await client.query("SELECT COUNT(*) v FROM plan_modifications")));
    check("Bibliografía: nº de referencias", data.documents.length, num(await client.query("SELECT COUNT(*) v FROM documents")));
    check("Catálogo de comidas: nº de filas", data.meal_catalog.length, num(await client.query("SELECT COUNT(*) v FROM meal_catalog")));
    check("Mensajes de chat: nº de filas", data.messages.length, num(await client.query("SELECT COUNT(*) v FROM messages")));

    // --- Checksums: lo que de verdad detecta pérdida silenciosa ---
    check(
      "Suma de km corridos",
      round2(data.running_sessions.reduce((s, r) => s + (r.distancia_km || 0), 0)),
      round2(num(await client.query("SELECT COALESCE(SUM(distancia_km),0) v FROM running_sessions")))
    );
    check(
      "Suma de kg movidos (peso × reps)",
      round2(data.strength_sets.reduce((s, r) => s + (r.peso_kg || 0) * (r.reps || 0), 0)),
      round2(num(await client.query("SELECT COALESCE(SUM(peso_kg * reps),0) v FROM strength_sets")))
    );

    // --- Rango de fechas ---
    const fechasEsperadas = data.completed_sessions.map((c) => c.fecha).filter(Boolean).sort();
    const { rows: [rango] } = await client.query(
      "SELECT to_char(MIN(fecha),'YYYY-MM-DD') min, to_char(MAX(fecha),'YYYY-MM-DD') max FROM completed_sessions"
    );
    check("Primera sesión registrada", fechasEsperadas[0] ?? null, rango.min);
    check("Última sesión registrada", fechasEsperadas[fechasEsperadas.length - 1] ?? null, rango.max);

    // --- Integridad relacional ---
    check(
      "Cada perfil tiene exactamente un plan activo",
      data.training_plans.length,
      num(await client.query(`SELECT COUNT(*) v FROM (
        SELECT athlete_profile_id FROM training_plans WHERE activo = true
        GROUP BY athlete_profile_id HAVING COUNT(*) = 1) t`))
    );
    check("Ninguna serie huérfana (sin sesión o sin ejercicio)", 0,
      num(await client.query(`SELECT COUNT(*) v FROM strength_sets s
        LEFT JOIN strength_sessions ss ON ss.id = s.strength_session_id
        LEFT JOIN strength_exercises se ON se.id = s.strength_exercise_id
        WHERE ss.id IS NULL OR se.id IS NULL`)));
    check("Ninguna sesión de carrera huérfana", 0,
      num(await client.query(`SELECT COUNT(*) v FROM running_sessions r
        LEFT JOIN completed_sessions c ON c.id = r.completed_session_id WHERE c.id IS NULL`)));
    check("Ningún perfil sin usuario propietario", 0,
      num(await client.query(`SELECT COUNT(*) v FROM athlete_profiles p
        LEFT JOIN users u ON u.id = p.user_id WHERE u.id IS NULL`)));
    check("Ningún registro de recuperación duplicado por día", 0,
      num(await client.query(`SELECT COUNT(*) v FROM (
        SELECT athlete_profile_id, fecha FROM recovery_logs
        GROUP BY athlete_profile_id, fecha HAVING COUNT(*) > 1) t`)));
    check("Ninguna actividad de Strava duplicada", 0,
      num(await client.query(`SELECT COUNT(*) v FROM (
        SELECT external_id FROM running_sessions WHERE external_id IS NOT NULL
        GROUP BY external_id HAVING COUNT(*) > 1) t`)));
    check("Trazabilidad: legacy_id_map poblado", data.legacy_id_map.length,
      num(await client.query("SELECT COUNT(*) v FROM legacy_id_map")));

    // --- Contraste con los totales declarados a mano en la Fase 0 ---
    const origen = await leerTotalesOrigen();
    const declarados = origen ? Object.values(origen).filter((v) => v !== null).length : 0;
    if (declarados) {
      if (origen.running_count !== null) check("[origen] Nº de carreras vs TOTALES-ORIGEN.md", origen.running_count, num(await client.query("SELECT COUNT(*) v FROM running_sessions")));
      if (origen.running_km !== null) check("[origen] Suma de km vs TOTALES-ORIGEN.md", round2(origen.running_km), round2(num(await client.query("SELECT COALESCE(SUM(distancia_km),0) v FROM running_sessions"))));
      if (origen.sets_count !== null) check("[origen] Nº de series vs TOTALES-ORIGEN.md", origen.sets_count, num(await client.query("SELECT COUNT(*) v FROM strength_sets")));
      if (origen.sets_kg !== null) check("[origen] Suma de kg vs TOTALES-ORIGEN.md", round2(origen.sets_kg), round2(num(await client.query("SELECT COALESCE(SUM(peso_kg * reps),0) v FROM strength_sets"))));
      if (origen.checkins !== null) check("[origen] Nº de check-ins vs TOTALES-ORIGEN.md", origen.checkins, num(await client.query("SELECT COUNT(*) v FROM feedback_logs")));
      if (origen.recovery !== null) check("[origen] Nº de recuperación vs TOTALES-ORIGEN.md", origen.recovery, num(await client.query("SELECT COUNT(*) v FROM recovery_logs")));
      if (origen.documents !== null) check("[origen] Nº de referencias vs TOTALES-ORIGEN.md", origen.documents, num(await client.query("SELECT COUNT(*) v FROM documents")));
    }

    // --- Reporte ---
    const fallos = checks.filter((c) => !c.ok);
    const ancho = Math.max(...checks.map((c) => c.nombre.length)) + 2;
    console.log(`\n${NEGRITA}VERIFICACIÓN DE LA MIGRACIÓN${RESET}`);
    console.log(`${GRIS}${"─".repeat(ancho + 34)}${RESET}`);
    for (const c of checks) {
      const marca = c.ok ? `${VERDE}✓ VERDE${RESET}` : `${ROJO}✗ ROJO ${RESET}`;
      const detalle = c.ok ? `${GRIS}${JSON.stringify(c.real)}${RESET}` : `${ROJO}esperado ${JSON.stringify(c.esperado)}, real ${JSON.stringify(c.real)}${RESET}`;
      console.log(`${marca}  ${c.nombre.padEnd(ancho)} ${detalle}`);
    }
    console.log(`${GRIS}${"─".repeat(ancho + 34)}${RESET}`);

    if (!declarados) {
      console.log(`${AMARILLO}⚠  migration/TOTALES-ORIGEN.md no tiene totales rellenos.${RESET}`);
      console.log(`${GRIS}   Los checks comparan el fichero transformado contra la base de datos,${RESET}`);
      console.log(`${GRIS}   pero no contra los números que contaste a mano en la Fase 0. Rellénalo${RESET}`);
      console.log(`${GRIS}   para cerrar el círculo: es lo único que detecta un error del paso 03.${RESET}`);
    }

    const rechazadosFile = path.join(path.dirname(TRANSFORMED_FILE), "rechazados.json");
    try {
      const rech = await readJson(rechazadosFile);
      if (rech.length) console.log(`${AMARILLO}⚠  ${rech.length} fila(s) rechazadas en el paso 03 → ${rechazadosFile}${RESET}`);
    } catch { /* no hay rechazos */ }

    if (fallos.length) {
      console.log(`\n${ROJO}${NEGRITA}MIGRACIÓN EN ROJO — ${fallos.length} de ${checks.length} checks han fallado.${RESET}`);
      console.log(`${ROJO}No des la migración por buena.${RESET}\n`);
      process.exitCode = 1;
      return { ok: false, fallos: fallos.length, total: checks.length };
    }

    console.log(`\n${VERDE}${NEGRITA}MIGRACIÓN EN VERDE — ${checks.length}/${checks.length} checks correctos.${RESET}`);
    console.log(`${GRIS}Falta el único check que no se puede automatizar: abrir la app y comparar${RESET}`);
    console.log(`${GRIS}pantalla a pantalla con la versión de localStorage (docs/06-migracion.md §7).${RESET}\n`);
    return { ok: true, fallos: 0, total: checks.length };
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
