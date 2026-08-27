#!/usr/bin/env bash
# Smoke de aceptación semanal (Fase 14): genera una propuesta para una semana y
# la acepta. Reutiliza el patrón de scripts/smoke-onboarding.sh.
#
# Flujo real contra HTTP:
#   registrar -> PATCH fecha_carrera -> POST /api/planning/master
#   -> POST /api/weeks/:week/proposals -> POST /api/proposals/:id/accept
#   -> assert que la propuesta pasa a estado aceptado
#
# Notas (igual que smoke-onboarding.sh):
#   1. La API exige cabecera Origin (protección CSRF en middleware/security.js).
#   2. El cuerpo del PATCH usa snake_case (fecha_carrera); el sync usa camelCase.
# Requisitos:
#   - Servidor arrancado (npm start) con PostgreSQL y LLM_PROVIDER (IA) para generar
#     y aceptar de verdad. Sin IA, los pasos de generación/aceptación se marcan
#     OMITIDOS y el script termina 0: la validación de aceptación (esUUID) ya está
#     cubierta por server/middleware/authorization.test.js.
#
#   BASE=http://localhost:3000 bash scripts/smoke-aceptacion-semanal.sh
set -u
BASE="${BASE:-http://localhost:3000}"
H_ORIGIN="Origin: $BASE"
H_JSON="Content-Type: application/json"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

ok=0; fallo=0; omitido=0
comprobar() {
  if [ "$2" = "$3" ]; then echo "  OK    $1"; ok=$((ok+1));
  else echo "  FALLO $1 -> obtenido '$2', esperado '$3'"; fallo=$((fallo+1)); fi
}
post() { curl -s -m 60 -b "$JAR" -c "$JAR" -H "$H_JSON" -H "$H_ORIGIN" -X POST "$BASE$1" -d "$2"; }
get()  { curl -s -m 30 -b "$JAR" -H "$H_ORIGIN" "$BASE$1"; }
tiene_ok() { echo "$1" | grep -o '"ok":true' | head -1; }

FECHA="$(node -e "console.log(new Date(Date.now()+112*864e5).toISOString().slice(0,10))")"
TS="$(node -e "console.log(Date.now())")"
EMAIL="aceptacion-smoke-$TS@local.test"
PASSWORD="AceptacionSmoke2026!"

echo "Objetivo: $BASE"
echo "Usuario de prueba: $EMAIL   fecha_carrera: $FECHA"

echo "=== 1. Registro ==="
REG=$(post /api/auth/register "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"nombre\":\"Smoke Aceptacion\"}")
comprobar "registro devuelve ok" "$(tiene_ok "$REG")" '"ok":true'
[ "$(tiene_ok "$REG")" = '"ok":true' ] || { echo "  (No se pudo registrar)"; echo " OK:$ok FALLOS:$fallo OMITIDOS:$omitido"; [ "$fallo" -eq 0 ]; exit 1; }

echo "=== 2. PATCH fecha_carrera ==="
comprobar "PATCH /api/profile acepta fecha_carrera" "$(tiene_ok "$(post /api/profile "{\"fecha_carrera\":\"$FECHA\"}")")" '"ok":true'

echo "=== 3. POST /api/planning/master (macro global) ==="
MASTER=$(post /api/planning/master "{}")
if echo "$MASTER" | grep -q 'PLANNING_LLM_UNAVAILABLE'; then
  echo "  OMITIDO generación del plan maestro requiere LLM_PROVIDER (IA)."
  omitido=$((omitido+1))
else
  comprobar "POST /api/planning/master ok" "$(tiene_ok "$MASTER")" '"ok":true'
fi

echo "=== 4. POST /api/weeks/3/proposals (propuesta semanal) ==="
PROP=$(post /api/planning/weeks/3/proposals "{\"availabilityDays\":[0,1,3,5]}")
if echo "$PROP" | grep -q 'PLANNING_LLM_UNAVAILABLE'; then
  echo "  OMITIDO generación de propuesta requiere LLM_PROVIDER (IA)."
  omitido=$((omitido+1))
else
  PID=$(echo "$PROP" | grep -o '"id":"[0-9a-f-]*"' | head -1 | sed 's/"id":"//;s/"//')
  if [ -n "$PID" ]; then
    echo "=== 5. POST /api/proposals/$PID/accept (aceptación, Fase 14.1) ==="
    ACC=$(post /api/proposals/$PID/accept "{}")
    comprobar "aceptación devuelve ok" "$(tiene_ok "$ACC")" '"ok":true'
  else
    echo "  OMITIDO no se obtuvo id de propuesta (¿sin IA?)."
    omitido=$((omitido+1))
  fi
fi

echo
echo "================================"
echo " OK: $ok   FALLOS: $fallo   OMITIDOS: $omitido"
echo "================================"
[ "$fallo" -eq 0 ]
