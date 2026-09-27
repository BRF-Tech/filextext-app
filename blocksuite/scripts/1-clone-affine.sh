#!/usr/bin/env bash
# Phase 1: fetch the BlockSuite sources. Current BlockSuite is not published to
# npm; it lives as source inside the AFFiNE monorepo (blocksuite/ subtree).
# Only that subtree is checked out (blobless sparse clone).
#
# Pinned tag: v0.27.4 (a stable AFFiNE release; canary tags are pruned
# upstream after a few weeks, stable tags stay).
set -euo pipefail

AFFINE_TAG="${AFFINE_TAG:-v0.27.4}"
WS="${FXTXT_BS:-$HOME/fxtxt-bs}"

mkdir -p "$WS"
cd "$WS"
rm -rf affine-src
git clone --depth 1 --branch "$AFFINE_TAG" --filter=blob:none --sparse \
  https://github.com/toeverything/AFFiNE.git affine-src
cd affine-src
git sparse-checkout set blocksuite
grep -m1 '"version"' blocksuite/affine/all/package.json
echo "DONE: $WS/affine-src/blocksuite"
