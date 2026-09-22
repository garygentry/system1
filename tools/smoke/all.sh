#!/bin/sh
# Run every harness smoke test; exit non-zero if any fails. Local only (not CI):
# each needs that harness installed and authenticated.
dir=$(dirname -- "$0"); status=0
for harness in claude codex pi; do
  if command -v "$harness" >/dev/null 2>&1; then
    sh "$dir/$harness.sh" || status=1
  else
    echo "smoke[$harness]: SKIP — not installed"
  fi
done
exit $status
