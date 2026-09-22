#!/bin/sh
# Pi: project-scoped install of the repo as a Pi package (root package.json `pi`
# key), so global Pi settings are untouched. Pi has no shell sandbox.
. "$(dirname -- "$0")/lib.sh"
drive() { # $1 = workdir, $2 = prompt, $3 = output file
  (cd "$1" && pi install -l "$REPO" >/dev/null 2>&1 \
    && timeout "$TIMEOUT" pi -p --approve --no-session "$2" </dev/null) >"$3" 2>&1 || true
}
status=0
rm -rf "$SMOKE/pi"; mkdir -p "$SMOKE/pi"
drive "$SMOKE/pi" "$PING_PROMPT" "$SMOKE/pi/ping.txt"
assert_marker pi:ping "$PING_MARKER" "$SMOKE/pi/ping.txt" || status=1
fixture_repo "$SMOKE/pi-many"
(replay_env; drive "$SMOKE/pi-many" "$MANY_PROMPT" "$SMOKE/pi-many.txt")
assert_marker pi:many "$MANY_MARKER" "$SMOKE/pi-many.txt" || status=1
exit $status
