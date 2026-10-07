#!/bin/sh
# The M12 fresh-machine check (plans/milestones/M12-design-partners.md).
# Run it before each partner session, and on a partner's Mac if they agree.
# It installs the published CLI into a throwaway prefix, with a throwaway
# config dir and a throwaway repo, and checks `decide` works there. It spends
# nothing: the decisions are replayed, and `ping` needs no key.
#
#   sh tools/partners/fresh-check.sh [--version X.Y.Z] [--decide <path>] [--offline] [--keep]
#
#   --version   the release to install (default: this checkout's version)
#   --decide    use this decide (an executable, or a .mjs bundle) instead of
#               installing from npm; for checking a build before it ships
#   --offline   send nothing at all: skip `ping`, and point doctor's probe at a
#               loopback port fetch refuses (needs --decide)
#   --keep      keep the work dir and print where it is
#
# What it never does: grant egress consent, write a key, or read one. It says
# only whether your own profile has a key (in the environment or a credentials
# file), and the checks themselves run with no key at all.
set -eu
REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)

VERSION= DECIDE= OFFLINE=0 KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
  --version) VERSION=${2:-}; shift 2 ;;
  --decide) DECIDE=${2:-}; shift 2 ;;
  --offline) OFFLINE=1; shift ;;
  --keep) KEEP=1; shift ;;
  *) echo "fresh-check: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$VERSION" ] || VERSION=$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$REPO/package.json" | head -1)
if [ "$OFFLINE" = 1 ] && [ -z "$DECIDE" ]; then
  echo "fresh-check: --offline needs --decide (installing from npm uses the network)" >&2; exit 2
fi

FAILED=0
pass() { echo "fresh-check[$1]: PASS — $2"; }
fail() { echo "fresh-check[$1]: FAIL — $2"; FAILED=1; }
info() { echo "fresh-check[$1]: INFO — $2"; }

# --- This machine, as the partner has it (read only) -------------------------
OS=$(uname -sm)
NODE=$(node --version 2>/dev/null || echo none)
NPM=$(npm --version 2>/dev/null || echo none)
case "$NODE" in
v2[2-9].* | v[3-9][0-9].*) pass node "$NODE on $OS" ;;
*) fail node "$NODE: decide needs Node 22 or newer" ;;
esac
command -v git >/dev/null 2>&1 && pass git "$(git --version)" || fail git "git not found"
HARNESSES=
for h in claude codex pi; do
  if command -v "$h" >/dev/null 2>&1; then
    v=$("$h" --version </dev/null 2>/dev/null | head -1 || true)
    HARNESSES="$HARNESSES $h=${v:-unknown}"
  fi
done
[ -n "$HARNESSES" ] || HARNESSES=" none found"
info harnesses "${HARNESSES# }"

# Presence only. The file is tested for existence, never opened.
KEY=absent
[ -n "${OPENROUTER_API_KEY:-}" ] && KEY="present (environment)"
CREDS="${XDG_CONFIG_HOME:-$HOME/.config}/system1/credentials"
if [ -f "$CREDS" ]; then
  [ "$KEY" = absent ] && KEY="present (credentials file)" || KEY="$KEY, and a credentials file"
fi
info key "your profile: $KEY (not used by these checks)"

# --- A clean profile ---------------------------------------------------------
W=$(mktemp -d "${TMPDIR:-/tmp}/system1-fresh.XXXXXX")
W=$(CDPATH= cd -- "$W" && pwd -P)
cleanup() { if [ "$KEEP" = 1 ]; then echo "fresh-check: work dir kept at $W"; else rm -rf "$W"; fi; }
trap cleanup EXIT

# Nothing from this shell reaches decide: no key, no SYSTEM1_* settings, no
# parent harness (its session id would land in the ledger), and a config dir
# of its own, so the real user config and credentials are never read.
unset OPENROUTER_API_KEY
for v in $(env | sed -n 's/^\(SYSTEM1_[A-Z_]*\|CLAUDE[A-Z_]*\|CODEX_[A-Z_]*\|PI_[A-Z_]*\|AI_AGENT\)=.*/\1/p'); do
  unset "$v"
done
export XDG_CONFIG_HOME="$W/xdg"
mkdir -p "$XDG_CONFIG_HOME"
[ "$OFFLINE" = 1 ] && export SYSTEM1_ENDPOINT="http://127.0.0.1:9/api/alpha/decisions"

