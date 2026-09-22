#!/bin/sh
# Pi: project-scoped install of the repo as a Pi package (root package.json `pi`
# key), so global Pi settings are untouched. Pi has no shell sandbox.
. "$(dirname -- "$0")/lib.sh"
work="$SMOKE/pi"; rm -rf "$work"; mkdir -p "$work"; out="$work/out.txt"
(cd "$work" && pi install -l "$REPO" >/dev/null 2>&1 \
  && timeout "$TIMEOUT" pi -p --approve --no-session "$PROMPT" </dev/null) >"$out" 2>&1 || true
assert_marker pi "$out"
