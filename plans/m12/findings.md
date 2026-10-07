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
| F5 | prep | claude / Linux | bug | README, getting-started, troubleshooting, tutorial; `doctor`'s network fix | "Allow `openrouter.ai` if the sandbox is on" named no setting, and allowing the domain alone fails (`EAI_AGAIN`): Node's `fetch` ignores the sandbox proxy unless `NODE_USE_ENV_PROXY=1`. Verified with a sandboxed `claude -p` running `decide ping` | blocker | doc + fix: both settings documented; `doctor`'s fix line names them, with the Node minimum (`NODE_USE_ENV_PROXY` exists from Node 22.21.0 and 24.0.0, no 23.x, per Node's CLI docs), and tells an older Node to upgrade | fixed in the M12 kit PR (ships in 0.6.1); macOS unchecked |
| F6 | prep | all / — | bug | the transport | `decide` ignores `HTTPS_PROXY`/`HTTP_PROXY`, so it can't work behind any HTTP proxy without `NODE_USE_ENV_PROXY=1` (F5's cause) | slow | later: honour the proxy variables in the transport, in the fix round (it touches the egress path) | open |
