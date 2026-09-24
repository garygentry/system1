#!/bin/sh
# Load the System 1 plugin into Claude Code from this checkout instead of a
# marketplace install (docs/contributing/local-plugin.md).
#
#   sh tools/dev-link.sh link | unlink | status
#
# link:   symlink <claude config>/skills/system1 to plugins/system1. Claude Code
#         loads it as system1@skills-dir in every new session, for this user.
# unlink: remove that symlink, only if it points at this checkout.
# status: show the link, the CLI build, and what Claude Code reports loading.
#
# The config dir is $CLAUDE_CONFIG_DIR, else ~/.claude. Nothing else is written:
# no settings.json, no marketplace or install records.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
PLUGIN="$ROOT/plugins/system1"
BUNDLE="$ROOT/packages/cli/dist/bundle/decide.mjs"
SKILLS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
LINK="$SKILLS/system1"

usage() {
  echo "usage: dev-link.sh link | unlink | status" >&2
  exit 2
}

# The directory a symlink resolves to, or its raw target if that's gone.
resolved() {
  (CDPATH= cd -- "$1" 2>/dev/null && pwd -P) || readlink "$1"
}

# 0 when $LINK is a symlink to this checkout's plugin.
ours() {
  [ -L "$LINK" ] && [ "$(resolved "$LINK")" = "$PLUGIN" ]
}

check_bundle() {
  if [ -f "$BUNDLE" ]; then
    echo "cli:    built ($BUNDLE)"
  else
    echo "cli:    NOT BUILT. Run 'pnpm build'; until then bin/decide runs an installed or published CLI instead"
  fi
}

# What Claude Code itself loads under the name system1, as seen from the
# current directory (a project-scope install elsewhere isn't visible here).
# An installed plugin of the same name takes precedence over the link, even
# when disabled. Returns 3 when Claude reports the link as not loaded.
report_claude() {
  if ! command -v claude >/dev/null 2>&1; then
    echo "claude: not on PATH, can't ask what it loads"
    return 0
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "claude: node not on PATH, can't read what it loads"
    return 0
  fi
  out=$(claude plugin list --json 2>/dev/null) || out=""
  printf '%s' "$out" | node -e '
    let raw = ""
    process.stdin.on("data", (d) => (raw += d)).on("end", () => {
      let list
      try {
        list = JSON.parse(raw)
      } catch {}
      if (!Array.isArray(list)) {
        console.log("claude: unexpected output from `claude plugin list --json`")
        return
      }
      const idOf = (p) => String(p?.id ?? "")
      const ours = list.filter((p) => idOf(p).split("@")[0] === "system1")
      if (ours.length === 0) return console.log("claude: no system1 plugin installed or linked")
      for (const p of ours) {
        // Claude appends advice to rename the plugin; its plugin.json is
        // generated, so keep only the first sentence.
        const first = Array.isArray(p.errors) ? p.errors.find((e) => typeof e === "string") : undefined
        const why = first?.replace(/^Not loaded\W+/, "").split(". ")[0]
        const scope = p.scope && p.scope !== "user" ? ` (${p.scope} scope)` : ""
        const state = why ? `not loaded: ${why}` : p.enabled ? "enabled" : "disabled"
        console.log(`claude: ${idOf(p)}${scope} ${state}`)
      }
      const linked = ours.find((p) => idOf(p) === "system1@skills-dir")
      if (!linked || !Array.isArray(linked.errors) || linked.errors.length === 0) return
      for (const p of ours.filter((p) => p !== linked)) {
        const scope = p.scope ? ` --scope ${p.scope}` : ""
        console.log(`        To use the link instead: claude plugin uninstall ${idOf(p)}${scope}`)
      }
      process.exitCode = 3
    })
  '
}

do_link() {
  if ours; then
    echo "link:   already linked ($LINK -> $PLUGIN)"
  elif [ -L "$LINK" ]; then
    echo "dev-link: $LINK already links to $(resolved "$LINK")." >&2
    echo "          Unlink it from that checkout, or remove it: rm '$LINK'" >&2
    exit 1
  elif [ -e "$LINK" ]; then
    echo "dev-link: $LINK exists and is not a symlink. Leaving it alone." >&2
    exit 1
  else
    mkdir -p "$SKILLS"
    ln -s "$PLUGIN" "$LINK"
    # If a directory appeared at $LINK since the check, ln put the link inside
    # it. Take that back out and stop.
    if ! ours; then
      [ -L "$LINK/system1" ] && rm -f "$LINK/system1"
      echo "dev-link: $LINK changed while linking. Leaving it alone." >&2
      exit 1
    fi
    echo "link:   $LINK -> $PLUGIN"
  fi
  check_bundle
  rc=0
  report_claude || rc=$?
  if [ "$rc" -eq 3 ]; then
    echo "Linked, but Claude Code won't load it until the plugin above is uninstalled."
  else
    echo "Start a new Claude Code session to pick it up."
  fi
}

do_unlink() {
  if ours; then
    rm -f "$LINK"
    echo "link:   removed $LINK"
  elif [ -L "$LINK" ]; then
    echo "dev-link: $LINK links to $(resolved "$LINK"), not this checkout. Leaving it alone." >&2
    exit 1
  elif [ -e "$LINK" ]; then
    echo "dev-link: $LINK is not a symlink. Leaving it alone." >&2
    exit 1
  else
    echo "link:   not linked"
  fi
}

do_status() {
  if ours; then
    echo "link:   $LINK -> $PLUGIN"
  elif [ -L "$LINK" ]; then
    echo "link:   $LINK -> $(resolved "$LINK") (not this checkout)"
  elif [ -e "$LINK" ]; then
    echo "link:   $LINK exists and is not a symlink"
  else
    echo "link:   not linked"
  fi
  check_bundle
  report_claude || true
}

[ $# -eq 1 ] || usage
case "$1" in
link) do_link ;;
unlink) do_unlink ;;
status) do_status ;;
*) usage ;;
esac
