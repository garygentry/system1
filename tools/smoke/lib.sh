# Shared helpers for the headless harness smoke tests. Sourced, not run.
# Each test drives a real agent (it spends that harness's model tokens) and
# asserts the agent ran `decide ping` through the plugin's skill.
set -eu
REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
SMOKE="$REPO/.smoke"          # gitignored scratch; never /tmp (Codex refuses it)
MARKER="decide ping: ok — [^ ]+ reachable in [0-9]+ ms"   # only real CLI output matches
PROMPT="Use the ping skill from the decisions plugin to check the decisions setup. Print the line it outputs verbatim."
TIMEOUT=${SMOKE_TIMEOUT:-240}

# Codex and Pi do not add plugin bin/ to PATH; stand in for a global install.
export PATH="$REPO/plugins/decisions/bin:$PATH"

[ -f "$REPO/packages/cli/dist/bin.js" ] || { echo "smoke: run \`pnpm build\` first" >&2; exit 2; }

assert_marker() { # $1 = harness, $2 = output file
  if grep -Eq "$MARKER" "$2"; then
    echo "smoke[$1]: PASS — $(grep -Em1 "$MARKER" "$2")"
  else
    echo "smoke[$1]: FAIL — marker not found. Last output:" >&2
    tail -20 "$2" >&2
    return 1
  fi
}
