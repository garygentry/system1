# M12 findings log

One row per stall, bug or surprise found in a design-partner session, or while preparing for one.
The milestone's Results section and its gate ([D4](../milestones/M12-design-partners.md#decisions-2026-10-07))
are read from this table, so every row ends with a disposition.

## Format

| Column | What goes in it |
|---|---|
| `#` | `F<n>`, in the order found. Never renumbered |
| Session | `P<n>` (a [session sheet](sessions/)), or `prep` for one found before any session |
| Harness / OS | e.g. `codex / macOS 15` |
| Kind | `stall` (they'd have asked, or gave up), `bug` (wrong behaviour), `surprise` (worked, but not as they expected), `wish` (they asked for something that doesn't exist) |
| Where | the doc section, command, skill or error they were on |
| What happened | one or two sentences, with the error code if there was one |
| Severity | `blocker` (no useful decision without help), `slow` (got past it, lost minutes), `minor` |
| Disposition | `fix` (with what), `doc` (a doc change), `reason` (not fixed, with the written reason), `later` (moved to M13 or a named issue) |
| Status | `open`, `fixed in <PR>`, `released in <version>`, `closed (reason)` |

Rules:

- **One row per distinct problem.** A second partner hitting the same thing adds their session to
  the existing row's Session column (`P1, P3`); it doesn't get a new row. How many partners hit it
  is the strongest signal of what to fix first.
- **A stall is a finding even if the partner got past it.** D3 counts every point where they'd
  have asked.
- **No row is closed without a fix or a written reason** (D4). "Couldn't reproduce" is a reason
  only with what was tried.
- **Contract guard (0015):** a fix that would change an error code, an exit code or the envelope
  is recorded as `later` with a decision-record note, not slipped into the fix round.

## Log

| # | Session | Harness / OS | Kind | Where | What happened | Severity | Disposition | Status |
|---|---|---|---|---|---|---|---|---|
| F1 | prep | all / — | stall | README, status line | The README said `Status: 0.4.0` and "Next is M10", two releases stale; a partner reading it would doubt what they installed | slow | doc: status 0.6.0, "Where it's going" names M12 | fixed in the M12 kit PR |
| F2 | prep | codex / — | stall | README and getting-started, Codex network column; troubleshooting `network` | The rule file was given as `$CODEX_HOME/rules/system1.rules`. With `CODEX_HOME` unset (the default), that path expands to `/rules/system1.rules` | slow | doc: `~/.codex/rules/system1.rules`, or under `$CODEX_HOME` if set (the path `decide doctor` already prints) | fixed in the M12 kit PR |
| F3 | prep | claude / — | stall | README, Known limits | Said done-check was "planned"; it shipped in 0.5.0 | minor | doc: says it ships, opt-in, links guard.md | fixed in the M12 kit PR |
| F4 | prep | all / — | minor | getting-started, doctor sample | The sample showed 0.4.0 and lacked the `guard` check doctor prints since 0.5.0 | minor | doc: 0.6.0 sample with the `guard` line | fixed in the M12 kit PR |
| F5 | prep | claude / — | stall | README, getting-started and troubleshooting, Claude sandbox | "Allow `openrouter.ai` if the sandbox is on" doesn't say which setting. Not fixed blind: the exact setting has to be verified in a sandboxed Claude Code first | slow (expected) | fix before the first Claude partner: verify and name the setting | open |
