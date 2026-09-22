#!/bin/sh
# Claude Code: load the plugin from the working tree; plugin bin/ is on the Bash PATH.
. "$(dirname -- "$0")/lib.sh"
work="$SMOKE/claude"; mkdir -p "$work"; out="$work/out.txt"
(cd "$work" && timeout "$TIMEOUT" claude -p --plugin-dir "$REPO/plugins/decisions" \
  --allowedTools "Bash(decide *)" "Skill" --model "${SMOKE_CLAUDE_MODEL:-haiku}" "$PROMPT" </dev/null) >"$out" 2>&1 || true
assert_marker claude "$out"
