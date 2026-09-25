# 0021. `decide` is a product in its own right: one repo, two layers

- **Status:** accepted
- **Date:** 2026-09-25
- **Amends:** 0002 (distribution), 0005 (monorepo layout) in how the repo presents itself; no code moves. **Related:** [0013](0013-cli-first-mcp-deferred.md), [0015](0015-cli-contract-v1.md), [0016](0016-name-system1.md), [0019](0019-scout-guard-adopt-before-partners.md). **Plan:** [`../readme-and-install.md`](../readme-and-install.md).

## Context

The repo set out to ship skills that steer coding agents to a decision model. `decide`, the CLI those skills run, became the foundation: every skill, the routing hook, CI, scripts and (from M11) code that `adopt` generates all call it. Use cases found in *other* repos need `decide` and a per-repo setup (key, consent, specs) whether or not an agent is involved, and a Python service or a CI job never loads a skill.

Two ways to reflect that were weighed:

- **(a) Split `decide` into its own repo** that publishes the CLI and core, with only the skills that teach its use; this repo, or the plugin, depends on it.
- **(b) Keep one repo** and make the boundary between the tool and the agent plugin explicit in the packaging, the install path and the docs.

The package split already exists: `@garygentry/system1` (the CLI), `@garygentry/system1-core` and `@garygentry/system1-pi` are published separately, and nothing stops another repo from installing the CLI alone. What is missing is the *presentation* of that split, and one concrete gap in the install path: a Claude Code plugin install puts `decide` on Claude's Bash PATH only, so `decide` is `command not found` in the user's own terminal, where consent, CI and scripts are run.

## Decision

**(b): one repo, two layers, named as such.**

1. **Layer 1, the `decide` tool:** `packages/core` + `packages/cli`, published as `@garygentry/system1` (bin `decide`) and `@garygentry/system1-core`. It stands on its own: install, key, consent, specs, `ask`/`many`, replay, CI. Its contracts are the CLI envelope and exit codes ([0015](0015-cli-contract-v1.md)) and, from M11 §3, a narrow pinned surface of `system1-core`.
2. **Layer 2, the agent plugin:** `plugins/system1/`, generated per harness. Two tiers of skills:
   - **Core skills** that teach an agent to use layer 1: `setup`, `ask`, `design`. Plus the Claude routing hook.
   - **Use-case packs** that are opt-in workflows built on layer 1: `scout` now, `guard`/`done-check` (M10) and `adopt`/`compare` (M11) next. Each pack already needs an explicit invocation or a repo-level opt-in, so the tier is documented, not enforced by packaging.
3. **A global CLI install is the default install step in every harness**, including Claude Code. The plugin's `bin/decide` shim stays, as the fallback that makes the agent work before the CLI is installed; it already prefers a real `@garygentry/system1` install on PATH over its `npx` fallback.
4. **The README and getting-started lead with layer 1** ("what `decide` is and how to run it"), then layer 2 ("teach your agent to use it"), then the packs.
5. **One version, one release** for both layers, stamped from `catalog.yaml` as today.

Not decided here: renaming the CLI package to match its command (for example `@garygentry/decide`). That would amend [0016](0016-name-system1.md) and is a separate record if taken up.

## Rationale

- **The next work crosses both layers.** M10 adds a hook pack and its `decide` support; M11 adds `decide compare`, the `emulated` provider, the core API promise and two skills. Split repos would double every PR and release while that work is under way.
- **The quality gates test the pair.** Smoke, routing evals, replay fixtures and `release:check` all run skills against one CLI build. Across repos that becomes a version-compatibility matrix.
- **There is no separate consumer yet.** No one outside uses either layer (M12 is design partners). A repo split pays off when someone consumes `decide` apart from the skills, on a different cadence.
- **The discipline a split would force is available without it.** A stable CLI contract exists (0015); a pinned core surface is already required by M11 §3. Keeping those honest is what makes a later split mechanical.
- **The install gap is real and cheap to fix.** A user who installed only the Claude plugin cannot run `decide` in a terminal, which is where consent is granted and where every non-agent use starts. Recommending `npm i -g @garygentry/system1` everywhere removes the Claude-only special case from the docs and the first hour.

## What we give up, and how we cover it

- **A narrow repo with a narrow README for the tool.** Covered by making the README's first screen about `decide` alone, and by the layer table in the README.
- **Independent release cadence.** Not needed yet; one of the revisit triggers.
- **Plugin-only Claude installs stay possible** and still work through the shim (with `! decide … --confirm` for consent). They are documented as the fallback, not the default.

## Revisit when

- The CLI and the plugin want different release cadences (one often bumps while the other doesn't change).
- Someone else's skills, tools or services depend on `decide` and should not follow the plugin's releases.
- `decide` supports decision models beyond Jev and becomes a general tool of its own.
- Outside contributors want to work on the CLI without the agent and eval harness.

If any of these holds, split `packages/core` and `packages/cli` into their own repo and have the plugin pin a CLI version. The shim already pins by version, so the plugin side of that move is small.
