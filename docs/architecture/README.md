# Architecture

Maintainer docs for the code as it stands at 0.3.1: what runs, where each rule is enforced, and how
a change gets built, checked and released. They describe what shipped, not the envisioned product.
Where [plans/ROADMAP.md](../../plans/ROADMAP.md) sketches something different (its § Architecture
diagram and harness matrix are older than the code), these pages follow the code.

Every structural claim here traces to a file, named in backticks as a repo-relative path. If a
page and the code disagree, the code is right and the page is a bug.

## Pages

| Page | What it covers |
|---|---|
| [context.md](context.md) | System 1 as one box: the people and systems it touches |
| [containers.md](containers.md) | The plugin, the CLI, the engine and the Pi package; how each harness reaches `decide`; local state |
| [building-blocks.md](building-blocks.md) | The modules of `packages/core` and which depends on which |
| [runtime.md](runtime.md) | One `decide many` call end to end, its failure paths, and the Claude prompt hook |
| [deployment.md](deployment.md) | `catalog.yaml` to generated files, the bundle, how the shim picks a CLI, CI |
| [crosscutting.md](crosscutting.md) | Egress, honest numbers, the CLI contract, config and secrets: where each is enforced |
| [quality.md](quality.md) | Every gate, the command that runs it, and the current bar |

The release procedure is a how-to: [../contributing/release.md](../contributing/release.md).

## Read with

- [AGENTS.md](../../AGENTS.md): layout, the rules every change keeps, commands, and the verified
  harness notes. These pages link its rules rather than restating them.
- [plans/ROADMAP.md § Known gaps](../../plans/ROADMAP.md#known-gaps): the live limitations. Pages
  here link the gap they touch.
- [plans/decisions/](../../plans/decisions/): the ratified decision records. The ones that shape
  the code most are [0013](../../plans/decisions/0013-cli-first-mcp-deferred.md) (CLI only, no
  MCP), [0015](../../plans/decisions/0015-cli-contract-v1.md) (the CLI contract),
  [0017](../../plans/decisions/0017-fan-out-through-the-cli-not-subagents.md) (fan-out through
  the CLI) and [0018](../../plans/decisions/0018-claude-routing-hook.md) (the Claude prompt hook).
