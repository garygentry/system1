#!/bin/sh
# Codex: isolated CODEX_HOME (your ~/.codex is untouched except auth, which is
# symlinked), marketplace + plugin installed from the working tree, default
# read-only sandbox. Network for `decide` comes from a narrow exec-policy rule,
# the same one `decide doctor` prints and `setup` will offer to write.
. "$(dirname -- "$0")/lib.sh"
global_install
export CODEX_HOME="$SMOKE/codex-home"
rm -rf "$CODEX_HOME"; mkdir -p "$CODEX_HOME/rules" "$SMOKE/codex"
ln -s "$HOME/.codex/auth.json" "$CODEX_HOME/auth.json"
printf 'prefix_rule(pattern = ["decide"], decision = "allow")\n' >"$CODEX_HOME/rules/decisions.rules"
codex plugin marketplace add "$REPO" >/dev/null 2>&1
codex plugin add decisions@decisions >/dev/null 2>&1
drive() { # $1 = workdir, $2 = prompt, $3 = output file
  (cd "$1" && timeout "$TIMEOUT" codex exec --skip-git-repo-check "$2" </dev/null) >"$3" 2>&1 || true
}
status=0
drive "$SMOKE/codex" "$PING_PROMPT" "$SMOKE/codex/ping.txt"
assert_marker codex:ping "$PING_MARKER" "$SMOKE/codex/ping.txt" || status=1
fixture_repo "$SMOKE/codex-many"
(replay_env; drive "$SMOKE/codex-many" "$MANY_PROMPT" "$SMOKE/codex-many.txt")
assert_marker codex:many "$MANY_MARKER" "$SMOKE/codex-many.txt" || status=1
exit $status
