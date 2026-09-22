# 0013. CLI is the sole execution surface; MCP deferred

- **Status:** accepted
- **Date:** 2026-09-22
- **Supersedes:** 0006 (native Pi extension for tools). **Amends:** 0002, 0005, charter §4–§5.

## Decision

Skills and agents operate everything through the `decide` CLI. v1 ships no MCP server, and no Pi tool extension. The engine keeps its commands as definitions that don't depend on any harness (`core/tools`, TypeBox schemas), so an MCP or Pi adapter can be added later as a thin layer.

## Rationale

- State is passed by reference (specs, globs, diffs), so CLI arguments are small and shell quoting is not a real cost.
- A skill loads only its description until it is needed, whereas MCP tool schemas sit in every session's context.
- Hooks, CI, scripts and agents all share one surface.
- Every first-class harness has a shell. Pi explicitly recommends "CLI tools with READMEs" over MCP.

## What we give up, and how we cover it

- **Typed arguments.** The CLI validates its input with the same TypeBox schemas, returns a typed JSON error envelope, and prints each schema via `decide schema`.
- **A long-lived process.** Spend is recorded in a persisted ledger, and the CLI is installed rather than fetched by `npx` on every call. The startup target is under 150 ms.
- **Sandboxed network (the one real gap).** Codex `workspace-write` has no network by default, and Claude's sandbox needs a domain allowlist. `setup` configures the rule for each harness, and M0 verifies it. This gap is the main trigger for bringing MCP back.
- **Hosts with no shell.** These are out of scope, since the targets are coding agents.

## Revisit when

- the network friction in the Codex or Claude sandbox proves unacceptable in M0 or M4; or
- a target without a shell becomes important.
