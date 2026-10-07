# M12 — Design partners: someone else's first hour

**Status:** **planned (kit ready)**, 2026-10-07. The kit ships with 0.6.1, and the sessions run on 0.6.1 or later (X4). The decisions below are the user's, collected by the coordinating session the same day. Recruiting and the sessions are the user's; this plan and the partner kit are ready.
**Goal:** 3–5 people who have never seen System 1 install it from the docs, in their own harness and their own repo, and reach a decision they'd act on, with nobody helping. Everything they trip on gets a fix or a written reason, and the fixes ship as a release. That is the gate on M13 and on any wider release.

**How to track this plan.** Sessions are written up in `plans/m12/sessions/P<n>.md` from the [observation template](../m12/observation-template.md). Every stall, bug or surprise becomes one row in the [findings log](../m12/findings.md), and the Results section and the gate (D4) are read from that log. Tick the acceptance boxes with the session, PR or release next to each.

## First principles

- **Nobody but the author has used System 1.** Every number in `docs/evaluation.md` was measured on the author's machine, the author's repos and the author's prompts. M12 is the first evidence that isn't.
- **A stall is a finding.** A partner who needed a hint to get past a step tells us the docs or the CLI failed there, even if they got through. We count stalls, not completions alone.
- **Watch, don't help (D3).** Helping fixes the session and hides the bug. The maintainer writes down the question instead of answering it.
- **Their repo, their key, their consent.** The partner grants egress consent themselves, pays for their own calls, and decides what leaves their machine. The kit never asks for a key, never grants consent, and never takes code away without permission.
- **Honest numbers carry over.** Costs in the invite and the results are measured, from the ledger, or labelled projected. A partner's spot-check is reported as agreement counts, not as a calibration curve.
- **One fix round, then a release.** Fixes found in the sessions ship together, as a release, before M13 (D4). The contract guard of M8 still holds: an error code, exit code or envelope change needs its own decision record.

## Decisions (2026-10-07)

The user's answers, collected for this milestone by the coordinating session.

| # | Question | Decision |
|---|---|---|
| D1 | What this session builds for M12 | The milestone doc plus a partner kit. Recruiting and sessions are the user's. Any code change the kit needs ships in 0.6.1. |
| D2 | Who the partners are | Claude Code, Codex and Pi users, some on macOS (which would close known gap 5). |
| D3 | What "unaided" allows | Docs only, the maintainer observes. Partners get the README link and a task; the maintainer watches (or they record) and does not help. Every point where they would have asked counts as a stall to fix. |
| D4 | The gate from M12 to M13 | At least 3 partners reach a useful decision unaided; every stall found has a fix or a written reason; the fix round ships as a release. |

**Defaults taken while writing the kit** (not interview decisions; revisit if the user disagrees):

