# M9–M11 — Scout, guard, adopt: from finding decisions to shipping them

**Status:** planned 2026-09-24. The decisions below came from interviewing the user. Ratified as [0019](../decisions/0019-scout-guard-adopt-before-partners.md).
**Supersedes:** `plans/later-scout-opportunities.md` (its scope is §M9 below; its D1–D4 carry over, except that the lint becomes a separate `decide spec lint` which `spec check` runs first).
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
- **One engine, one egress path.** Every new path to a provider — screening, the Stop hook, the emulated baseline, adopted runtime code — goes through `prepare()` and a decider built with consent. New recipients (the emulated vendor) and new triggers (hook packs) each need their own repo-level opt-in on top of consent. No exceptions are added by this plan.
- **Nothing skips silently.** Every skip, fallback or fail-open carries a reason the user can see: a `systemMessage` from a hook, a reason code from adopted code, a `skipped` list from a sweep.
- **Skills stay harness-neutral; harness specifics live in generated hooks.** Skills describe intent and run `decide`. Hook wiring is generated per harness by `claudeHooks()` in `tools/generate.ts`; skills are discovered from their directories.
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
| D8 | Where does `done-check` get its criteria? | **Configured files.** `guard.packs.done-check.criteria` lists paths (default `TASK.md`, `.system1/done.md`), one criterion per bullet. No criteria file, no diff → silent, no egress. |
| D9 | What does `done-check` do on an unmet criterion? | **Block once, then allow.** Block the stop, naming each confidently unmet criterion. If the agent stops again (`stop_hook_active`), let it through. Undecided never blocks and is reported. Fail open on provider error or latency budget. |

**Defaults taken without interview** (override by editing here before the milestone starts):

