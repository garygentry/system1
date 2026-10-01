#!/bin/sh
# Pi: project-scoped install of the repo as a Pi package (root package.json `pi`
# key), so global Pi settings are untouched. Pi has no shell sandbox.
. "$(dirname -- "$0")/lib.sh"
global_install
drive() { # $1 = workdir, $2 = prompt, $3 = output file
  (cd "$1" && pi install -l "$REPO" >/dev/null 2>&1 \
    && timeout "$TIMEOUT" pi -p --approve --no-session "$2" </dev/null) >"$3" 2>&1 || true
}
status=0
empty_repo "$SMOKE/pi"
drive "$SMOKE/pi" "/skill:setup $SETUP_PROMPT" "$SMOKE/pi/ping.txt"
assert_marker pi:setup "$PING_MARKER" "$SMOKE/pi/ping.txt" || status=1
assert_marker pi:setup-skill "$DOCTOR_MARKER" "$SMOKE/pi/ping.txt" || status=1
fixture_repo "$SMOKE/pi-many"
(replay_env; drive "$SMOKE/pi-many" "$MANY_PROMPT" "$SMOKE/pi-many.txt")
assert_marker pi:many "$MANY_MARKER" "$SMOKE/pi-many.txt" || status=1
fixture_repo "$SMOKE/pi-scout"
drive "$SMOKE/pi-scout" "/skill:scout $SCOUT_PROMPT" "$SMOKE/pi-scout.txt"
assert_marker pi:scout "$SCOUT_MARKER" "$SMOKE/pi-scout.txt" || status=1
consent_repo "$SMOKE/pi-guard"
(log_decide "$SMOKE/pi-guard-log"; drive "$SMOKE/pi-guard" "/skill:guard $GUARD_PROMPT" "$SMOKE/pi-guard.txt")
assert_marker pi:guard "$GUARD_MARKER" "$SMOKE/pi-guard.txt" || status=1
assert_dormant pi:guard-dormant "$SMOKE/pi-guard" "$SMOKE/pi-guard-log/calls.txt" \
  '^guard enable' || status=1
fixture_repo "$SMOKE/pi-adopt"
# Pi prints only its reply, which may paraphrase: assert on the calls made.
(log_decide "$SMOKE/pi-adopt-log"; drive "$SMOKE/pi-adopt" "/skill:adopt $ADOPT_PROMPT" "$SMOKE/pi-adopt.txt")
assert_marker pi:adopt '^opportunities list' "$SMOKE/pi-adopt-log/calls.txt" || status=1
fixture_repo "$SMOKE/pi-compare"
drive "$SMOKE/pi-compare" "/skill:compare $COMPARE_PROMPT" "$SMOKE/pi-compare.txt"
assert_marker pi:compare "$COMPARE_MARKER" "$SMOKE/pi-compare.txt" || status=1
exit $status
