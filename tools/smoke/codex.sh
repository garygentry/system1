#!/bin/sh
# Codex: isolated CODEX_HOME (your ~/.codex is untouched except auth, which is
# symlinked), marketplace + plugin installed from the working tree, default
# read-only sandbox. Network for `decide` comes from a narrow exec-policy rule,
# the same one `decide doctor` prints and `setup` will offer to write.
. "$(dirname -- "$0")/lib.sh"
global_install
export CODEX_HOME="$SMOKE/codex-home"
rm -rf "$CODEX_HOME"; mkdir -p "$CODEX_HOME/rules"; empty_repo "$SMOKE/codex"
ln -s "$HOME/.codex/auth.json" "$CODEX_HOME/auth.json"
printf 'prefix_rule(pattern = ["decide"], decision = "allow")\n' >"$CODEX_HOME/rules/system1.rules"
codex plugin marketplace add "$REPO" >/dev/null 2>&1
codex plugin add system1@system1 >/dev/null 2>&1
drive() { # $1 = workdir, $2 = prompt, $3 = output file
  (cd "$1" && timeout "$TIMEOUT" codex exec --skip-git-repo-check "$2" </dev/null) >"$3" 2>&1 || true
}
status=0
node "$REPO/tools/smoke/codex-hooks.mjs" "$SMOKE/codex" >"$SMOKE/codex/hooks.txt" 2>&1
assert_marker codex:hooks "$CODEX_HOOKS_MARKER" "$SMOKE/codex/hooks.txt" || status=1
drive "$SMOKE/codex" "\$system1:setup $SETUP_PROMPT" "$SMOKE/codex/ping.txt"
assert_marker codex:setup "$PING_MARKER" "$SMOKE/codex/ping.txt" || status=1
assert_marker codex:setup-skill "$DOCTOR_MARKER" "$SMOKE/codex/ping.txt" || status=1
fixture_repo "$SMOKE/codex-many"
(replay_env; drive "$SMOKE/codex-many" "$MANY_PROMPT" "$SMOKE/codex-many.txt")
assert_marker codex:many "$MANY_MARKER" "$SMOKE/codex-many.txt" || status=1
fixture_repo "$SMOKE/codex-scout"
drive "$SMOKE/codex-scout" "\$system1:scout $SCOUT_PROMPT" "$SMOKE/codex-scout.txt"
assert_marker codex:scout "$SCOUT_MARKER" "$SMOKE/codex-scout.txt" || status=1
consent_repo "$SMOKE/codex-guard"
(log_decide "$SMOKE/codex-guard-log"; drive "$SMOKE/codex-guard" "\$system1:guard $GUARD_PROMPT" "$SMOKE/codex-guard.txt")
assert_marker codex:guard "$GUARD_MARKER" "$SMOKE/codex-guard.txt" || status=1
assert_dormant codex:guard-dormant "$SMOKE/codex-guard" "$SMOKE/codex-guard-log/calls.txt" \
  '^guard enable' || status=1
fixture_repo "$SMOKE/codex-adopt-skill"
drive "$SMOKE/codex-adopt-skill" "\$system1:adopt $ADOPT_PROMPT" "$SMOKE/codex-adopt-skill.txt"
assert_marker codex:adopt "$ADOPT_MARKER" "$SMOKE/codex-adopt-skill.txt" || status=1
fixture_repo "$SMOKE/codex-compare"
drive "$SMOKE/codex-compare" "\$system1:compare $COMPARE_PROMPT" "$SMOKE/codex-compare.txt"
assert_marker codex:compare "$COMPARE_MARKER" "$SMOKE/codex-compare.txt" || status=1
# adopt's Python template: its tests spawn `decide runtime` (node) from Python
# inside the sandbox, where a node child of node has printed nothing before.
# workspace-write, so the tests can use a temp dir; replay, so nothing is sent.
node "$REPO/tools/smoke/adopt-repo.mjs" python "$SMOKE/codex-adopt"
(cd "$SMOKE/codex-adopt" && timeout "$TIMEOUT" codex exec --skip-git-repo-check -s workspace-write \
  "$ADOPT_PYTHON_PROMPT" </dev/null) >"$SMOKE/codex-adopt.txt" 2>&1 || true
assert_marker codex:adopt-python "$ADOPT_PYTHON_MARKER" "$SMOKE/codex-adopt/unittest.txt" || status=1
exit $status
