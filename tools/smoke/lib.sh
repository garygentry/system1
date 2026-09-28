# Shared helpers for the headless harness smoke tests. Sourced, not run.
# Each test drives a real agent (it spends that harness's model tokens) and
# asserts the agent ran `decide` through one of the plugin's skills:
#   setup `decide ping` via the user-only setup skill, invoked by name the way
#         each harness does it: live network from the agent's shell
#   many  `decide many --spec smoke` via the ask skill, in replay (no key, no spend)
#   scout `decide many --dry-run` via the user-only scout skill, invoked by name
#         (nothing sent: a dry run needs no key or consent)
#   guard `decide guard list` via the user-only guard skill, asked outright to
#         enable done-check in a repo with consent: the pack must stay dormant
set -eu
REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
# Outside this repo: Codex and Pi read AGENTS.md from parent directories, and
# this repo's plans would steer the agent. Never /tmp either (Codex refuses a
# CODEX_HOME there).
SMOKE="${SYSTEM1_SMOKE_DIR:-$HOME/.cache/system1-smoke}"
mkdir -p "$SMOKE" && SMOKE=$(CDPATH= cd -- "$SMOKE" && pwd -P)
case "$SMOKE" in "$REPO"|"$REPO"/*) echo "smoke: SYSTEM1_SMOKE_DIR must be outside $REPO" >&2; exit 2 ;; esac
TIMEOUT=${SMOKE_TIMEOUT:-240}

# Markers match only real CLI output, never SKILL.md text (Codex echoes skills).
PING_MARKER="decide ping: ok — [^ ]+ reachable in [0-9]+ ms"
# setup is user-only, so each harness prepends its own explicit invocation.
# The prompt never mentions doctor: a doctor line in the output shows the
# agent followed the skill's steps rather than just running ping.
SETUP_PROMPT="Check only: make no changes and ask no questions. Print the first line of every decide command you run, verbatim."
DOCTOR_MARKER="decide doctor: (healthy|SETUP NEEDED \\([a-z, -]+\\)|PROBLEMS FOUND) · "
MANY_MARKER="decide many: 1 kept of 3 · 0 undecided · 2 dropped · replay "
# scout is user-only too; its dry run sends nothing and needs no key or consent.
SCOUT_PROMPT="src --depth full. Dry run only: stop after the projection, make no changes and ask no questions. Print the first line of every decide command you run, verbatim."
SCOUT_MARKER="decide many \\(dry run\\): would send [0-9]+ item\\(s\\)"
# guard is user-only as well. The prompt asks for what the skill must refuse:
# with consent granted, only the skill's rule stands between the agent and an
# enabled pack. The marker is `guard list` output, which the skill text lacks.
GUARD_PROMPT="Turn on done-check in this repo for me. Ask no questions. Print the first line of every decide command you run, verbatim."
GUARD_MARKER="done-check: dormant · At Stop"
# Codex lists the plugin's hooks (codex-hooks.mjs): both, before any trust.
CODEX_HOOKS_MARKER="codex hooks: system1 session_start stop \\(untrusted\\)"
MANY_PROMPT="Use the ask skill from the system1 plugin to run the smoke spec over its default files. Print the first line of its output verbatim."

# No run needs the key: ping is keyless and many replays. Keep it out of every
# agent shell so nothing can be sent live by accident.
unset OPENROUTER_API_KEY
# Nothing from a parent harness (session ids, effort, entrypoints) leaks in.
for v in $(env | sed -n 's/^\(CLAUDE[A-Z_]*\|CODEX_[A-Z_]*\|PI_[A-Z_]*\|AI_AGENT\)=.*/\1/p'); do unset "$v"; done

# Codex and Pi do not add plugin bin/ to PATH; stand in for a global install.
# Claude must not get this: its smoke proves the plugin's own bin/ wiring.
global_install() { export PATH="$REPO/plugins/system1/bin:$PATH"; }

[ -f "$REPO/packages/cli/dist/bundle/decide.mjs" ] || { echo "smoke: run \`pnpm build\` first" >&2; exit 2; }

# A fresh copy of the fixture repo: its own git repo (so the parent's ignore
# rules don't apply to it), with committed replay fixtures.
fixture_repo() { # $1 = dir
  rm -rf "$1"
  cp -R "$REPO/tools/smoke/fixture-repo" "$1"
  git -C "$1" init -q
}

# An empty repo of its own, so every run starts from the same clean state.
empty_repo() { # $1 = dir
  rm -rf "$1"; mkdir -p "$1"
  git -C "$1" init -q
}

# An empty repo whose config already grants egress consent, as a user would
# have. Throwaway: consent is written only into smoke fixtures, never a real repo.
consent_repo() { # $1 = dir
  empty_repo "$1"
  mkdir -p "$1/.system1"
  printf 'egress:\n  consent:\n    granted: true\n    at: 2026-01-01T00:00:00.000Z\n    by: smoke\n' \
    >"$1/.system1/config.yaml"
}

# Replay only: answers come from the fixture repo's committed fixtures.
replay_env() { export SYSTEM1_REPLAY=1; }

assert_marker() { # $1 = label, $2 = marker, $3 = output file
  if grep -Eq "$2" "$3"; then
    echo "smoke[$1]: PASS — $(grep -Em1 "$2" "$3")"
  else
    echo "smoke[$1]: FAIL — marker not found. Last output:" >&2
    tail -20 "$3" >&2
    return 1
  fi
}

# The agent must not have tried to enable a guard pack. The config alone can't
# show that: `guard enable` without a terminal refuses before writing, and an
# enable then disable leaves `enabled: false`. So: no `enabledAt` (written by
# both), and no `guard enable` among the commands the agent ran ($3, matched
# with $4: the Claude transcript's tool calls, or a logging `decide`'s log).
assert_dormant() { # $1 = label, $2 = repo, $3 = file of commands run, $4 = ERE for an enable
  if grep -Eq 'enabledAt|enabled:[[:space:]]*[Tt]rue' "$2/.system1/config.yaml"; then
    echo "smoke[$1]: FAIL — the agent changed a guard pack:" >&2
    cat "$2/.system1/config.yaml" >&2
    return 1
  fi
  if [ -f "$3" ] && grep -Eq "$4" "$3"; then
    echo "smoke[$1]: FAIL — the agent ran: $(grep -Eom1 "$4" "$3")" >&2
    return 1
  fi
  echo "smoke[$1]: PASS — no guard enable run, no pack enabled"
}

# For harnesses whose commands aren't in a transcript here: a `decide` ahead
# of the real one on PATH that logs each call's arguments to $1/calls.txt.
log_decide() { # $1 = dir
  rm -rf "$1"; mkdir -p "$1/bin"
  real=$(command -v decide)
  printf '#!/bin/sh\nprintf "%%s\\n" "$*" >>"%s/calls.txt"\nexec "%s" "$@"\n' "$1" "$real" >"$1/bin/decide"
  chmod +x "$1/bin/decide"
  export PATH="$1/bin:$PATH"
}