# A Claude session's PATH carries plugin bin/ dirs with their own decide; drop
# them and any other System 1 shim, so doctor sees the decide checked here.
clean_path=
old_ifs=$IFS; IFS=:
for dir in $PATH; do
  case $dir in */.claude/*) continue ;; esac
  if [ -x "$dir/decide" ] && grep -qs "system1-shim" "$dir/decide"; then continue; fi
  clean_path=${clean_path:+$clean_path:}$dir
done
IFS=$old_ifs

mkdir -p "$W/bin"
if [ -n "$DECIDE" ]; then
  case "$DECIDE" in /*) ;; *) DECIDE="$(pwd -P)/$DECIDE" ;; esac
  case "$DECIDE" in
  *.mjs | *.js) printf '#!/bin/sh\nexec node "%s" "$@"\n' "$DECIDE" >"$W/bin/decide" ;;
  *) printf '#!/bin/sh\nexec "%s" "$@"\n' "$DECIDE" >"$W/bin/decide" ;;
  esac
  chmod +x "$W/bin/decide"
  info install "using $DECIDE"
elif npm i -g --prefix "$W/npm" "@garygentry/system1@$VERSION" >"$W/npm.log" 2>&1; then
  ln -s "$W/npm/bin/decide" "$W/bin/decide"
  pass install "@garygentry/system1@$VERSION from npm"
else
  fail install "npm could not install @garygentry/system1@$VERSION (log: $W/npm.log)"
  KEEP=1
  exit 1
fi
export PATH="$W/bin:$clean_path"

GOT=$(decide version 2>/dev/null | head -1 || true)
case "$GOT" in
*"$VERSION"*) pass version "$GOT" ;;
*) if [ -n "$DECIDE" ]; then info version "${GOT:-no output}"; else fail version "${GOT:-no output}, expected $VERSION"; fi ;;
esac

# A small repo with a saved spec and its recorded answers, so a decision can
# be replayed with no key and no consent.
R="$W/repo"
mkdir -p "$R/.system1"
cp -R "$REPO/tools/smoke/fixture-repo/src" "$REPO/tools/smoke/fixture-repo/README.md" "$R/"
cp -R "$REPO/tools/smoke/fixture-repo/.system1/specs" "$REPO/tools/smoke/fixture-repo/.system1/fixtures" "$R/.system1/"
git -C "$R" init -q

# --- doctor ------------------------------------------------------------------
(cd "$R" && decide doctor --format brief) >"$W/doctor.txt" 2>&1 || true
(cd "$R" && decide doctor) >"$W/doctor.json" 2>/dev/null || true
sed 's/^/  /' "$W/doctor.txt"
# In a clean profile, the key and consent are the only things missing; any
# other warning or failure is a problem with the install or this machine.
verdict=$(node -e '
  const fs = require("fs"), [file, offline] = process.argv.slice(1)
  let r
  try { r = JSON.parse(fs.readFileSync(file, "utf8")).result } catch { console.log("no JSON from doctor"); process.exit() }
  const expected = new Set(["key", "consent"])
  const bad = r.checks.filter((c) => c.status !== "ok" && !expected.has(c.name) &&
    !(offline === "1" && c.name === "network"))
  const want = ["key", "consent"].filter((n) => r.checks.find((c) => c.name === n)?.status !== "warn")
  if (want.length) console.log(`expected a warning for ${want.join(", ")} in a clean profile`)
  else if (bad.length) console.log(bad.map((c) => `${c.status} ${c.name}: ${c.detail}`).join("; "))
  else console.log("ok")
' "$W/doctor.json" "$OFFLINE")
if [ "$verdict" = ok ]; then
  pass doctor "$(head -1 "$W/doctor.txt")"
else
  fail doctor "$verdict"
fi

# --- a replayed decision ------------------------------------------------------
(cd "$R" && decide many --spec smoke --format brief) >"$W/many.txt" 2>&1 || true
if grep -q "^decide many: 1 kept of 3 · 0 undecided · 2 dropped · replay " "$W/many.txt"; then
  pass replay "$(head -1 "$W/many.txt")"
else
  fail replay "$(head -3 "$W/many.txt" | tr '\n' ' ')"
fi

# --- the endpoint, for free ---------------------------------------------------
if [ "$OFFLINE" = 1 ]; then
  info ping "skipped (--offline)"
elif (cd "$R" && decide ping --format brief) >"$W/ping.txt" 2>&1; then
  pass ping "$(head -1 "$W/ping.txt")"
else
  fail ping "$(head -1 "$W/ping.txt")"
fi

# --- nothing was granted -------------------------------------------------------
if [ -e "$R/.system1/config.yaml" ] || [ -e "$XDG_CONFIG_HOME/system1/credentials" ]; then
  fail untouched "a config or credentials file appeared during the check"
else
  pass untouched "no consent and no credentials were written"
fi

echo
echo "For the observation sheet:"
echo "  os: $OS · node: $NODE · npm: $NPM"
echo "  decide: ${GOT:-unknown} · harnesses:$HARNESSES"
echo "  key in your profile: $KEY"
if [ "$FAILED" = 0 ]; then echo "fresh-check: PASS"; else echo "fresh-check: FAIL"; KEEP=1; fi
exit $FAILED
