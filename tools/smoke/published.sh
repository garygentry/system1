#!/bin/sh
# Verify a release from what npm and the marketplace actually serve, not the
# checkout (docs/contributing/release.md § 6). Local only: it installs into
# fresh per-harness profiles under $SYSTEM1_SMOKE_DIR, holding only your auth.
#
#   sh tools/smoke/published.sh X.Y.Z [claude|codex|pi|all] [--live]
#
# Default: install each harness's published artifacts and run `decide doctor`
# through them. Spends nothing.
# --live: also grant egress consent in the throwaway fixture repo (never this
# one) and have each agent run one live `ask` over it, ~$0.0001 per harness
# plus that harness's tokens. Needs OPENROUTER_API_KEY in the environment.
KEY=${OPENROUTER_API_KEY:-}
. "$(dirname -- "$0")/lib.sh"

VERSION=${1:-}
case "$VERSION" in
[0-9]*.[0-9]*.[0-9]*) shift ;;
*) echo "usage: published.sh X.Y.Z [claude|codex|pi|all] [--live]" >&2; exit 2 ;;
esac
WHICH=all LIVE=0
for arg in "$@"; do
  case "$arg" in
  --live) LIVE=1 ;;
  claude | codex | pi | all) WHICH=$arg ;;
  *) echo "published: unknown argument $arg" >&2; exit 2 ;;
  esac
done
if [ "$LIVE" = 1 ] && [ -z "$KEY" ]; then
  echo "published: --live needs OPENROUTER_API_KEY in the environment" >&2; exit 2
fi
for pkg in system1 system1-core system1-pi; do
  npm view "@garygentry/$pkg@$VERSION" version >/dev/null 2>&1 ||
    { echo "published: npm does not serve @garygentry/$pkg@$VERSION" >&2; exit 2; }
done

# A prompt that doesn't name the skill: routing has to find `ask` on its own.
PROMPT="Go through every file under src/ and flag the ones that make outbound network requests. Print the first line of any decide output verbatim, then list the files."
LIVE_MARKER="decide (many|ask): .* · live [^ ]+ · \\\$[0-9.]+ measured"
DOCTOR_LINE="^decide doctor: "
P="$SMOKE/published-$VERSION"

# The global CLI Codex and Pi need, in a prefix of its own (never your real one).
npm_cli() {
  [ -x "$P/npm/bin/decide" ] || npm i -g --prefix "$P/npm" "@garygentry/system1@$VERSION" >/dev/null 2>&1
  export PATH="$P/npm/bin:$PATH"
}

# A fresh copy of the fixture repo. Consent is written only with --live, and
# only here: this directory is outside the repo and rebuilt on every run.
workdir() { # $1 = harness
  dir="$P/repo-$1"
  rm -rf "$dir"
  cp -R "$REPO/tools/smoke/published-repo" "$dir"
  git -C "$dir" init -q
  if [ "$LIVE" = 1 ]; then
    mkdir -p "$dir/.system1"
    printf 'egress:\n  consent:\n    granted: true\n    by: tools/smoke/published.sh --live\n' \
      >"$dir/.system1/config.yaml"
  fi
  echo "$dir"
}

# doctor through the harness's own install, then (with --live) one agent run.
check() { # $1 = harness, $2 = decide to run, $3 = workdir, $4 = agent command
  out="$P/$1.txt"
  (cd "$3" && "$2" doctor --format brief) >"$out" 2>&1 || true
  assert_marker "$1:doctor" "$DOCTOR_LINE" "$out" || return 1
  [ "$LIVE" = 1 ] || return 0
  (cd "$3" && export OPENROUTER_API_KEY="$KEY" && timeout 400 sh -c "$4" </dev/null) >>"$out" 2>&1 || true
  assert_marker "$1:live" "$LIVE_MARKER" "$out"
}

