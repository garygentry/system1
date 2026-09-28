# 0007. Cursor, Copilot and other Agent Plugins 1.0 clients are best-effort

- **Status:** accepted
- **Date:** 2026-09-22
- **Source:** planning interview (session 0); see `plans/ROADMAP.md`

## Decision

Cursor, Copilot and other Agent Plugins 1.0 clients are **best-effort**

## Notes

They come for free through the root `plugin.json` and `mcp.json`. CI validates the schema; no smoke tests

## Amendment (2026-09-28, 0.5.1)

**The root `plugin.json` is no longer generated.** Codex 0.155.1 reads a root Agent Plugins manifest in place of `.codex-plugin/plugin.json`, and then loads none of the plugin's hooks, silently: no trust prompt, and `hooks/list` is empty. So 0.5.0's `done-check` could never run in Codex, a first-class harness. That outweighs a manifest for best-effort hosts that no one has ever tested. Best-effort hosts still get the skills (`skills/` at the plugin root). `tools/validate.ts` now fails if a root `plugin.json` appears. Revisit this if Codex or Agent Plugins changes how they're discovered.

## Charter delta

Consistent with / refines `plans/archive/charter.md`.
