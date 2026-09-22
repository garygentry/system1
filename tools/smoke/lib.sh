# Shared helpers for the headless harness smoke tests. Sourced, not run.
# Each test drives a real agent (it spends that harness's model tokens) and
# asserts the agent ran `decide` through one of the plugin's skills:
#   setup `decide ping` via the user-only setup skill, invoked by name the way
#         each harness does it: live network from the agent's shell
#   many  `decide many --spec smoke` via the ask skill, in replay (no key, no spend)
set -eu
REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
SMOKE="$REPO/.smoke"          # gitignored scratch; never /tmp (Codex refuses it)
TIMEOUT=${SMOKE_TIMEOUT:-240}

# Markers match only real CLI output, never SKILL.md text (Codex echoes skills).
PING_MARKER="decide ping: ok — [^ ]+ reachable in [0-9]+ ms"
# setup is user-only, so each harness prepends its own explicit invocation.
# The prompt never mentions doctor: a doctor line in the output shows the
# agent followed the skill's steps rather than just running ping.
SETUP_PROMPT="Check only: make no changes and ask no questions. Print the first line of every decide command you run, verbatim."
DOCTOR_MARKER="decide doctor: (healthy|PROBLEMS FOUND) · "
MANY_MARKER="decide many: 1 kept of 3 · 0 undecided · 2 dropped · replay "
MANY_PROMPT="Use the ask skill from the decisions plugin to run the smoke spec over its default files. Print the first line of its output verbatim."

# No run needs the key: ping is keyless and many replays. Keep it out of every
# agent shell so nothing can be sent live by accident.
unset OPENROUTER_API_KEY

# Codex and Pi do not add plugin bin/ to PATH; stand in for a global install.
# Claude must not get this: its smoke proves the plugin's own bin/ wiring.
global_install() { export PATH="$REPO/plugins/decisions/bin:$PATH"; }

[ -f "$REPO/packages/cli/dist/bundle/decide.mjs" ] || { echo "smoke: run \`pnpm build\` first" >&2; exit 2; }

# A fresh copy of the fixture repo: its own git repo (so the parent's ignore
# rules for .smoke/ don't withhold its files), with committed replay fixtures.
fixture_repo() { # $1 = dir
  rm -rf "$1"
  cp -R "$REPO/tools/smoke/fixture-repo" "$1"
  git -C "$1" init -q
}

# An empty repo of its own, so the agent can't wander into this repo's
# AGENTS.md, plans or skill sources (Codex did, before this).
empty_repo() { # $1 = dir
  rm -rf "$1"; mkdir -p "$1"
  git -C "$1" init -q
}

# Replay only: answers come from the fixture repo's committed fixtures.
replay_env() { export DECISIONS_REPLAY=1; }

assert_marker() { # $1 = label, $2 = marker, $3 = output file
  if grep -Eq "$2" "$3"; then
    echo "smoke[$1]: PASS — $(grep -Em1 "$2" "$3")"
  else
    echo "smoke[$1]: FAIL — marker not found. Last output:" >&2
    tail -20 "$3" >&2
    return 1
  fi
}
