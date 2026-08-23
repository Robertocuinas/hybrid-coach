#!/usr/bin/env bash
# Smoke end-to-end contra el servidor local: comprueba que la regla de producto
# "el plan recomienda, nunca excluye" sobrevive el viaje completo
# cliente -> API -> PostgreSQL -> API. No simula nada: usa HTTP real.
#
# Dos cosas que cuestan un rato descubrir si no se documentan:
#  1. La API exige la cabecera Origin (proteccion CSRF en middleware/security.js).
#     Sin ella responde 403 "Falta el origen de la peticion" y parece un fallo
#     de la funcionalidad cuando en realidad es el cliente el que esta mal.
#  2. El cuerpo va en camelCase (codigoSesion, distanciaKm, duracionMin),
#     no en snake_case como las columnas de la base de datos.
#
#   BASE=https://helpful-endurance-staging.up.railway.app bash scripts/smoke-registro-libre.sh
set -u
BASE="${BASE:-http://localhost:3000}"
EMAIL="${EMAIL:-prueba@local.test}"
PASSWORD="${PASSWORD:-PruebaLocal2026!}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

H_ORIGIN="Origin: $BASE"
H_JSON="Content-Type: application/json"

ok=0; fallo=0
comprobar() {
  # $1 = descripcion, $2 = obtenido, $3 = esperado
  if [ "$2" = "$3" ]; then
    echo "  OK    $1"
    ok=$((ok+1))
  else
    echo "  FALLO $1 -> obtenido '$2', esperado '$3'"
    fallo=$((fallo+1))
  fi
}
post() { curl -s -m 30 -b "$JAR" -H "$H_JSON" -H "$H_ORIGIN" -X POST "$BASE$1" -d "$2"; }
get()  { curl -s -m 30 -b "$JAR" -H "$H_ORIGIN" "$BASE$1"; }
tiene_ok() { echo "$1" | grep -o '"ok":true' | head -1; }

echo "Objetivo: $BASE"
echo "=== 1. Login ==="
LOGIN=$(curl -s -m 30 -c "$JAR" -H "$H_JSON" -H "$H_ORIGIN" -X POST "$BASE/api/auth/login" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
comprobar "login devuelve ok" "$(tiene_ok "$LOGIN")" '"ok":true'

echo "=== 2. Perfil activo ==="
comprobar "hay perfil activo" "$(tiene_ok "$(get /api/profile)")" '"ok":true'

echo "=== 3. Carrera LIBRE en fecha sin plan (la regla de producto) ==="
# Fecha deliberadamente lejana: no hay plan, no hay semana generada, no hay
# sesion programada. Antes esto era sencillamente imposible de registrar.
LIBRE=$(post /api/sessions/running \
  '{"fecha":"2026-12-25","codigoSesion":"LIBRE","distanciaKm":7.4,"duracionMin":41,"rpe":6,"notas":"smoke: dia sin plan"}')
comprobar "acepta carrera LIBRE sin plan" "$(tiene_ok "$LIBRE")" '"ok":true'

echo "=== 4. Carrera solo con distancia, SIN duracion ==="
# La duracion era obligatoria: quien solo mira la distancia del GPS perdia el registro.
SIN_DUR=$(post /api/sessions/running \
  '{"fecha":"2026-12-26","codigoSesion":"LIBRE","distanciaKm":5.0,"notas":"smoke: sin duracion"}')
comprobar "acepta carrera sin duracion" "$(tiene_ok "$SIN_DUR")" '"ok":true'

echo "=== 5. Fuerza en semana no programada ==="
FUERZA=$(post /api/sessions/strength \
  '{"fecha":"2026-12-27","codigoSesion":"LIBRE","sets":[{"exercise":"Sentadilla trasera","pesoKg":80,"reps":5,"rir":2}],"notas":"smoke: semana sin programar"}')
comprobar "acepta fuerza sin semana programada" "$(tiene_ok "$FUERZA")" '"ok":true'

echo "=== 6. Persistencia: releer desde PostgreSQL ==="
LEIDO=$(get "/api/sessions?from=2026-12-01&to=2026-12-31")
N_LIBRE=$(echo "$LEIDO" | grep -o 'LIBRE' | wc -l | tr -d ' ')
comprobar "las sesiones LIBRE vuelven de la BD" "$([ "$N_LIBRE" -ge 2 ] && echo si || echo no)" "si"
echo "        (codigo LIBRE aparece $N_LIBRE veces en la respuesta)"

echo "=== 7. Check-in: cuantas filas deja el mismo dia (informativo) ==="
# NO es un fallo automatico: que se permitan varios check-ins el mismo dia puede
# ser deliberado (mañana y noche se sienten distinto). Se informa, no se juzga.
# recovery_logs SI tiene indice unico por (perfil, fecha) y hace upsert;
# feedback_logs no. Si se decide que debe ser uno por dia, el arreglo es
# simetrico al de recovery.js: indice unico + ON CONFLICT DO UPDATE.
post /api/checkins '{"fecha":"2026-12-28","rpe":6,"dolor":0,"energia":7}' > /dev/null
post /api/checkins '{"fecha":"2026-12-28","rpe":7,"dolor":0,"energia":6}' > /dev/null
N_CK=$(get /api/checkins | grep -o '2026-12-28' | wc -l | tr -d ' ')
echo "        filas de check-in para 2026-12-28 tras dos envios: $N_CK"

echo
echo "================================"
echo " OK: $ok   FALLOS: $fallo"
echo "================================"
[ "$fallo" -eq 0 ]
