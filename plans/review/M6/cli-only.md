# Pass 1 — the CLI-only bet

**The decision under review:** `plans/decisions/0013-cli-first-mcp-deferred.md`. Everything runs through the `decide` CLI, driven by skills. There is no MCP server, and no plugin-provided tools.

**What was measured in M0–M5** (see `plans/milestones/`):
- Codex's sandbox blocks the network by default. The fix is a rules file the user writes, `prefix_rule(pattern = ["decide"], decision = "allow")`, and **a plugin cannot ship it**.
- That rule only covers commands that *start with* `decide`: `echo x | decide …` runs without network, so every recipe writes content to a file first.
- Inside the Codex sandbox, a child process spawned by node returns empty stdout, so `doctor` can't read the version of the `decide` on PATH there.
- Claude Code puts the plugin's `bin/` on PATH; Codex and Pi do not, so users need a global install.

**Judge:**
1. Does CLI-plus-skills still hold as the only execution surface, given that friction? Where does it break down for a user who installs this for the first time?
2. What would an MCP server actually fix here, and what would it cost (context per session, a second surface to version, the sandbox question)? Is the deferral still right at 0.1.0?
3. Is the skill → CLI boundary sound? Skills must never call HTTP and must pass state by reference. Look for places where an agent is likely to do something expensive or wrong because the CLI made the cheap path awkward.
4. Startup and ergonomics: `packages/cli/src/entry.ts`, `bundled.ts`, the generated shim `plugins/system1/bin/decide`, `tools/bench-startup.ts`. Is the shim's resolution order (`SYSTEM1_CLI`, checkout bundle, global `decide`, pinned `npx`) safe and predictable?
5. Anything about this approach that will age badly once real users depend on it.

Try it: run the CLI in replay in a scratch git repo, act like an agent following `plugins/system1/skills/ask/SKILL.md` and its `references/recipes.md`, and see what breaks.
