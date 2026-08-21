#!/usr/bin/env bash
set -u
URL="https://helpful-endurance-staging.up.railway.app"
H="-H Origin:$URL"
B="--cookie hc_cookie.txt"

echo "=== PLANNER SEMANAL con availabilityDays en body ==="
curl -s -w " [%{http_code}]\n" $B $H -X POST "$URL/api/planning/weeks/1/proposals" \
  -H "Content-Type: application/json" \
  -d '{"startDate":"2026-08-24","endDate":"2026-08-30","availabilityDays":[1,2,3,4,5,6,7]}' | head -c 600
echo

echo "=== COACH CHAT con consulta ==="
curl -s -w " [%{http_code}]\n" $B $H -X POST "$URL/api/coach/chat" \
  -H "Content-Type: application/json" \
  -d '{"consulta":"Como tengo el plan maestro de media maraton, como reparto carrera y fuerza esta semana?","profileId":"d1f05412-120b-49d8-96ff-847d67a1fc86"}' | head -c 600
echo