| # | Default | Why |
|---|---|---|
| X1 | **A useful decision** is a live decision on the partner's own repo that the partner says they'd act on, reached without help. The task sheet says what that looks like per task. | D4 needs a test the maintainer can apply on the spot. "Live" excludes replay; "own repo" excludes the README's examples; "they'd act on it" is the partner's call, not ours. |
| X2 | **Partner-facing pages live in `docs/partners/`; maintainer-facing ones in `plans/m12/`.** The fresh-machine check is `tools/partners/fresh-check.sh`. | Partners may be sent a link, so their pages sit with the other user docs, where the docs test checks every link. The observation sheets and findings are plan tracking ([0012](../decisions/0012-plan-tracking-plans-roadmap-md-plans-milestones-mn.md)). The script is a repo tool with a test, like `tools/smoke/`. |
| X3 | **Pseudonyms only.** Session notes use `P1`…`P5`, the repo's kind but not its name, and no code unless the partner agrees. | The sheets are committed to a public repo. |
| X4 | **0.6.1 carries the kit; the sessions run on 0.6.1 or later; the fix round is a later release.** 0.6.1 (released up to the gate on 2026-10-07, by the user's choice) carries #60's fixes to shipped code (sub-millisecond `latencyMs` in core's compare signals and in the plugin's adopt templates, plus template spec tests), this PR's docs fixes, and the one code change the kit needed: `doctor`'s network fix for Claude Code's sandbox (F5). `v0.6.1` is also the first tag with `tools/partners/fresh-check.sh`. The fix round after the sessions is a later patch release unless a fix needs a contract change. | D1 puts the kit's code changes in 0.6.1, and #60 already needed a release. Partners should install what the kit was checked against. |

## Scope

### 1. The partner kit (this PR)

| Piece | Where | For |
|---|---|---|
| Invite text | [`docs/partners/invite.md`](../../docs/partners/invite.md) | What System 1 is, what's asked (about 90 minutes, a repo, Node 22, an OpenRouter key, measured cost), what leaves the machine and when, what the maintainer keeps |
| First-hour task sheet | [`docs/partners/first-hour.md`](../../docs/partners/first-hour.md) | The README link and four tasks: get it working, a batch, one out of many, and done-check (Claude Code, Codex) or scout (Pi). Each says what counts as useful. It says what to do, never how (D3) |
| Fresh-machine check | `tools/partners/fresh-check.sh` (`pnpm partners:check`), [`docs/partners/fresh-check.md`](../../docs/partners/fresh-check.md) | Installs the published CLI into a throwaway prefix, config dir and repo; checks `decide version`, `doctor` (only key and consent may be missing), a replayed `many`, and `ping`; confirms nothing was granted. Spends nothing. Reports the key's presence only. Tested offline by `tools/partners/fresh-check.test.ts`, so it runs on Ubuntu and macOS in CI |
| Observation template | [`plans/m12/observation-template.md`](../m12/observation-template.md) | Versions, a timeline with the first live and first useful decision, one block per stall, errors verbatim, `doctor` output, cost from the ledger, the per-task outcome and a 10-question debrief |
| Findings log | [`plans/m12/findings.md`](../m12/findings.md) | One row per stall, bug, surprise or wish, with severity, disposition and status. Rows found while writing the kit are already in it (F1–F5) |

**Verified 2026-10-07:** `fresh-check.sh` against the published 0.6.0 on Linux (the script's default is the checkout's version, so at `v0.6.1` it checks 0.6.1) passed all checks (`SETUP NEEDED (key, consent)`, replay `1 kept of 3`, `ping` 189 ms), and `--offline` against the checkout bundle passed too. It hasn't run on a Mac outside CI yet; that is what D2's macOS partners are for.

### 2. Pre-M12 fixes (found while writing the kit)

Fixed in this PR (findings F1–F5; all docs except F5's `doctor` message):

- The README's status line said 0.4.0, and "Where it's going" said M10 was next.
- The Codex rule path was written `$CODEX_HOME/rules/system1.rules`. With `CODEX_HOME` unset, which is the default, a partner who types that gets `/rules/system1.rules`. It now reads `~/.codex/rules/system1.rules`, or under `$CODEX_HOME` if set: the path `decide doctor` already prints.
- The README's Known limits called done-check "planned"; it shipped in 0.5.0.
- The getting-started `doctor` sample showed 0.4.0 and was missing the `guard` check.
- **F5, the Claude sandbox setting.** The docs said "allow `openrouter.ai` if the sandbox is on" without naming the setting, and that alone **doesn't work**. Claude Code's sandbox lets a command out only through its proxy, and Node's `fetch`, which `decide` uses, ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1`. Verified with a sandboxed headless `claude -p` running `decide ping` (Linux, Node 22.23, Claude Code 2.1.293, fresh config dir): `sandbox.network.allowedDomains: ["openrouter.ai"]` alone failed with `EAI_AGAIN`; adding `env.NODE_USE_ENV_PROXY: "1"` passed (213 ms); the proxy variable without the domain was blocked; `excludedCommands: ["decide *"]` passed, unsandboxed. README, getting-started, troubleshooting and the tutorial now give both settings, and `doctor`'s fix line for Claude names them (message text only; contract unchanged). Not yet checked on macOS, whose sandbox (Seatbelt) differs.

Before the first session (larger, or needs verifying first):

- **F6, `decide` ignores proxy variables.** F5's root cause reaches beyond Claude: behind any HTTP proxy (a corporate network, another sandbox), `decide` connects directly. `NODE_USE_ENV_PROXY=1` is the workaround on recent Node. Honouring `HTTPS_PROXY` in the transport itself is the real fix, but it touches the egress path, so it goes to the fix round rather than into 0.6.1 untested.
- **README status line.** It says 0.6.0. Change it to 0.6.1 in the 0.6.1 bump commit, not before: `main` must not get ahead of npm.
- **Main must match npm during M12.** Partners follow the README on `main`. Until the fix round ships, nothing merged to `main` may describe behaviour npm doesn't serve yet. If something must, it waits on a branch, or the session moves to the release that has it.

### 3. Recruiting (the user's)

3–5 partners across Claude Code, Codex and Pi, at least one on macOS (D2). Send [the invite](../../docs/partners/invite.md). Aim for at least one partner per harness, so each harness's first hour is walked by someone who isn't the author.

### 4. Sessions (the user's)

**Before:** run `sh tools/partners/fresh-check.sh` on the release the partner will install (on the maintainer's machine; on the partner's Mac too, if they agree, and their result goes in their sheet). Copy the observation template to `plans/m12/sessions/P<n>.md`. Send the task sheet.

**During:** watch, don't help. Fill in the timeline and a stall block for every point where they'd have asked. Copy errors verbatim.

**After:** run the debrief, collect `decide doctor` and the ledger's cost lines, then add each stall, bug or surprise to the findings log (one row per distinct problem; a repeat adds the session to the existing row).

### 5. The fix round → a release

After the sessions (or as soon as a blocker is clear, if waiting would waste the next session):

- Fix every `blocker` and `slow` row, or give it a written reason. `minor` rows get a fix or a reason too (D4), but needn't block the release.
- The fixes ship as one release, a patch after 0.6.1 if no contract changes (X4), with the usual gates (`pnpm check`, `release:check`, smoke, `eval:routing all`) and verification from the published artifacts.
- Re-run the fresh-machine check on the released version, on Linux and, if a partner can, macOS.

## The first hour, per harness (as the docs say it today)

This is the path a partner is expected to find in the [README](../../README.md) and [getting started](../../docs/getting-started.md). It is written down so stalls can be placed on it; the partner never sees it.

| Step | Claude Code | Codex | Pi |
|---|---|---|---|
| 1. CLI | `npm i -g @garygentry/system1` (optional: the plugin brings its own launcher) | `npm i -g @garygentry/system1` (required: Codex doesn't put plugin `bin/` on PATH) | `npm i -g @garygentry/system1` (required) |
| 2. Plugin | `/plugin marketplace add garygentry/system1`, `/plugin install system1@system1` | `codex plugin marketplace add garygentry/system1`, `codex plugin add system1@system1` | `pi install npm:@garygentry/system1-pi` |
| 3. Network | if the sandbox is on: `sandbox.network.allowedDomains` gets `openrouter.ai`, and `env.NODE_USE_ENV_PROXY` is `"1"` (F5) | the `prefix_rule` in `~/.codex/rules/system1.rules`, then restart Codex | no sandbox |
| 4. Setup | `/system1:setup` | `$system1:setup` | `/skill:setup` |
| 5. Key | `OPENROUTER_API_KEY`, or `~/.config/system1/credentials` (mode 600) | same | same |
| 6. Consent | in a terminal, `decide config egress allow`; plugin-only, `! decide config egress allow --confirm` | in a terminal | in a terminal |
| 7. First decision | ask in their own words; the `ask` skill loads (or the routing hint suggests it) | ask; the skill loads | ask; the skill loads |
| Task 4 | `decide guard enable done-check` in a terminal, plus a criteria file ([guard](../../docs/guard.md)) | the same, then **trust the hooks** when Codex asks | scout instead (`/skill:scout`); Pi has no hooks |

**Where we expect stalls** (to watch for, not to pre-empt): the OpenRouter account and credit; where the key goes; `npm i -g` failing with `EACCES` on a system Node; Claude Code's plugin-only consent through `!`; the Codex restart after the rule; the Codex hook-trust prompt; `undecided` read as an error; and whether the agent reaches for `decide` at all in task 2 without being told (gap 1).

## Known gaps: what M12 expects, and how it's measured

### Gap 1 — Claude doesn't hand off a review of its own work

**Expect:** not closed by M12. The ROADMAP rule stands: no description wording changes without new evidence and `--repeat 3`, and M12 doesn't change the wording.
**Measure:** in each session, for tasks 2–4, record whether the agent used `decide` without the partner naming System 1, whether Claude's routing hint would have fired on their prompt (`decide route --text '<prompt>'`, after the session; it sends nothing), and, for task 4, whether done-check was enabled and what it did at Stop. Report it per harness as "used `decide` unprompted in N of M chances". This is the first measure of gap 1 on prompts nobody wrote for an eval. If Claude partners stall here and Codex and Pi partners don't, that is the evidence the gap's next lever needs (a blind `routing-holdout-3.yaml` built from the partners' own phrasings, with their permission).

### Gap 3 — "Calibrated" is measured only on checkable questions, on the author's code

**Expect:** partial. Partners bring other people's code, which is what the gap asks for, but an hour gives a few dozen labels at most, not a curve.
**Measure:** task 2's spot-check: of three kept and three dropped items, how many the partner agrees with, and the probabilities those items had. With the partner's permission, record each spot-checked item's question, probability and the partner's verdict (no content) in their sheet. Report agreement counts per question type (`noul`, `choice`, `score`) across partners. `docs/calibration.md` is not changed by M12; if the agreement is clearly worse than the published curve suggests, that is a finding and an M13 input.

### Gap 5 — macOS is unverified

**Expect:** closed for each harness a macOS partner walks.
**Measure:** a macOS partner's fresh-machine check result, plus their first hour reaching a live decision in their harness. Gap 5 then lists only the harnesses no macOS partner used. CI's macOS jobs (which now run `fresh-check.test.ts`) stay the floor.

## The gate (D4)

M12 is done, and M13 can start, when all three hold:

1. **At least 3 partners reached a useful decision unaided** (X1), counted from the session sheets.
2. **Every row in the findings log has a disposition** (a fix, or a written reason) and no row is `open`.
3. **The fix round shipped as a release**, verified from the published artifacts, and the fresh-machine check passes on it.

If fewer than 3 partners reach a useful decision, the gate isn't met: fix, release, and run more sessions (with new partners, or the same partners on a fresh profile, recorded as such).

## Risks

- **Recruiting slips.** Three to five people with an hour and an OpenRouter account is the slowest part, and it's outside this repo. *Covered by:* the kit being ready now, and the gate needing three, not five.
- **The maintainer helps.** A partner stuck in front of you is hard to watch. *Covered by:* the template's stall block (write the question instead), and a recording option so the maintainer needn't be live.
- **Main drifts ahead of npm.** Partners follow `main`'s README. *Covered by:* the rule in § 2.
- **A partner's key can't reach Jev.** The endpoint is OpenRouter's alpha decisions path; the fresh-machine check can't test a partner's key, by design. *Covered by:* `doctor` and the first live call naming the provider error; it's logged as a finding like any other.
- **A partner sends something they regret.** *Covered by:* consent is theirs, excludes and scrubbing are always on, and the invite says plainly what is sent. A partner's report of an unexpected send is a `blocker` row.
- **Too few sessions to say anything about gap 3.** Likely. *Covered by:* reporting agreement counts honestly, not a curve.
- **One harness gets no partner.** Then its first hour stays unverified by anyone outside, and the results say so.

## Out of scope

- Recruiting and running the sessions (D1: the user's).
- Routing description changes (gap 1's rule), new commands, a docs site.
- Changing `docs/calibration.md` or the calibration claim.
- M13's hygiene: CHANGELOG, CONTRIBUTING, SECURITY, issue templates, the stability policy, the 1.0 decision.

## Acceptance

- [ ] The kit is merged: invite, task sheet, fresh-machine check (with its test), observation template, findings log.
- [x] F5 (the Claude sandbox setting) is verified and documented before the first Claude Code session. *(2026-10-07, Linux; this PR.)*
- [ ] 3–5 partners recruited, covering Claude Code, Codex and Pi, at least one on macOS (D2).
- [ ] The fresh-machine check passed before every session, and its result is in that session's sheet.
- [ ] Every session has a sheet in `plans/m12/sessions/`, with a debrief and measured cost.
- [ ] At least 3 partners reached a useful decision unaided (D4.1).
- [ ] Gap 1, 3 and 5 measurements recorded as described above.
- [ ] Every findings row has a fix or a written reason (D4.2).
- [ ] The fix round shipped as a release, verified from the published artifacts, with the fresh-machine check passing on it (D4.3).
- [ ] ROADMAP's M12 row, **Where we are** and Known gaps updated from the Results.
- [ ] `pnpm check` green.

## Results

*Empty until the sessions run.*
