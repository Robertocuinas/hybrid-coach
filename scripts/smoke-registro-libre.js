/* Prueba end-to-end del registro libre contra el servidor local.

   Comprueba lo que de verdad importa del cambio de flexibilidad: que un
   entrenamiento que el plan NO preveía —código LIBRE, en un día de descanso,
   en una semana sin programar— sobrevive al viaje completo cliente → API →
   PostgreSQL → API, y vuelve intacto.

   No es un test unitario: habla con el servidor de verdad por HTTP. Se ejecuta
   a mano contra `npm run dev:db` + `npm start`, no en `npm test`.

   Uso:  node scripts/smoke-registro-libre.js [http://localhost:3000]
*/
const BASE = process.argv[2] || "http://localhost:3000";
const EMAIL = process.env.SMOKE_EMAIL || "audit@local.test";
const PASSWORD = process.env.SMOKE_PASSWORD || "AuditoriaLocal2026";

let cookie = "";

async function api(ruta, opciones = {}) {
  const r = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opciones.headers || {}),
    },
  });
  const recibida = r.headers.getSetCookie?.() || [];
  if (recibida.length) cookie = recibida.map((c) => c.split(";")[0]).join("; ");
  const texto = await r.text();
  let datos = {};
  try { datos = texto ? JSON.parse(texto) : {}; } catch { datos = { raw: texto.slice(0, 200) }; }
  return { status: r.status, datos };
}

const comprobar = (condicion, descripcion, extra = "") => {
  console.log(`${condicion ? "  ok  " : " FALLO"} ${descripcion}${extra ? ` — ${extra}` : ""}`);
  if (!condicion) process.exitCode = 1;
};

/* Plan de 4 semanas que arranca un lunes. La semana 2 se deja SIN programar a
   propósito: es justo el caso que antes no se podía registrar. */
const LUNES = "2026-08-10";
const plan = {
  totalSemanas: 4, taper: 1, runDias: 3, gymDias: 2, techo: 105,
  riesgo: { score: 2, causas: [] },
  gymCodes: ["GYM A", "GYM B"],
  semanas: Array.from({ length: 4 }, (_, i) => ({
    w: i + 1,
    inicio: new Date(Date.UTC(2026, 7, 10 + i * 7)).toISOString().slice(0, 10),
    fase: "carga", cp: null, gym: "carga", deload: false, taper: false,
    runs: { "RUN A": { t: 70, d: "Tirada larga" }, "RUN C": { t: 40, d: "Rodaje suave" } },
  })),
  decisiones: [], adaptaciones: [],
};

async function main() {
  console.log(`\nRegistro libre end-to-end contra ${BASE}\n`);

  const salud = await api("/health");
  comprobar(salud.datos.database === "ok", "el servidor y la base responden", `status=${salud.status}`);

  const login = await api("/api/auth/login", {
    method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  comprobar(login.status === 200, "sesión iniciada", `status=${login.status}`);
  if (login.status !== 200) return;

  /* El caso completo: un rodaje LIBRE el martes de la semana 1 (día que el
     plan deja de descanso) y una sesión de fuerza en la semana 2, que no está
     programada en absoluto. */
  const estado = {
    id: "p1", nombre: "Atleta de prueba", creado: LUNES,
    perfil: { nombre: "Atleta de prueba", distancia: "Media maratón", fechaCarrera: "2026-09-06", peso: 72, altura: 178, edad: 34 },
    plan,
    weeks: { 1: { assign: [{ day: 0, code: "GYM A" }, { day: 5, code: "RUN A" }], done: [] } },
    running: [
      { id: 1, date: "2026-08-11", source: "manual", session_code: "LIBRE", semana: 1,
        distancia_km: 8.2, duracion_min: 45, ritmo: "5:29", rpe: 6, dolor: 0, notas: "Salida improvisada, no estaba en el plan" },
      { id: 2, date: "2026-08-19", source: "manual", session_code: "RUN C", semana: 2,
        distancia_km: 6, duracion_min: 32, ritmo: "5:20", rpe: 4, dolor: 0, notas: "Semana sin programar" },
    ],
    strength: [
      { id: 3, date: "2026-08-20", semana: 2, session: "GYM B", exercise: "Sentadilla", set: 1, weight: 80, reps: 5, rir: 2, notes: "" },
    ],
    checkins: [{ date: "2026-08-11", rpe: 6, dolor: 0, energia: 4, semana: 1 }],
    recovery: [{ date: "2026-08-11", sueno: 7, fatiga: 4 }],
    changes: [], chat: [], rutinas: {}, ejercicios: {}, comidas: null,
  };

  const envio = await api("/api/sync", {
    method: "POST",
    body: JSON.stringify({
      operationId: `smoke-${Date.now()}`,
      snapshot: {
        profile: estado, profileLocalId: "p1",
        capturedAt: new Date().toISOString(),
        totals: { running: estado.running.length, strength: estado.strength.length, checkins: 1, recovery: 1 },
      },
    }),
  });
  comprobar(envio.status === 200 && envio.datos.ok, "el servidor acepta un estado con entrenamientos libres",
    `status=${envio.status} ${JSON.stringify(envio.datos).slice(0, 160)}`);

  const vuelta = await api("/api/sync-state");
  comprobar(vuelta.status === 200, "el estado se puede recuperar", `status=${vuelta.status}`);

  const devuelto = vuelta.datos.snapshot?.profile;
  comprobar(!!devuelto, "vuelve un perfil");
  if (!devuelto) return;

  const libre = (devuelto.running || []).find((r) => r.session_code === "LIBRE");
  comprobar(!!libre, "el entrenamiento LIBRE sobrevive al viaje completo");
  comprobar(libre?.date === "2026-08-11", "conserva su fecha (martes, día de descanso del plan)", libre?.date);
  comprobar(libre?.duracion_min === 45 && libre?.distancia_km === 8.2, "y sus datos",
    `${libre?.duracion_min} min / ${libre?.distancia_km} km`);

  const sinPlan = (devuelto.running || []).find((r) => r.date === "2026-08-19");
  comprobar(!!sinPlan, "se registra en una semana que ni siquiera está programada");

  const fuerza = (devuelto.strength || []).find((s) => s.session === "GYM B");
  comprobar(!!fuerza, "la fuerza fuera de plan también persiste", fuerza?.date);

  console.log(process.exitCode ? "\nHay fallos.\n" : "\nTodo correcto.\n");
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