| # | Question | Default |
|---|---|---|
| X1 | Is there a `shadow-evaluator` agent? | **No** ([0017](../decisions/0017-fan-out-through-the-cli-not-subagents.md)). `compare` is a CLI tool plus a skill; the reduction is code, the write-up is the agent following the skill. |
| X2 | Do lint checks fail or warn? | **All heuristic checks warn**; only checks that are mechanically certain fail (e.g. a threshold naming a question that doesn't exist, already caught by `validate`). `spec lint --strict` promotes warnings to exit 7, which **extends** 0015's exit 7 (today `spec check --strict` only) — recorded as a 0015 amendment in M9 §2. `spec check` prints lint findings but its own `--strict` still gates only on examples, so existing CI gates don't change. |
| X3 | One signal set or two? | **Two** (`signals-code.yaml`, `signals-agents.yaml`) plus a shared `anti-signals.yaml` included by both. |
| X4 | How do opportunity ids stay stable? | Content hash over `(mode, normalised excerpt)` — **not** the path, and the excerpt is taken mechanically from the screened item's text (whitespace-collapsed line window), not chosen by the agent. Location is data: a re-run that finds the same excerpt at a new path updates `location` and `seen_at`. A changed excerpt is a new entry, and the old one is marked `stale`, never deleted. |
| X5 | Can `opportunities add` create `.system1/`? | **Yes.** It writes locally and sends nothing, so consent ([0009](../decisions/0009-egress-consent-once-per-repo.md)) is not in play. |
| X6 | Is enabling a guard pack a consent act? | **Yes.** It opts every matching event into egress, so `decide guard enable <pack>` follows the same rule as `config egress allow`: an interactive TTY or `--confirm` (the TTY-less `!` form), skills never pass `--confirm` or run it themselves, and the enabled flag is read only from the repo layer. |
| X7 | Is `calibrate` in scope? | **No.** `compare` hands off to it when labels exist; it gets its own plan after M11. |

---

## M9 — `scout` (release 0.4.0)

**Status:** in progress. The foundation (§1, §2, §3, §3a, §8) landed on 2026-09-24 in PR #10; next are the signal tables (§4) and the skill (§5).
**Carries over** `later-scout-opportunities.md` §1–§6 and its D1–D4. The detail there is authoritative where this section is brief, except where this section differs: the lint is its own command (§2), and candidates go to `opportunities add --file <path>`, never stdin (the Codex `prefix_rule` doesn't cover a pipe into `decide`).

### Work

1. **`decide opportunities add|list|check`.** A typed tool in `packages/core/src/tools/opportunities.ts` (TypeBox schema + handler), mapped in `packages/cli/src/commands/`.
   - `list` takes the same `--keep/--sort/--limit/--fields` *syntax* as `many`, with a new record-field evaluator: `project/project.ts` works only on model answers (`<question>[.<field>]`) and applies undecided rules that don't apply here. Share the tokenizer; validate field names against the record schema.
   - The record: id, mode (`code`|`agents`), location, current mechanism, proposed shape (`single`|`fanout`|`cascade`|`pairwise`), evidence excerpt, draft question set (in the `--questions` YAML shape), projected saving with its inputs (`volume`, `current_cost_per_item`, `decision_cost_per_item`), risk, next step, status (`new`|`stale`|`adopted`|`rejected`), and `source` (sweep id; `live`|`replay`). Ids per X4.
   - `check` on a malformed file: a typed error, exit 2 (`usage`: the input is invalid), never a repair.
2. **`decide spec lint`**, and `spec check` runs it first and prints its findings. Offline: no key, no consent, no egress. The checks are the failure-mode catalogue in `later-scout-opportunities.md` §2, with severity per X2. The "criteria a literal reader will take the wrong way" check can't be done offline: it stays in `design`'s reference, not in lint. The lint also exposes a single-question entry point, which M10 uses on criteria bullets.
3. **Contract.** Amend [0015](../decisions/0015-cli-contract-v1.md) additively (same `v`): the new commands, their result shapes, error codes and exit codes, and the wider exit 7 (X2). `decide schema <tool>` for each new tool. Update `packages/cli/src/exit-codes.ts`, `docs/cli.md` and `AGENTS.md`. The docs-vs-code test covers them.
3a. **`--exclude <glob>` on sources** (`many`, `ask`), repeatable, applied before anything is read. It is per call, unlike `egress.exclude`, which is persistent config. The pre-check sent every test, fixture and eval file to the model and asked `test_or_fixture`, which the model can't answer from content alone (it doesn't see the path). Path rules belong in the partition step, where they cost nothing.
4. **The signal tables** (X3), shipped **as specs with examples** (true and false positives from the dogfood, recorded once) so that `spec check` replays them in `pnpm check`. A wording change that kills recall then fails CI. The anti-signal questions go in the same pass, so one call screens items both in and out.
5. **`scout` skill** (user-invocable: `disable-model-invocation`, and `allow_implicit_invocation: false` in `agents/openai.yaml`):
   1. Resolve the target and pick the mode.
   2. **Local prefilter, no egress:** exclude tests, fixtures, eval harnesses and generated code by path (`--exclude`). Grep the target for the repo's own decision-model call sites (imports of the engine, `decide`, `/decisions` endpoints) and exclude files that only reach the model through them. In the pre-check, the per-file `already_decision_model` question couldn't see an indirect call: 32 of 38 `jev-poc` survivors were demos that already use Jev through a shared runner.
   3. Partition by file (Mode A) or by skill/plugin (Mode B). Files over the size cap are windowed with `--split lines:N`, never dropped.
   4. **Project first:** run `decide many … --dry-run` and show the user the item count, bytes, excluded files and projected cost. Pass `--confirm` only after the user approves (0011 trips at 200 items).
   5. Screen with `--questions … --keep … --format brief`. Re-run items that failed with a provider error once before reporting them.
   6. Read survivors only, and draft a question set and a projected saving per candidate. **Tell a mechanism that is intentional apart from one that can be replaced.** A chat-model or keyword *baseline* kept on purpose for comparison is a correct detection but not an opportunity, and is recorded as `rejected` with that reason.
   7. `decide opportunities add --file <path>`, then report the ranked top N.

   `--depth quick|full`. Undecided and skipped items are listed apart. **Mode B scope:** by default, only agent configuration inside the repo. Content outside it (installed plugins, `~/.claude`) needs the user to name it in the conversation, and the skill never adds `--allow-outside` on its own.
6. **`design` gains `references/failure-modes.md`**, each failure with an example and its repair, and runs `spec lint` before saving.
7. **Generator and packaging:** add the `scout` skill directory (skills are discovered by convention: `tools/generate.ts`, `tools/validate.ts`); `pnpm generate`; `pnpm validate`. Check that the Pi package tarball carries `scout/references/*`.
8. **`decide doctor`** reports an invalid backlog.
9. **Routing evals:** `scout` positives (explicit invocation in all three harnesses) and negatives (it must not take `ask` or `design` prompts). Re-run the `ask` set on `--repeat 3`.
10. **Docs:** a `docs/` page for scout and the backlog format; a cookbook entry; CLI reference for `opportunities` and `spec lint`; `docs/architecture/` updated.
11. **Dogfood:**
    - Mode A on this repo and on `jev-poc`.
    - Mode B on this plugin, plus one third-party plugin **cloned into a scratch repo**, so it is in-repo content under that repo's consent.
    - Add a scrub test on a harness settings file whose MCP `env` block holds a token-shaped value.
    - Record measured cost and an honest read of true and false positives in `Results`.

### Acceptance

- [x] `decide opportunities add|list|check` ship as one typed tool with schema, handler and tests; `--format brief` and the envelope behave per 0015 as amended (§3).
- [x] `check` reports a malformed backlog as a typed error, exit 2, and never repairs it.
- [x] Re-running a sweep after moving a file keeps the candidate's id (X4) (tested).
- [x] `decide spec lint` runs offline; each check is documented as error or warning; `--strict` gates with exit 7; `spec check --strict` behaviour on existing specs is unchanged (tested).
- [ ] Signal tables replay in `pnpm check` through `spec check`.
- [ ] A sweep over more than 200 items stops at the projection until the user approves; oversize files are windowed, not dropped.
- [ ] Mode A finds at least one real, defensible candidate in this repo or `jev-poc` (the pre-check already found one: `route.ts`); measured cost recorded.
- [ ] Mode A runs on at least one repo the signal questions were not written against (the pre-check's targets are both System 1 / Jev code, which skews them). Its precision and recall are written up.
- [ ] With the local prefilter, `jev-poc`'s survivors no longer consist mostly of demos that already use Jev.
- [ ] Mode B over this plugin plus one cloned third-party plugin, with the false positives written up; the settings-file scrub test passes.
- [ ] Every projected saving shows its inputs and says projected. No output claims a measured saving.
- [ ] Undecided and skipped items are reported apart.
- [ ] Routing: `scout` loads on explicit invocation in Claude, Codex and Pi; the `ask` set does not regress on `--repeat 3`.
- [ ] `pnpm check`, `pnpm smoke`, `pnpm eval:routing all` green.
- [ ] **0.4.0 released** through the M6 gates (`release:check`, smoke from published artifacts, a live `scout` in each harness from a fresh profile); tagged `v0.4.0`.

---

## M10 — `guard` and `done-check` (release 0.5.0)

**Status:** not started.
**Addresses:** ROADMAP Known gap #1 (Claude declines to hand off a check of its own work) **for repos that opt in with a criteria file**. It does not move the `ask` routing numbers, which stay the gap's measure for everyone else; M10 reports its own catch rate next to them.

### Work

1. **Spike: which harnesses can run a Stop hook from a plugin.**
   - **Claude:** yes (`Stop`, `stop_hook_active`, `{"decision":"block","reason":…}`, `systemMessage`).
   - **Codex:** verify whether a plugin can ship hooks (`com.openai.hooks`), what the Stop-equivalent event is, and whether it can block. M4 found no plugin shipping anything but skills, apps or MCP.
   - **Pi:** out. It needs an extension, deferred past M13 ([0006](../decisions/0006-pi-gets-a-native-extension-pi-registertool-engine.md) as amended by 0019).

   Record the answers in the AGENTS.md harness notes.
2. **`guard` config and command.**
   - **Config shape:** one key path, `guard.packs.<name>.{enabled, latency_ms, fail, max_usd_per_session, …pack options}` (e.g. `guard.packs.done-check.criteria`).
   - **`enabled` is read only from the repo layer** (`<repo>/.system1/config.yaml`), exactly like consent (`core/config/load.ts`). If found in the user file or env, it is ignored with a `doctor` warning, so one user-level setting can't switch on egress in every repo. Other pack options may layer normally.
   - **Commands:** `decide guard list|status|enable <pack>|disable <pack>`.
   - **`enable` rules:**
     - It **refuses with exit 3 unless repo egress consent is already granted**.
     - Otherwise it follows `egress allow` exactly: an interactive TTY, or the TTY-less `!` form, which needs a dedicated flag `--i-consent`. It is not `--confirm`, because agents legitimately pass `--confirm` to approve spend, and that habit must not carry over.
     - Skills never pass it (X6).
   - **`decide doctor`** reports guard config, a pack enabled without consent, and guard state.
3. **Guard state.** A typed file, `.system1/guard/state.json`, with its own validator. Per session id it holds the base commit, the hash of the criteria and diff last checked, and spend so far.
   - The base is recorded by a `SessionStart` entry in the generated wiring (the first `Stop` falls back to `HEAD` at that moment if `SessionStart` didn't run).
4. **The hook runner.**
   - **Command:** `decide hook <pack>` as a core tool. It reads the harness event JSON on stdin and prints the **harness's hook JSON**, not the `{v,ok,…}` envelope. That exception is recorded in the 0015 amendment, with `decide schema hook`.
   - **Dormant by default:** it exits 0 at once unless its pack is enabled in this repo and consent is granted. It never downloads the CLI (`SYSTEM1_NO_NPX=1`).
   - **Latency:** default `latency_ms` 5000; the generated hook `timeout` is larger than that.
   - **Fail open, but never silently.** On provider error, timeout, replay miss, the budget reached, state too large, or missing consent, it exits 0 with a one-line `systemMessage` giving the reason. The user can always tell "checked and fine" from "not checked".
5. **`done-check` pack.**
   - **Criteria:** bullets from the configured files (D8).
     - No criteria file → silent, nothing sent.
     - Each bullet first goes through `spec lint`'s single-question entry point. Bullets flagged as exact facts, counting or dates ("all tests pass", "before Friday") go straight to "check these yourself" and never reach the model.
     - If the criteria file changed since the session base, the reason says so, and the check uses the base version. This covers an agent editing or emptying its own criteria.
   - **When it runs:** only when the diff or criteria hash changed since the last check in this session. So a turn that ends with Claude asking the user a question, after an unchanged check, sends nothing. Optionally, a local no-egress match on the last assistant message (from `transcript_path`) for a completion claim, like `route`.
   - **State:**
     - `git diff <session base>`, so a session that commits before stopping is still checked, and other people's pre-existing uncommitted work is excluded.
     - Untracked files from `git ls-files --others --exclude-standard`, read as file sources. The diff source has no untracked handling today, and the engine still spawns only `git` ([0014](../decisions/0014-no-command-source.md)).
     - Optional evidence files (`guard.packs.done-check.evidence`, e.g. `test-output.log`).
     - Everything goes through `prepare()`. Withheld (excluded or secret-shaped) paths are listed to the model, and criteria that mention them go to "check these yourself".
     - **Over the size cap:** split per file and ask per criterion over the files that criterion's words point at. If it still doesn't fit, skip and report.
   - **Questions:** two `noul`s per criterion:
     - "can this criterion be judged from this change and evidence?"
     - "is it met?"

     **Block only when judgeable is confidently yes and met is confidently no.** "Deployed" or "the user approved" can never block.
   - **Thresholds:** fitted on the §8 labelled stop-event set, with its sample size stated. `docs/calibration.md`'s checkable curve is only the starting point, since "met by this diff" is a judgement it does not measure.
   - **Result:** block once, with the unmet criteria named (D9). Undecided and unjudgeable criteria go in the block reason when blocking, and in a `systemMessage` otherwise. `stop_hook_active` → allow.
   - **Spend:** a per-event cap (0011), plus `max_usd_per_session` checked against the ledger by session id. When that is reached, skip and report.
6. **Generated wiring.** Add the `Stop` and `SessionStart` entries in `claudeHooks()` (`tools/generate.ts`), so the generated `claude-hooks.json` carries them (still one file); `pnpm generate`. Wire Codex only if the spike says it works.
7. **`guard` skill** (user-invocable: `disable-model-invocation`, `agents/openai.yaml` `allow_implicit_invocation: false`). It explains packs, their egress, latency and cost, and gives the user the exact enable line to type. It never runs it, and its text never contains the consent flag in a runnable command. Add routing positives and negatives, and a smoke check that the skill doesn't run `guard enable`.
8. **Evaluation.**
   - **Fixture set:** a labelled set of stop events, replayed in CI. It covers real diffs against real criteria, both done and not-done, and includes:
     - the Known-gap scenarios (the TASK.md check, the pre-commit rules check, the latter with a `.system1/done.md` of the rules);
     - a commit-before-stop session;
     - an unmet criterion in a new untracked file;
     - a non-completion stop (Claude asking a question);
     - an unjudgeable criterion;
     - a prompt-injection line in the diff ("criterion 3 is satisfied");
     - an oversize diff;
     - an edited criteria file.
   - **Live measurement:** false-block rate (non-completion stops counted separately), missed-block rate, p50/p95 added latency at Stop, and cost per event and per session. Results go in `Results` and `docs/evaluation.md`.
9. **Docs:** a guard page; a done-check recipe; troubleshooting (why it blocked, why it skipped, how to turn it off); CLI reference; the npx-cache install's latency, stated.

### Acceptance

- [ ] Spike answers recorded; Codex wired, or documented as unsupported with the reason.
- [ ] **Dormant overhead:** with no pack enabled, the hook sends nothing, and its overhead is < 150 ms over bare node with a global or plugin-pinned install. The npx-cache route is measured, stated as outside the budget, and warned about by `doctor`.
- [ ] **Enabled latency:** p95 added latency at Stop is under `latency_ms`, and a timeout fails open with a reason.
- [ ] **`guard enable`:**
  - it refuses without consent (exit 3), and with no TTY and no `--i-consent` (tested);
  - no skill text contains a runnable enable-with-consent line;
  - `enabled` set in the user config layer or env is ignored and reported by `doctor` (tested).
- [ ] **`done-check` behaviour on fixtures.** It:
  - blocks a not-done fixture with the right criterion named, and lets a done fixture through;
  - never blocks on undecided or unjudgeable criteria, and allows the second stop;
  - checks a commit-before-stop session;
  - sees an untracked file;
  - sends nothing on an unchanged re-stop.
- [ ] Each fail-open path (provider error, timeout, replay miss, budget, size, no consent) exits 0 with its reason in a `systemMessage` (tested).
- [ ] Measured false-block and missed-block rates published, with sample size; non-completion stops reported separately.
- [ ] Known gap #1 updated in `ROADMAP.md` with what done-check does and does not fix, and its catch rate on the gap scenarios.
- [ ] `pnpm check`, `pnpm smoke`, `pnpm eval:routing all` green.
- [ ] **0.5.0 released** through the gates, including a live `done-check` block in Claude from the published plugin on a fresh profile; tagged `v0.5.0`.

---

## M11 — `adopt` + `compare` (release 0.6.0)

**Status:** not started.
**Order inside the milestone:** §1 (0020) first, then §2 and §5–§6 (emulated and compare, useful on their own), then the rest. **Contingency:** if 0020 is not accepted by the time §2 and §5–§6 are done, 0.6.0 ships compare plus policy modules with runtime egress off (usable in shadow runs only), and runtime consent follows in a point release. This orders the work; it doesn't reverse D3.

### Work

1. **Runtime consent and runtime environment for adopted code (decision record 0020).**
   - **Consent — the threat model, stated honestly.** Today consent reaches the engine two ways:
     - the repo's `.system1/config.yaml` (gitignored in this repo, but a team may commit it, `docs/configuration.md`);
     - `createDecider({ egressConsent: true })` in `packages/core/src/decide.ts`, which is **unguarded**.

     `adopt` is an agent that writes code and files, so no mechanism inside the code can stop it writing a grant. The control is **the user's review of the diff**, backed by these rules:
     - Generated modules ship with runtime egress **off**. The one line that turns it on is marked, and `adopt` never writes it.
     - A generated test fails if that line is enabled in adopt's own output.
     - Consent is never read from an env var.
   - **Environment.** In a deployed app there may be no `.git`, a read-only filesystem, and no harness session. 0020 specifies:
     - an explicit runtime root or config path;
     - ledger behaviour when the disk is read-only or absent;
     - a production spend cap (0011's per-request and per-session caps don't map onto a long-running app);
     - that **every fallback carries a reason code** the app can log or count, so "silently never called" is visible.
2. **`emulated` transport and profile** ([0003](../decisions/0003-model-layer-one-transport-data-only-model-profiles.md)): a chat model on OpenRouter, given a JSON schema derived from the question set (port `jev-poc/shared/baseline.ts`).
   - `calibrated: false`; it returns single values; parse failures are counted, never repaired into answers.
   - **It sends content to a different vendor than Jev**, so it needs its own repo-only opt-in (`egress.allow_profiles: [emulated:<model>]`, granted like consent), and it sends OpenRouter's no-data-collection provider preference.
   - **It is usable only inside `compare`:** `ask`, `many`, `hook` and the runtime refuse it with exit 2, so `SYSTEM1_MODEL` can't switch real gates to an uncalibrated model.
   - Choose the model here and record it in the profile. It uses the same `prepare()`, fixtures and ledger.
3. **A minimal stability promise for the imported surface.** Adopted TypeScript imports `@garygentry/system1-core`, which has no documented API or stability policy (that is M13).
   - Before any template ships, document the narrow surface the templates use and commit to it under semver, with a test that pins its exports.
   - **That surface includes a state-level entry point that runs `prepare()`'s scrub, size and exclude steps on an in-memory state.** `createDecider` alone only re-scrubs and size-checks, so templates must not call it directly.
   - `adopt` pins an exact version. M13's policy then extends this promise.
4. **Policy module templates** for TypeScript and Python (D6).
   - **Behaviour:** thresholds from the spec, a trace of which branches fired, and the existing path (the fallback, with a reason code) on `undecided`, provider error or refusal. Generated offline tests run against recorded fixtures.
   - **Python requirements, in the adopt docs and the module header:** Node ≥ 22 and `decide` in the runtime image and CI; a spawn cost on every call; a `decide version` check once at startup that falls back with a reason.
   - Add a Codex smoke that runs the generated Python tests (the sandbox's empty-stdout quirk).
5. **Capture and answer.** The shadow harness that `adopt` generates runs the current mechanism over sampled inputs and writes `(id, state, output, usage?, latencyMs?)` to `.system1/compare/<spec>/captured.jsonl`.
   - The file holds raw inputs, so it stays gitignored and the harness warns about it; `setup`'s `.gitignore` list gains it.
   - The engine never runs user code ([0014](../decisions/0014-no-command-source.md)).
   - Jev and emulated then answer the captured states through `decide many --file <jsonl> --split row [--model …]`, via `prepare()`.
   - `adopt` also generates an **explicit, tested mapping** from the current mechanism's output into the question set's answer space. Missing cost is reported as unknown, never zero.
6. **`decide compare <spec> --baseline current | emulated[:<model>]`** as a core tool.
   - It reduces the answers from both sides over the same states to measured signals: cost per call, latency, decisiveness, undecided share, agreement by question type, and baseline parse rate.
   - With labels (`.system1/labels/<spec>.jsonl`) it adds accuracy; without them the report **declares no winner**.
   - It writes `.system1/compare/<spec>/report.json`.
7. **`adopt` skill** (user-invocable, side effects):
   1. Load the opportunity.
   2. Draft the spec via `design` (lint must pass).
   3. Capture on examples and real inputs, read the distributions, and revise.
   4. Generate the policy module, the mapping and tests in the repo's idiom.
   5. Wire it in behind the current mechanism, **inert by default**: an off flag, with runtime egress off per §1. App traffic never reaches the model until the user switches it on.
   6. Generate the shadow harness.
   7. Mark the opportunity `adopted` and hand off to `compare`.

   Cutover is the user's call.
8. **`compare` skill** (user-invocable): runs `decide compare`, writes the report up under the no-ground-truth rules, and points at labelling when there are none.
9. **Registration, contract, doctor:**
   - add the `adopt` and `compare` skill directories, each with `agents/openai.yaml` `allow_implicit_invocation: false`;
   - `pnpm generate`; check the Pi package contents;
   - amend 0015 for `compare` and the new profile error;
   - `decide schema compare`;
   - `doctor` reports runtime consent, the emulated allow-list and captured files that aren't gitignored.
10. **Dogfood end to end:**
    - one M9 opportunity in TypeScript;
    - one Python example: a small public Python repo with an LLM call parsed to an enum or bool, chosen at the start of M11 and named here (`jev-poc` has no Python).

    Take both all the way through adopt → shadow capture → compare, and record the measured numbers.
11. **Evals and docs:** routing positives and negatives for `adopt` and `compare`; docs for the chain, the policy module, runtime consent and environment, the emulated profile and its opt-in, and the report format; `docs/architecture/` updated.

### Acceptance

- [ ] 0020 accepted. `adopt`'s output never enables runtime egress (a generated test fails if the marked line is on; a repo test scans adopt's templates for `egressConsent: true` and equivalents); enabling it is a user edit; consent is never read from env.
- [ ] Run from a directory with no `.git` and a read-only filesystem, an adopted module either makes the call or falls back with a reported reason code (tested, TS and Python).
- [ ] `emulated` ships with `calibrated: false`, needs its own repo opt-in, and is refused outside `compare` (tested); its parse failures are counted and reported.
- [ ] The core surface adopted TypeScript imports, including the state-level `prepare()` entry point, is documented, semver-committed and export-pinned by a test.
- [ ] Generated TS and Python modules pass their own offline tests, take the fallback on undecided, provider error and refusal, and are inert until the user enables them.
- [ ] The output→answer mapping is generated and tested; missing baseline cost is reported as unknown.
- [ ] `compare` never names a winner without labels; with labels it reports accuracy with sample size.
- [ ] One TS and one Python opportunity taken through the whole chain, with measured cost and agreement recorded.
- [ ] Routing: `adopt` and `compare` load on explicit invocation in all three harnesses; the `ask` set does not regress.
- [ ] `pnpm check`, `pnpm smoke` (including the Codex Python-test smoke), `pnpm eval:routing all` green.
- [ ] **0.6.0 released** through the gates; tagged `v0.6.0`. M12 (design partners) unblocked.

---

## Out of scope for this plan

- `command-guard`, `loop-check`, `calibrate`, `sweep`, `pairs`.
- Any harness subagent ([0017](../decisions/0017-fan-out-through-the-cli-not-subagents.md)).
- An MCP adapter ([0013](../decisions/0013-cli-first-mcp-deferred.md)).
- A Pi extension for hooks.
- Automatic cutover. `adopt` wires in behind a fallback, inert; the user switches.

## Risks

- **Scout's hit rate.** If Mode A finds little in real repos, the chain has nothing to adopt. M9's dogfood is the early read. Widen recall (`--depth full`) before widening scope.
- **Egress on every stop.** `done-check` sends a diff when a stop follows a change. It is dormant by default, opt-in per repo on top of consent, spend-capped per event and per session, and silent without criteria.
- **False blocks.** A gate that blocks wrongly will be switched off. The mitigations: the two-question rule (judgeable, then met), lint pre-filtering, block-once, and false-block rates measured before release.
- **Runtime consent** is the one place this plan touches the egress rules. It gets its own record (0020), an honest threat model (the diff review is the control), and a contingency that ships M11 without it.
- **Adopted code on a 0.x library.** An API break could break users' code before 1.0. Mitigated by the minimal stability promise (M11 §3) and exact pins.
- **Codex hooks** may not be shippable from a plugin. If not, `done-check` is Claude-only at 0.5.0, stated plainly.
- **Partner delay.** Three milestones before M12 push outside feedback back. If a milestone stalls, M12 can start on the last release rather than waiting.

## Results

*(Filled in per milestone as each closes.)*

### M9 pre-check: does scout find anything? (2026-09-24, before any M9 code)

**How it ran.** Draft Mode A signal questions ran as an ad-hoc `--questions` file through the shipped 0.3.2 `decide many`, one item per file, with no prefilter.
- **Signals:** `calls_llm` ∧ `llm_output_closed`, `semantic_heuristic`, `judge_over_many`.
- **Anti-signals:** `test_or_fixture`, `already_decision_model`.
- **Thresholds, fixed before the run:** a signal keeps at ≥ 0.3 (recall first); an anti-signal drops at ≥ 0.7.
- **Targets:**
  - `jev-poc`: `{src,server,shared,scripts}/**/*.{ts,tsx}`, 188 files, **$0.0150 measured**;
  - this repo: `{packages/*/src,tools}/**/*.ts`, 197 files, **$0.0130 measured**.

  The dry runs projected $0.0200 and $0.0172.

| Repo | Screened | Survivors | Real and actionable | Correct detection, but intentional | False positives |
|---|---|---|---|---|---|
| `jev-poc` | 182 (6 failed) | 38 | 0 | 4: `scripts/capture-baseline.ts` and `src/lib/baseline-client.ts` (chat model with a structured closed answer, over many items), `src/demos/rerank/baseline.ts` (keyword relevance), `server/transport.ts` | 34: 32 demo and `_kit` files that already call Jev through `_kit/runners`, plus `scripts/capture.ts` and `server/routes.ts` |
| this repo | 192 (5 failed) | 11 | **1: `packages/core/src/route/route.ts`**, `semantic_heuristic` 0.96. Regexes classify the prompt's intent, the step [0018](../decisions/0018-claude-routing-hook.md) already names as next ("an opt-in hook that asks `decide` to classify the prompt itself") | 2: `tools/evals/route-static.ts` (replays the route regexes), `tools/evals/fixture-repo/src/search/index.ts` (a keyword scorer in an eval fixture) | 8: the engine's own fan-out (`tools/many.ts`, `schemas.ts`, `cli/commands/decide.ts`), `egress/scrub.ts` (secret regexes are syntax, undecided at 0.48), `tools/cookbook.ts`, `tools/evals/run.ts`, `core/decide.ts` |

**What it says:**
- **Recall looks right.** Every known place in either repo where a chat model or a keyword rule does a decision job was kept. No known one was missed: the chat-model baseline, the keyword rerank baseline, the route regexes and the fixture scorer.
- **Precision without a prefilter is poor, for two fixable reasons.**
  - A per-file question can't see an indirect call. `already_decision_model` sat at 0.3–0.5 on demos that reach Jev through a shared hook. This is question-craft rule 9: the text doesn't contain the evidence.
  - The model doesn't see the path, so `test_or_fixture` can't catch eval fixtures.

  Both move into a local, free prefilter (M9 §3a, §5.2). Before and after the prefilter, the agent still has to tell an intentional baseline from a replaceable mechanism (§5.6).
- **Bias disclosed.** Both targets are System 1 / Jev code, the worst case for the decision-model anti-signal and the best case for finding baselines. The new M9 acceptance box requires an unrelated repo.
- **A bug found along the way:** 11 of 385 calls (2.9%) failed on HTTP 529 `system_overloaded`, which the transport did not retry. Fixed alongside these results: 529 is added to `RETRY_STATUSES`, with a test.

**Open question it raised, for §5 (found while dogfooding the backlog, 2026-09-24).** Some opportunities pay back in quality, not money. `route.ts` is one: regexes cost nothing, so a decision model projects −$0.00003 per prompt, and the real gain is recall (73/80 on the blind set) paid for with egress and latency. As built, the record carries money only, with `projected.note` for the rest. Before the skill ranks by `projected`, decide whether candidates need a typed `benefit` (`cost` | `quality` | `latency`) so a quality opportunity isn't ranked last. It is additive either way.

**Verdict: go.** Scout finds the right things, and its noise has concrete, cheap fixes that are now in the M9 work list. `route.ts` is the first backlog entry, and a natural first dogfood for M11's `adopt`.

<details><summary>The draft Mode A signal questions used (the starting point for M9 §4)</summary>

```yaml
calls_llm:
  type: noul
  instructions: The code in this file itself sends a prompt to a large language model and reads its reply.
  criteria:
    true: it calls a chat or completion API, an LLM SDK (OpenAI, Anthropic, Vercel AI, LangChain and similar), or makes an HTTP request to an LLM provider endpoint
    false: it never calls a language model, or it only defines types, prompts, docs or configuration without making the call
llm_output_closed:
  type: noul
  instructions: This file uses the reply of a language model as a fixed label, a yes or no, one of a fixed set of options, or a number, rather than as free text.
  criteria:
    true: the reply is constrained or parsed into an enum, boolean, category, verdict or score, for example a JSON schema with enum or boolean fields, a prompt demanding only yes or no, or code that matches the reply against fixed values
    false: the reply is used as prose, code, a summary or other generated text, or the file does not use a language model reply at all
semantic_heuristic:
  type: noul
  instructions: This file decides a meaning-based property of text using hand-written keyword lists, regular expressions or string matching.
  criteria:
    true: the property is about meaning, such as intent, topic, urgency, sentiment, relevance, risk or whether two texts say the same thing, and it is decided by lists of words, regexes or substring checks
    false: the matching is about exact syntax or format (parsing flags, file paths, versions, identifiers, JSON), or there is no such matching
judge_over_many:
  type: noul
  instructions: This file asks a model to grade, rank, rerank, classify or filter many items, one call per item or in a loop.
  criteria:
    true: it loops or fans out over records, candidates, search results, files or messages and asks a model for a verdict, label or score on each
    false: it makes a single model call, generates text per item, or makes no model calls
test_or_fixture:
  type: noul
  instructions: This file is a test, a fixture, a mock or example data rather than code that runs in the product.
  criteria:
    true: it is a unit, integration or end-to-end test, test helper, recorded fixture, mock or sample data
    false: it is application, library, server, script or tool code that runs outside a test suite
already_decision_model:
  type: noul
  instructions: The judgement in this file is already sent to a decision model that returns typed probabilities, not to a chat model.
  criteria:
    true: it calls Jev, the typesafe/jev model, a /decisions endpoint, or the decide CLI or its engine to get noul, choice or score answers
    false: it calls a chat or completion model, uses hand-written rules, or calls no model
```

</details>
