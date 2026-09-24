# M9–M11 — Scout, guard, adopt: from finding decisions to shipping them

**Status:** planned 2026-09-24. The decisions below came from interviewing the user. Ratified as [0019](../decisions/0019-scout-guard-adopt-before-partners.md).
**Supersedes:** `plans/later-scout-opportunities.md` (its scope is §M9 below; its D1–D4 carry over unchanged).
**Goal:** Give developers a surface that finds where a decision model would pay off in their own code and agent configuration (`scout`), catch Claude declaring work done before it is (`guard` / `done-check`), and turn a found opportunity into shipped, measured code (`adopt` + `compare`). Three milestones, three releases, each useful on its own.

**How to track this plan.** Each milestone has a numbered work list and an acceptance checklist. Tick boxes as work lands, with the commit or PR next to the box. When a milestone closes, set its status line, update its row in `ROADMAP.md`, and write its results (measured costs, eval numbers, surprises) into a `Results` section here — the way M7 and M8 recorded theirs.

## Sequence

| M | Title | Release | Depends on |
|---|---|---|---|
| **M9** | `scout`: find the decisions worth handing over, plus `decide opportunities` and the spec lint | **0.4.0** | — |
| **M10** | `guard`: opt-in decision-backed hooks, first pack `done-check` | **0.5.0** | M9's lint (done-check criteria are questions) |
| **M11** | `adopt` + `compare`: from one opportunity to measured, shipped code, with the `emulated` baseline | **0.6.0** | M9's backlog; M9's lint |
| M12 | Design partners (was M9) | — | M11 |
| M13 | Release hygiene and 1.0 decision (was M10) | — | M12 |

## First principles

- **Scout is its own best demo.** Finding opportunities is screening many items against the same closed question. It screens with `decide many`, never by reading everything or spawning agents ([0017](../decisions/0017-fan-out-through-the-cli-not-subagents.md)).
- **Project, then measure.** `scout` projects savings and labels every figure projected. `compare` measures. Nothing in between claims a measured saving.
- **Artifacts, not transcripts.** The backlog (`.system1/opportunities.json`), guard state and compare reports are typed files owned by the CLI, validated by it, and readable by the next command.
- **One engine, one egress path.** Every new path to a provider — screening, the Stop hook, the emulated baseline, adopted runtime code — goes through `prepare()` and a decider built with consent. No exceptions are added by this plan.
- **Skills stay harness-neutral; harness specifics live in generated hooks.** Skills describe intent and run `decide`. Hook wiring is generated per harness from `catalog.yaml` / `tools/generate.ts`.
- **Undecided is never rounded.** Every new surface reports undecided apart from kept/dropped, and no gate blocks on an undecided answer.

## Decisions (interview, 2026-09-24)

| # | Question | Decision |
|---|---|---|
| D1 | Where does scout sit relative to design partners? | **Before them.** Scout, guard and adopt become M9–M11; partners move to M12 and try the whole chain. A partner pointing `scout` at their own repo is a stronger first hour than an empty `ask`. Accepted cost: outside feedback on the core comes later. |
| D2 | How much of guard? | **The framework plus one pack, `done-check`** (Stop hook, one verdict per acceptance criterion). `command-guard` and `loop-check` stay later. Claude first; Codex only if its hooks verify (M10 §1); Pi needs an extension and is out. |
| D3 | Are `adopt` and `compare` in scope? | **Yes, both, in full:** policy-module generation with fallback, a shadow run, and the `emulated` provider. |
| D4 | How is it released? | **Three releases:** 0.4.0 (M9), 0.5.0 (M10), 0.6.0 (M11). Each passes the full release gates. Guard goes before adopt because it is small and closes Known gap #1 sooner. |
| D5 | What does `compare` run against? | **Both baselines:** the repo's current mechanism (its outputs captured into a JSONL by a harness `adopt` generates — the engine never runs user code, [0014](../decisions/0014-no-command-source.md)) and an `emulated` chat-model profile on OpenRouter (same key and consent path, `calibrated: false`, single values, never invented distributions). |
| D6 | Which languages does `adopt` generate for? | **TypeScript and Python**, each with offline fixture-backed tests. |
| D7 | How does adopted code call the model at runtime? | **Through the System 1 engine.** TypeScript imports `@garygentry/system1-core`; Python shells out to `decide ask --spec`. Every runtime call goes through `prepare()`, replay fixtures and the spend ledger. How consent is given for app runtime (not an agent session) is settled in M11 §1 with its own decision record. |
| D8 | Where does `done-check` get its criteria? | **Configured files.** `guard.done-check.criteria` lists paths (default `TASK.md`, `.system1/done.md`), one criterion per bullet. No criteria file, no diff → silent, no egress. |
| D9 | What does `done-check` do on an unmet criterion? | **Block once, then allow.** Block the stop, naming each confidently unmet criterion. If the agent stops again (`stop_hook_active`), let it through. Undecided never blocks and is reported. Fail open on provider error or latency budget. |

