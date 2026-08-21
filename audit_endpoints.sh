#!/usr/bin/env bash
# Auditoría funcional de endpoints clave de Hybrid Coach en staging.
set -u
URL="https://helpful-endurance-staging.up.railway.app"
COOKIE="hc_cookie.txt"
H="-H Origin:$URL"
B="--cookie $COOKIE"

echo "=== PLANNER SEMANAL (POST /api/planning/weeks/1/proposals) ==="
curl -s -w " [%{http_code}]\n" $B $H -X POST "$URL/api/planning/weeks/1/proposals" \
  -H "Content-Type: application/json" \
  -d '{"startDate":"2026-08-24","endDate":"2026-08-30"}' | head -c 500
echo

echo "=== COACH CHAT (POST /api/coach/chat) ==="
curl -s -w " [%{http_code}]\n" $B $H -X POST "$URL/api/coach/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"¿Cómo reparto carrera y fuerza esta semana?","profileId":"d1f05412-120b-49d8-96ff-847d67a1fc86"}' | head -c 500
echo

echo "=== FOODS BUSCAR (GET /api/foods/buscar?q=pollo) ==="
curl -s -w " [%{http_code}]\n" $B $H "$URL/api/foods/buscar?q=pollo" | head -c 400
echo

echo "=== FOODS DIA (GET /api/foods/dia) ==="
curl -s -w " [%{http_code}]\n" $B $H "$URL/api/foods/dia" | head -c 400
echo

echo "=== PROFILE ME (GET /api/auth/me) ==="
curl -s -w " [%{http_code}]\n" $B $H "$URL/api/auth/me" | head -c 200
echo
