# Run the plugin from your checkout

When you're working on System 1, you usually want Claude Code to load the plugin from your clone,
so that every new session gets your latest skills, hook and CLI build, without reinstalling
anything. `tools/dev-link.sh` does this with one symlink, and removes it again when you want the
marketplace version back.

This covers Claude Code only. Codex and Pi load plugins differently; see
[`AGENTS.md`](../../AGENTS.md#harness-notes-verified-in-m0-2026-09-22).

## Link and unlink

From the repo root, after `pnpm install`:

```sh
pnpm build        # the plugin's decide runs this checkout's CLI build
pnpm dev:link     # load the plugin from this checkout in every new session
pnpm dev:status   # show the link, the build, and what Claude Code loads
pnpm dev:unlink   # stop
```

`dev:link` creates `~/.claude/skills/system1` as a symlink to `plugins/system1`. Claude Code loads
a plugin directory found there as `system1@skills-dir`, for your user, in every project. Nothing
else is written: no `settings.json` entry, no marketplace, no install record. If you set
`CLAUDE_CONFIG_DIR`, the link goes under that directory instead of `~/.claude`.

The script only removes a link that points at this checkout. If `~/.claude/skills/system1` is a
real directory, or a link to another clone, it leaves it alone, says so and exits 1.

To load the plugin for a single session instead, start Claude Code with
`claude --plugin-dir plugins/system1`. This is what `pnpm smoke` does.

## What updates when

| You change | It takes effect |
|---|---|
| A skill, or the hook config under `plugins/system1/` | in the next session |
| CLI or core code under `packages/` | after `pnpm build`, in the next `decide` call |
| `catalog.yaml` or the generator | after `pnpm generate` (and `pnpm build` if the version changed) |

The plugin's `bin/decide` shim follows the symlink back to this checkout and runs
`packages/cli/dist/bundle/decide.mjs`
([how the shim resolves decide](../architecture/deployment.md#how-the-shim-resolves-decide)).
If you haven't built yet, it falls back to the published CLI, pinned to the plugin's version.
`dev:status` warns when the build is missing.

`decide` is on PATH only inside Claude Code sessions. In your own shell, run
`node packages/cli/dist/bundle/decide.mjs`.

## Switch to the marketplace version

An installed plugin named `system1` takes precedence over the link, even when it is disabled. With
both present, Claude Code loads the installed one, and `dev:status` shows the link as not loaded
and tells you which plugin is in the way.

To go from the checkout to the marketplace:

```sh
pnpm dev:unlink
claude plugin marketplace add garygentry/system1
claude plugin install system1@system1
```

To go back to the checkout:

```sh
claude plugin uninstall system1@system1
pnpm dev:link
```

Start a new session after either switch.