**Defaults taken without interview** (override by editing here before the milestone starts):

| # | Question | Default |
|---|---|---|
| X1 | Is there a `shadow-evaluator` agent? | **No** ([0017](../decisions/0017-fan-out-through-the-cli-not-subagents.md)). `compare` is a CLI tool plus a skill; the reduction is code, the write-up is the agent following the skill. |
| X2 | Do lint checks fail or warn? | **All heuristic checks warn**; only checks that are mechanically certain fail (e.g. a threshold naming a question that doesn't exist, already caught by `validate`). `--strict` promotes warnings to exit 7, so users can gate CI on it. |
| X3 | One signal set or two? | **Two** (`signals-code.yaml`, `signals-agents.yaml`) plus a shared `anti-signals.yaml` included by both. |
| X4 | How do opportunity ids stay stable? | Content hash over `(mode, path, normalised evidence excerpt)`. A re-run that finds the same excerpt updates the entry's location and `seen_at`; a changed excerpt is a new entry, and the old one is marked `stale`, never deleted. |
| X5 | Can `opportunities add` create `.system1/`? | **Yes.** It writes locally and sends nothing, so consent ([0009](../decisions/0009-egress-consent-once-per-repo.md)) is not in play. |
| X6 | Is enabling a guard pack a consent act? | **Yes.** It opts every matching event into egress, so `decide guard enable <pack>` follows the same rule as `config egress allow`: it needs `--confirm` typed by the user, and skills must never run it themselves. |
| X7 | Is `calibrate` in scope? | **No.** `compare` hands off to it when labels exist; it gets its own plan after M11. |

---

## M9 — `scout` (release 0.4.0)

**Status:** not started.
**Carries over** `later-scout-opportunities.md` §1–§6 and its D1–D4. The detail there is authoritative where this section is brief.

### Work

1. **`decide opportunities add|list|check`.** A typed tool in `packages/core/src/tools/opportunities.ts` (TypeBox schema + handler), mapped in `packages/cli/src/commands/`. `list` reuses `many`'s `--keep/--sort/--limit/--fields` parser. The record: id, mode (`code`|`agents`), location, current mechanism, proposed shape (`single`|`fanout`|`cascade`|`pairwise`), evidence excerpt, draft question set (in the `--questions` YAML shape), projected saving with its inputs (`volume`, `current_cost_per_item`, `decision_cost_per_item`), risk, next step, status (`new`|`stale`|`adopted`|`rejected`), and `source` (sweep id; `live`|`replay`).
2. **`decide spec lint`**, and `spec check` runs it first. Offline: no key, no consent, no egress. The checks are the failure-mode catalogue in `later-scout-opportunities.md` §2; severity per X2.
3. **The signal tables** as data in `plugins/system1/skills/scout/references/` (X3), with the anti-signal questions in the same pass so one call screens in and out.
4. **`scout` skill** (user-invocable; `disable-model-invocation`, and `allow_implicit_invocation: false` in `agents/openai.yaml`). Resolve the target → partition → `decide many --questions … --keep … --format brief` per partition → read survivors only → draft a question set and a projected saving per candidate → `decide opportunities add --file` → report the ranked top N. `--depth quick|full`. Undecided listed apart.
5. **`design` gains `references/failure-modes.md`**, each failure with an example and its repair, and runs `spec lint` before saving.
6. **`catalog.yaml` + generator:** register `scout`; `pnpm generate`.
7. **Routing evals:** `scout` positives (explicit invocation in all three harnesses) and negatives (it must not take `ask` or `design` prompts); re-run the `ask` set on `--repeat 3`.
8. **Docs:** `docs/` page for scout and the backlog format; a cookbook entry; CLI reference for `opportunities` and `spec lint`; `docs/architecture/` updated. The docs-vs-code test covers the new commands.
9. **Dogfood:** Mode A on this repo and on `jev-poc`; Mode B on this plugin and one third-party plugin. Record measured cost and an honest read of true and false positives in `Results`.

### Acceptance

- [ ] `decide opportunities add|list|check` ship as one typed tool with schema, handler and tests; `--format brief` and the envelope behave per [0015](../decisions/0015-cli-contract-v1.md).
- [ ] `check` reports a malformed backlog as a typed error and never repairs it.
- [ ] `decide spec lint` runs offline; each check is documented as error or warning; `--strict` gates.
- [ ] Mode A finds at least one real, defensible candidate in this repo or `jev-poc`; measured cost recorded.
- [ ] Mode B over this plugin plus one third-party plugin, with the false positives written up.
- [ ] Every projected saving shows its inputs and says projected. No output claims a measured saving.
- [ ] Undecided survivors are reported apart.
- [ ] Routing: `scout` loads on explicit invocation in Claude, Codex and Pi; the `ask` set does not regress on `--repeat 3`.
- [ ] `pnpm check`, `pnpm smoke`, `pnpm eval:routing all` green.
- [ ] **0.4.0 released** through the M6 gates (`release:check`, smoke from published artifacts, a live `scout` in each harness from a fresh profile); tagged `v0.4.0`.

---

## M10 — `guard` and `done-check` (release 0.5.0)

**Status:** not started.
**Addresses:** ROADMAP Known gap #1 (Claude declines to hand off a check of its own work).

### Work

1. **Spike: which harnesses can run a Stop hook from a plugin.** Claude: yes (`Stop`, `stop_hook_active`, `{"decision":"block","reason":…}`). Codex: verify whether a plugin can ship hooks (`com.openai.hooks`), what the Stop-equivalent event is and whether it can block; M4 found no plugin shipping anything but skills/apps/MCP. Pi: out (needs an extension, [0006](../decisions/0006-pi-gets-a-native-extension-pi-registertool-engine.md) superseded). Record the answers in AGENTS.md harness notes.
2. **`guard` config and command.** `guard:` in the config layers (`packs.<name>.enabled`, per-pack options, `latency_ms`, `fail: open|closed`). `decide guard list|status|enable <pack>|disable <pack>`; `enable` needs `--confirm` typed by the user (X6), with the same TTY-less `!` handling as `egress allow` (0015 amendment). `decide doctor` reports guard state and bad guard config.
3. **The hook runner.** `decide hook <pack> --event <json on stdin>` as a core tool. Packs ship **dormant**: the hook exits 0 immediately unless its pack is enabled in this repo. It never downloads the CLI (`SYSTEM1_NO_NPX=1`), always has a timeout, and on any internal failure exits 0 with no output (fail open).
4. **`done-check` pack.**
   - Criteria: bullets from the configured files (D8). No criteria or an empty diff → exit 0, nothing sent.
   - State: `git diff HEAD` (plus untracked files the diff names), and optional evidence files (`guard.done-check.evidence`, e.g. `test-output.log`), all through `prepare()`.
   - One `noul` per criterion ("is this criterion met by the change and evidence?"). The threshold for "confidently not met" is derived from `docs/calibration.md`, not guessed.
   - Block once with the unmet criteria named (D9); undecided listed as "check these yourself", never blocking. `stop_hook_active` → allow.
   - Per-event spend cap; the call is recorded in the usage ledger under the session id.
5. **Generated wiring.** `claude-hooks.json` gains the `Stop` entry (generated, still one file). Codex wiring only if the spike says it works.
6. **`guard` skill** (user-invocable, side effects): explains packs, their egress and latency cost, and tells the user the exact `enable --confirm` line to run; it never runs it.
7. **Evaluation.** A fixture set of stop events — real diffs against real criteria, both done and not-done, including the Known-gap prompts (the TASK.md check, the pre-commit rules check) — replayed in CI. A live measurement: false-block rate, missed-block rate, p50/p95 added latency at Stop, cost per event. Results in `Results` and `docs/evaluation.md`.
8. **Docs:** guard page, done-check recipe, troubleshooting (how to see why it blocked, how to turn it off), CLI reference.

### Acceptance

- [ ] Spike answers recorded; Codex wired or documented as unsupported with the reason.
- [ ] With no pack enabled, the hook sends nothing and adds < 150 ms at Stop (`bench:startup` variant).
- [ ] `guard enable` refuses without a user-typed `--confirm`; no skill runs it.
- [ ] `done-check` blocks a not-done fixture with the right criterion named, lets a done fixture through, never blocks on undecided, and allows the second stop.
- [ ] Provider error, timeout and replay miss each fail open (tested).
- [ ] Measured false-block and missed-block rates published, with their sample size.
- [ ] Known gap #1 updated in `ROADMAP.md` with what done-check does and does not fix.
- [ ] `pnpm check`, `pnpm smoke`, `pnpm eval:routing all` green.
- [ ] **0.5.0 released** through the gates, including a live `done-check` block in Claude from the published plugin on a fresh profile; tagged `v0.5.0`.

---

## M11 — `adopt` + `compare` (release 0.6.0)

**Status:** not started.

### Work

1. **Runtime consent for adopted code (decision record 0020).** D7 routes app runtime calls through the engine, which refuses without consent, and consent today lives only in a gitignored `.system1/config.yaml` written by a user. Decide how an application opts in, in code the developer writes and reviews (e.g. an explicit `egressConsent` on the programmatic decider, and for the CLI a committed, reviewable app config), such that **an agent cannot grant it by setting an env var**. Refusal at runtime routes to the fallback path, never to an error in the user's app.
2. **`emulated` transport and profile** ([0003](../decisions/0003-model-layer-one-transport-data-only-model-profiles.md)): a chat model on OpenRouter given a JSON schema derived from the question set (port `jev-poc/shared/baseline.ts`). `calibrated: false`; returns single values; parse failures counted, never repaired into answers. The model is chosen here and recorded in the profile. Same `prepare()`, consent, fixtures and ledger.
3. **Policy module templates** for TypeScript and Python (D6): thresholds from the spec, a trace of which branches fired, `undecided` and provider error → the existing path (the fallback). Generated offline tests run against recorded fixtures.
4. **`decide compare <spec> --baseline current:<file.jsonl> | emulated[:<model>]`** as a core tool. Reads recorded answers from both sides over the same states and reduces them to measured signals: cost per call, latency, decisiveness, undecided share, agreement by question type, baseline parse rate. With labels (`.system1/labels/<spec>.jsonl`) it adds accuracy; without them the report **declares no winner**. Writes `.system1/compare/<spec>/report.json`.
5. **`adopt` skill** (user-invocable, side effects). `adopt <opportunity-id | path>`: load the opportunity → draft the spec via `design` (lint must pass) → capture on examples and real inputs, read the distributions, revise → generate the policy module and tests in the repo's idiom → wire it behind the current mechanism with the fallback → generate the shadow harness that captures the current mechanism's outputs to JSONL → mark the opportunity `adopted` → hand off to `compare`. Nothing is cut over by the skill; cutover is the user's call.
6. **`compare` skill** (user-invocable): runs `decide compare`, writes the report up under the no-ground-truth rules, and points at labelling when there are none.
7. **Dogfood end to end:** take one M9 opportunity (TypeScript) and one Python example (a `jev-poc` demo or a small public repo) all the way through adopt → shadow run → compare. Record measured numbers.
8. **Evals and docs:** routing positives/negatives for `adopt` and `compare`; docs for the chain, the policy module, runtime consent, the emulated profile and the report format; `docs/architecture/` updated.

### Acceptance

- [ ] 0020 accepted; an agent cannot grant runtime consent by env var or flag; refusal falls back (tested).
- [ ] `emulated` profile ships with `calibrated: false`; its parse failures are counted and reported.
- [ ] Generated TS and Python modules pass their own offline tests and take the fallback on undecided and on provider error.
- [ ] `compare` never names a winner without labels; with labels it reports accuracy with sample size.
- [ ] One TS and one Python opportunity taken through the whole chain, with measured cost and agreement recorded.
- [ ] Routing: `adopt` and `compare` load on explicit invocation in all three harnesses; the `ask` set does not regress.
- [ ] `pnpm check`, `pnpm smoke`, `pnpm eval:routing all` green.
- [ ] **0.6.0 released** through the gates; tagged `v0.6.0`. M12 (design partners) unblocked.

---

## Out of scope for this plan

- `command-guard`, `loop-check`, `calibrate`, `sweep`, `pairs`.
- Any harness subagent ([0017](../decisions/0017-fan-out-through-the-cli-not-subagents.md)).
- An MCP adapter ([0013](../decisions/0013-cli-first-mcp-deferred.md)).
- A Pi extension for hooks.
- Automatic cutover. `adopt` wires in behind a fallback; the user switches.

## Risks

- **Scout's hit rate.** If Mode A finds little in real repos, the chain has nothing to adopt. M9's dogfood step is the early read; widen recall (`--depth full`) before widening scope.
- **Egress on every stop.** `done-check` sends a diff per stop. Dormant by default, opt-in per repo, spend-capped per event, silent without criteria.
- **Runtime consent** is the one place this plan touches the egress rules. It gets its own record (0020) and a test that an agent cannot flip it.
- **Codex hooks** may not be shippable from a plugin, in which case `done-check` is Claude-only at 0.5.0, stated plainly.
- **Partner delay.** Three milestones before M12 pushes outside feedback back. If a milestone stalls, M12 can start on the last release rather than waiting.

## Results

*(Filled in per milestone as each closes.)*
