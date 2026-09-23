# 0002. Distributed as npm packages run via `npx`, with the version pinned in the generated manifests

- **Status:** accepted; amended by [0013](0013-cli-first-mcp-deferred.md). No MCP `npx` launch. The CLI is installed (plugin `bin/` shim or global install) and pinned to the catalog version
- **Date:** 2026-09-22
- **Source:** planning interview (session 0); see `plans/ROADMAP.md`

## Decision

Distributed as **npm packages run via `npx`**, with the version pinned in the generated manifests

## Notes

Nothing is built at install time; no build output is committed to git

## Charter delta

Consistent with / refines `plans/archive/charter.md`.
