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
fixture_repo "$SMOKE/claude-scout"
# The transcript, not the reply: Haiku runs the dry run but tends to paraphrase
# its output, and the assertion is about what the CLI printed.
(cd "$SMOKE/claude-scout" && timeout "$TIMEOUT" claude -p "/system1:scout $SCOUT_PROMPT" \
  --plugin-dir "$REPO/plugins/system1" --output-format stream-json --verbose \
  --allowedTools "Bash(decide *)" "Skill" --model "${SMOKE_CLAUDE_MODEL:-haiku}" </dev/null) \
  >"$SMOKE/claude-scout.txt" 2>&1 || true
assert_marker claude:scout "$SCOUT_MARKER" "$SMOKE/claude-scout.txt" || status=1
consent_repo "$SMOKE/claude-guard"
(cd "$SMOKE/claude-guard" && timeout "$TIMEOUT" claude -p "/system1:guard $GUARD_PROMPT" \
  --plugin-dir "$REPO/plugins/system1" --output-format stream-json --verbose \
  --allowedTools "Bash(decide *)" "Skill" --model "${SMOKE_CLAUDE_MODEL:-haiku}" </dev/null) \
  >"$SMOKE/claude-guard.txt" 2>&1 || true
assert_marker claude:guard "$GUARD_MARKER" "$SMOKE/claude-guard.txt" || status=1
assert_dormant claude:guard-dormant "$SMOKE/claude-guard" "$SMOKE/claude-guard.txt" \
  '"command":"[^"]*guard enable' || status=1
# adopt and compare: user-only, asserted on the transcript like scout.
for skill in adopt compare; do
  fixture_repo "$SMOKE/claude-$skill"
  prompt=$( [ "$skill" = adopt ] && echo "$ADOPT_PROMPT" || echo "$COMPARE_PROMPT" )
  marker=$( [ "$skill" = adopt ] && echo "$ADOPT_MARKER" || echo "$COMPARE_MARKER" )
  (cd "$SMOKE/claude-$skill" && timeout "$TIMEOUT" claude -p "/system1:$skill $prompt" \
    --plugin-dir "$REPO/plugins/system1" --output-format stream-json --verbose \
    --allowedTools "Bash(decide *)" "Skill" --model "${SMOKE_CLAUDE_MODEL:-haiku}" </dev/null) \
    >"$SMOKE/claude-$skill.txt" 2>&1 || true
  assert_marker "claude:$skill" "$marker" "$SMOKE/claude-$skill.txt" || status=1
done
exit $status