run_claude() {
  # Plugin only, as documented: no decide on PATH, so the shim must fetch the
  # pinned CLI through npx. The marketplace serves the plugin from main.
  export CLAUDE_CONFIG_DIR="$P/claude"
  rm -rf "$CLAUDE_CONFIG_DIR"; mkdir -p "$CLAUDE_CONFIG_DIR"
  ln -s "$HOME/.claude/.credentials.json" "$CLAUDE_CONFIG_DIR/.credentials.json"
  export XDG_CONFIG_HOME="$P/xdg-claude"
  claude plugin marketplace add garygentry/system1 >/dev/null 2>&1
  claude plugin install system1@system1 >/dev/null 2>&1
  shim=$(find "$CLAUDE_CONFIG_DIR/plugins/cache" -path "*/$VERSION/bin/decide" 2>/dev/null | head -1)
  [ -n "$shim" ] || { echo "smoke[claude:install]: FAIL — no plugin $VERSION (is the bump on main?)" >&2; return 1; }
  echo "smoke[claude:install]: PASS — $shim"
  check claude "$shim" "$(workdir claude)" \
    "claude -p --model ${SMOKE_CLAUDE_MODEL:-sonnet} --allowedTools 'Bash(decide *)' Skill Read Glob Grep -- \"$PROMPT\""
}

run_codex() {
  npm_cli
  export CODEX_HOME="$P/codex" XDG_CONFIG_HOME="$P/xdg-codex"
  rm -rf "$CODEX_HOME"; mkdir -p "$CODEX_HOME/rules"
  ln -s "$HOME/.codex/auth.json" "$CODEX_HOME/auth.json"
  printf 'prefix_rule(pattern = ["decide"], decision = "allow")\n' >"$CODEX_HOME/rules/system1.rules"
  codex plugin marketplace add garygentry/system1 >/dev/null 2>&1
  codex plugin add system1@system1 >/dev/null 2>&1
  [ -d "$CODEX_HOME/plugins/cache/system1/system1/$VERSION" ] ||
    { echo "smoke[codex:install]: FAIL — no plugin $VERSION (is the bump on main?)" >&2; return 1; }
  echo "smoke[codex:install]: PASS — plugin $VERSION, CLI $(decide version)"
  check codex decide "$(workdir codex)" "codex exec --skip-git-repo-check \"$PROMPT\""
}

run_pi() {
  npm_cli
  export PI_CODING_AGENT_DIR="$P/pi" XDG_CONFIG_HOME="$P/xdg-pi"
  rm -rf "$PI_CODING_AGENT_DIR"; mkdir -p "$PI_CODING_AGENT_DIR"
  for f in auth.json models-store.json settings.json; do
    if [ -f "$HOME/.pi/agent/$f" ]; then cp "$HOME/.pi/agent/$f" "$PI_CODING_AGENT_DIR/"; fi
  done
  # Keep your provider and model, but none of your installed packages.
  if [ -f "$PI_CODING_AGENT_DIR/settings.json" ]; then node -e '
    const fs = require("fs"), f = process.argv[1], s = JSON.parse(fs.readFileSync(f, "utf8"))
    delete s.packages; fs.writeFileSync(f, JSON.stringify(s, null, 2))' "$PI_CODING_AGENT_DIR/settings.json"; fi
  pi install "npm:@garygentry/system1-pi@$VERSION" >/dev/null 2>&1
  grep -q "system1-pi@$VERSION" "$PI_CODING_AGENT_DIR/settings.json" 2>/dev/null ||
    { echo "smoke[pi:install]: FAIL — pi did not install system1-pi@$VERSION" >&2; return 1; }
  echo "smoke[pi:install]: PASS — system1-pi $VERSION, CLI $(decide version)"
  check pi decide "$(workdir pi)" "pi -p --approve --no-session \"$PROMPT\""
}

mkdir -p "$P"
status=0
for h in claude codex pi; do
  [ "$WHICH" = all ] || [ "$WHICH" = "$h" ] || continue
  if ! command -v "$h" >/dev/null 2>&1; then echo "smoke[$h]: SKIP — not installed"; continue; fi
  # Each harness in a subshell, so one's profile variables never reach the next.
  ("run_$h") || status=1
done
echo "published: outputs in $P"
exit $status
