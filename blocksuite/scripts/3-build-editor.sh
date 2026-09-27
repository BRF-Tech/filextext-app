#!/usr/bin/env bash
# Phase 3: library build of the editor -> $FXTXT_BS/editor/dist, then copy it
# into the repository's vendor/blocksuite/ (old files removed first).
# Usage: 3-build-editor.sh [<repo vendor dir>]
set -euo pipefail

WS="${FXTXT_BS:-$HOME/fxtxt-bs}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null 2>&1 || true
fi

rm -rf "$WS/editor/src"
cp -r "$HERE/editor/." "$WS/editor/"
cd "$WS/editor"
rm -rf dist
VITE="$WS/node_modules/.bin/vite"
NODE_OPTIONS=--max-old-space-size=8192 "$VITE" build --config vite.config.mjs
cp "$HERE/editor/fxtxt-editor.d.ts" dist/fxtxt-editor.d.ts
echo "=== output"
ls -la dist dist/chunks
for f in dist/*.js dist/chunks/*.js; do
  printf '%-48s raw=%9d gzip=%8d\n' "$(basename "$f")" "$(wc -c < "$f")" "$(gzip -9 -c "$f" | wc -c)"
done
echo "total raw: $(cat dist/*.js dist/chunks/*.js dist/*.css | wc -c)  gzip: $(cat dist/*.js dist/chunks/*.js dist/*.css | gzip -9 | wc -c)"
if [ -n "${1:-}" ]; then
  rm -rf "$1"
  mkdir -p "$1"
  cp -r dist/. "$1/"
  echo "copied to $1"
fi
