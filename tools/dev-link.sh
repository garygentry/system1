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
    echo "cli:    NOT BUILT. Run 'pnpm build'; until then bin/decide falls back to the published CLI"
  fi
}

# What Claude Code itself loads under the name system1. A marketplace install
# of the same name takes precedence over the link, even when disabled.
report_claude() {
  if ! command -v claude >/dev/null 2>&1; then
    echo "claude: not on PATH, can't ask what it loads"
    return
  fi
  claude plugin list --json 2>/dev/null | node -e '
    let raw = ""
    process.stdin.on("data", (d) => (raw += d)).on("end", () => {
      let list
      try { list = JSON.parse(raw) } catch { return console.log("claude: could not read `claude plugin list --json`") }
      const ours = list.filter((p) => p.id.split("@")[0] === "system1")
      if (ours.length === 0) return console.log("claude: no system1 plugin installed or linked")
      for (const p of ours) {
        const why = p.errors?.[0]?.replace(/^Not loaded\W+/, "")
        const state = why ? `not loaded: ${why}` : p.enabled ? "enabled" : "disabled"
        console.log(`claude: ${p.id} ${state}`)
      }
      const installed = ours.find((p) => p.id !== "system1@skills-dir")
      if (installed) console.log(`        To use the link instead: claude plugin uninstall ${installed.id}`)
    })
  ' || echo "claude: could not run \`claude plugin list --json\`"
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
    echo "link:   $LINK -> $PLUGIN"
  fi
  check_bundle
  report_claude
  echo "Start a new Claude Code session to pick it up."
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
  report_claude
}

[ $# -eq 1 ] || usage
case "$1" in
link) do_link ;;
unlink) do_unlink ;;
status) do_status ;;
*) usage ;;
esac
