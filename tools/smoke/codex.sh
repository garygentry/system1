#!/bin/sh
# Codex: isolated CODEX_HOME (your ~/.codex is untouched except auth, which is
# symlinked), marketplace + plugin installed from the working tree, default
# read-only sandbox. Network for `decide` comes from a narrow exec-policy rule,
# the same one `setup` will offer to write.
. "$(dirname -- "$0")/lib.sh"
export CODEX_HOME="$SMOKE/codex-home"
rm -rf "$CODEX_HOME"; mkdir -p "$CODEX_HOME/rules" "$SMOKE/codex"
ln -s "$HOME/.codex/auth.json" "$CODEX_HOME/auth.json"
printf 'prefix_rule(pattern = ["decide"], decision = "allow")\n' >"$CODEX_HOME/rules/decisions.rules"
codex plugin marketplace add "$REPO" >/dev/null 2>&1
codex plugin add decisions@decisions >/dev/null 2>&1
out="$SMOKE/codex/out.txt"
(cd "$SMOKE/codex" && timeout "$TIMEOUT" codex exec --skip-git-repo-check "$PROMPT" </dev/null) >"$out" 2>&1 || true
assert_marker codex "$out"
