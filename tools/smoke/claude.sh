#!/bin/sh
# Claude Code: load the plugin from the working tree; plugin bin/ is on the Bash PATH.
. "$(dirname -- "$0")/lib.sh"
drive() { # $1 = workdir, $2 = prompt, $3 = output file
  (cd "$1" && timeout "$TIMEOUT" claude -p --plugin-dir "$REPO/plugins/system1" \
    --allowedTools "Bash(decide *)" "Skill" --model "${SMOKE_CLAUDE_MODEL:-haiku}" "$2" </dev/null) >"$3" 2>&1 || true
}
status=0
empty_repo "$SMOKE/claude"
drive "$SMOKE/claude" "/system1:setup $SETUP_PROMPT" "$SMOKE/claude/ping.txt"
assert_marker claude:setup "$PING_MARKER" "$SMOKE/claude/ping.txt" || status=1
assert_marker claude:setup-skill "$DOCTOR_MARKER" "$SMOKE/claude/ping.txt" || status=1
fixture_repo "$SMOKE/claude-many"
(replay_env; drive "$SMOKE/claude-many" "$MANY_PROMPT" "$SMOKE/claude-many.txt")
assert_marker claude:many "$MANY_MARKER" "$SMOKE/claude-many.txt" || status=1
exit $status
