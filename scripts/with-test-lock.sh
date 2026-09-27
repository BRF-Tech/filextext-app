#!/usr/bin/env bash
# Run a heavy test command only while holding a lock directory, so two heavy
# runs on one machine (this repository's or others' sharing FXTXT_TEST_LOCK)
# never overlap.
#   bash scripts/with-test-lock.sh npx playwright test
set -u
LOCK="${FXTXT_TEST_LOCK:-${TMPDIR:-/tmp}/filextext-test.lock}"
waited=0
until mkdir "$LOCK" 2>/dev/null; do
  if [ $((waited % 60)) -eq 0 ]; then echo "waiting for $LOCK ($(cat "$LOCK/owner" 2>/dev/null))"; fi
  sleep 5
  waited=$((waited + 5))
done
echo "filextext e2e $(date)" > "$LOCK/owner"
trap 'rm -f "$LOCK/owner"; rmdir "$LOCK"' EXIT
"$@"
