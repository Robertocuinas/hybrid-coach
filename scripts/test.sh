#!/usr/bin/env bash
# Wrapper para `npm test`. node --test necesita una lista explícita de archivos;
# los globs `src/**/*.test.js` no funcionan igual en bash de CI (sin globstar) y
# en Windows/git-bash, así que los enumeramos aquí con find. Falla ruidosamente
# si no se encuentra ningún test, en vez de pasarlos vacíos a node.
set -euo pipefail
shopt -s nullglob 2>/dev/null || true  # nullglob solo en bash, ignorado en sh

files=$(find src server scripts migration -name '*.test.js' 2>/dev/null | sort)
if [ -z "$files" ]; then
  echo "No se encontraron archivos *.test.js bajo src/ server/ scripts/ migration/" >&2
  exit 1
fi
exec node --test --test-concurrency=1 $files