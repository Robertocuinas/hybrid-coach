#!/usr/bin/env bash
# Smoke end-to-end del onboarding funcional (Fase 13): un usuario NUEVO rellena
# su ficha con fecha de carrera y obtiene un plan global hacia esa carrera.
#
# Flujo real contra HTTP:
#   registrar -> PATCH fecha_carrera -> POST /api/planning/master -> GET /api/planning/master
#   -> assert total_semanas > 0
#
# Dos cosas que cuestan un rato descubrir si no se documentan (igual que en
# smoke-registro-libre.sh):
#  1. La API exige la cabecera Origin (proteccion CSRF en middleware/security.js).
#     Sin ella responde 403 y parece un fallo de producto cuando es del cliente.
#  2. El cuerpo del PATCH /api/profile usa snake_case (fecha_carrera), coherente
#     con las columnas de la base de datos; el cuerpo del sync usa camelCase.
#
# Requisitos:
#  - Servidor arrancado (npm start) con PostgreSQL accesible via DATABASE_URL.
#  - REGISTRATION_ENABLED no sea "false" (por defecto el alta publica esta abierta).
#  - Para el PASO de generacion en vivo se necesita LLM_PROVIDER (IA) configurado.
#    Sin IA, ese paso se marca OMITIDO y el script termina 0: la ficha queda
#    persistida igualmente y el frontend usa el motor determinista local de
#    respaldo. El assertion de total_semanas NO depende nunca del contenido de
#    la IA: solo comprueba un numero.
#
#   BASE=http://localhost:3000 bash scripts/smoke-onboarding.sh
set -u
BASE="${BASE:-http://localhost:3000}"
H_ORIGIN="Origin: $BASE"
H_JSON="Content-Type: application/json"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

ok=0; fallo=0; omitido=0
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
post() { curl -s -m 60 -b "$JAR" -c "$JAR" -H "$H_JSON" -H "$H_ORIGIN" -X POST "$BASE$1" -d "$2"; }
get()  { curl -s -m 30 -b "$JAR" -H "$H_ORIGIN" "$BASE$1"; }
tiene_ok() { echo "$1" | grep -o '"ok":true' | head -1; }

# Fecha de carrera ~16 semanas en el futuro (portable: node esta presente).
FECHA="$(node -e "console.log(new Date(Date.now()+112*864e5).toISOString().slice(0,10))")"
TS="$(node -e "console.log(Date.now())")"
EMAIL="onboarding-smoke-$TS@local.test"
PASSWORD="OnboardingSmoke2026!"

echo "Objetivo: $BASE"
echo "Usuario de prueba: $EMAIL   fecha_carrera: $FECHA"

echo "=== 1. Registro de usuario nuevo (arranque del onboarding) ==="
REG=$(post /api/auth/register "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"nombre\":\"Smoke Onboarding\"}")
comprobar "registro devuelve ok y crea perfil activo" "$(tiene_ok "$REG")" '"ok":true'
if ! echo "$REG" | grep -q '"ok":true'; then
  echo "  (No se pudo registrar: ¿servidor caido, REGISTRATION_ENABLED=false o falta DATABASE_URL?)"
  echo "================================"
  echo " OK: $ok   FALLOS: $fallo   OMITIDOS: $omitido"
  echo "================================"
  [ "$fallo" -eq 0 ]
  exit 1
fi

echo "=== 2. PATCH /api/profile con fecha_carrera (persistencia 13.2) ==="
PATCH=$(post /api/profile "{\"fecha_carrera\":\"$FECHA\"}")
comprobar "PATCH /api/profile acepta fecha_carrera" "$(tiene_ok "$PATCH")" '"ok":true'

echo "=== 3. La fecha queda persistida (GET /api/profile) ==="
PROF=$(get /api/profile)
if echo "$PROF" | grep -q "\"fecha_carrera\":\"$FECHA\""; then
  comprobar "GET /api/profile devuelve fecha_carrera persistida" "si" "si"
else
  comprobar "GET /api/profile devuelve fecha_carrera persistida" "no" "si"
fi

echo "=== 4. POST /api/planning/master (generacion del plan global) ==="
MASTER=$(post /api/planning/master "{}")
if echo "$MASTER" | grep -q 'PLANNING_LLM_UNAVAILABLE'; then
  echo "  OMITIDO La generacion en vivo del plan maestro requiere LLM_PROVIDER (IA)."
  echo "         Sin IA, el frontend NO bloquea el alta: usa el motor determinista"
  echo "         local de respaldo. La ficha (fecha_carrera) ya esta persistida."
  omitido=$((omitido+1))
else
  comprobar "POST /api/planning/master devuelve ok" "$(tiene_ok "$MASTER")" '"ok":true'

  echo "=== 5. GET /api/planning/master (plan global) ==="
  GETM=$(get /api/planning/master)
  TOTAL=$(echo "$GETM" | grep -o '"total_semanas":[0-9]*' | head -1 | grep -o '[0-9]*')
  if [ "${TOTAL:-0}" -gt 0 ]; then
    comprobar "el plan global tiene total_semanas > 0" "si" "si"
  else
    comprobar "el plan global tiene total_semanas > 0" "no" "si"
  fi
fi

echo
echo "================================"
echo " OK: $ok   FALLOS: $fallo   OMITIDOS: $omitido"
echo "================================"
[ "$fallo" -eq 0 ]
