#!/usr/bin/env bash
# Phase 2: assemble an isolated yarn 4 workspace around the BlockSuite subtree
# (every @blocksuite package is a workspace, so their `workspace:*` deps
# resolve) plus our `editor` package, then install.
# Needs node 22 and git. Run on a native Linux filesystem, not /mnt/<drive>.
set -euo pipefail

WS="${FXTXT_BS:-$HOME/fxtxt-bs}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null 2>&1 || true
fi
COREPACK="$(command -v corepack || echo "$HOME/.nvm/versions/node/$(node -v 2>/dev/null | tr -d v)/bin/corepack")"

[ -d "$WS/affine-src/blocksuite" ] || { echo "run 1-clone-affine.sh first"; exit 1; }

cp "$HERE/workspace/package.json" "$WS/package.json"
cp "$HERE/workspace/.yarnrc.yml" "$WS/.yarnrc.yml"
rm -rf "$WS/editor/src"
mkdir -p "$WS/editor"
cp -r "$HERE/editor/." "$WS/editor/"

cd "$WS"
"$COREPACK" prepare yarn@4.13.0 --activate
YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install
echo "DONE: workspace installed at $WS"
