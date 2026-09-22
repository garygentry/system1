#!/bin/sh
# Re-record the smoke fixtures: one live `decide many` over the fixture repo
# (about $0.0002). Runs from the repo root, which holds the key (.env) and the
# egress consent, then moves the recorded answers into the fixture repo.
set -eu
REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
FIX="$REPO/tools/smoke/fixture-repo"
cd "$REPO"
rm -rf .decisions/fixtures/smoke
node --env-file=.env packages/cli/dist/bundle/decide.mjs many \
  --spec "$FIX/.decisions/specs/smoke.yaml" --glob 'tools/smoke/fixture-repo/src/**/*.ts' \
  --record --format brief
rm -rf "$FIX/.decisions/fixtures/smoke"
mkdir -p "$FIX/.decisions/fixtures"
mv .decisions/fixtures/smoke "$FIX/.decisions/fixtures/smoke"
echo "record: $(ls "$FIX/.decisions/fixtures/smoke" | wc -l) fixture(s) in $FIX/.decisions/fixtures/smoke"
