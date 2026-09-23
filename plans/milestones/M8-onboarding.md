# M8 — Onboarding: the first hour works

**Status:** next (planned 2026-09-23). The decisions below came from interviewing the user.
**Goal:** A developer who has never seen System 1 installs it in their harness, gets a first useful decision in their own repo, and knows which threshold to trust, all without asking us. M9's design partners start from this. Their feedback should be about the product, not about a broken first hour.

## First principles

- **The first hour is the product for M9.** A partner who stalls at the key, the consent or a confusing error tells us nothing about whether decisions are useful.
- **Nothing documented is untested.** A recipe that isn't replayed in CI will rot silently. So will a command in the docs that nobody runs.
- **Errors are documentation.** Most first-hour users will meet `decide` through an error message relayed by their agent, not through `docs/`. Every error must name the cause and the next step.
- **Honest scope carries over from M7.** Recipes cite `docs/calibration.md` for `noul` thresholds and say plainly that `choice` and `score` are unmeasured.

## Decisions (interview, 2026-09-23)

| # | Question | Decision |
|---|---|---|
| D1 | How is the cookbook proven to work? | **Replay-tested in CI.** Each recipe is a spec with examples that carry `expect` answers, recorded live once (a few cents) and replayed by `pnpm test` through `decide spec check`. A recipe that breaks fails CI. |
| D2 | Where do the docs live? | **Markdown in `docs/`**, readable on GitHub and linked from the README. No site to host or build. M10 can add one if M9 asks for it. |
| D3 | How is macOS verified? | **CI matrix only:** `macos-latest` plus a second Node version. Harness smoke stays Linux-only. M9 partners on Macs are the real-world check. |
| D4 | Does M8 end in a release? | **Yes: publish 0.2.0**, so M9 partners install what we tested. The M6 release gates apply. |

## Found while planning (first-run walk, 2026-09-23)

The first hour was walked in a fresh repo on the published 0.1.0 CLI:

1. **No key gives a misleading error.** `decide ask …` without a key fails with `replay-miss — No recorded answer for this request`, which is technically true but wrong as a first message. The actual cause is "no key, so only replay works", which is what `doctor` says. Fix: when there is no key and replay misses, lead with the key.
2. **`doctor` says `healthy` when nothing live can work.** The line reads `healthy · replay only`, but with no key and no consent, a new user can't make a single decision. The headline should say what is missing, not "healthy".
3. **Works as intended:** with a key but no consent, the refusal names the command and the repo. `config egress allow` from an agent shell tells the agent to ask the user (in Claude Code, `! decide config egress allow`). This is the consent rule working, not friction; it only needs to be clearly explained in the getting-started doc.

## First-run walk per harness (§3, 2026-09-23)

**How it ran.** The working tree (after `8dfc68b`) was packed with `pnpm pack`: the CLI was installed from its tarball into an isolated npm prefix on PATH, and Pi's skills from the extracted `system1-pi` tarball. Claude loaded a copy of `plugins/system1` made outside the repo (so the shim used the installed CLI, not the dev bundle), and Codex loaded the plugin from the repo marketplace. Each harness had a clean profile holding only auth, and its own `XDG_CONFIG_HOME`; parent harness variables were stripped. Each ran in its own copy of a fresh five-file repo (a toy weather CLI: two `fetch` calls, one with `AbortSignal.timeout`), outside this repo. The **Codex `prefix_rule` was not pre-written**: a newcomer won't have one. The driver lives outside the repo (`~/.cache/system1-firstrun/walk.sh`). Four phases, the same prompts in every harness:

1. `setup` by name, no key: *"I just installed System 1. Get me set up."*
2. No key, a real question: *"Which files in src/ make a network call without a timeout? Use System 1 for this."*
3. The same question, key in the environment, no consent. (Before this phase the Codex rule was added, as setup had advised.)
4. The same question, after the user granted consent in all three repos.

| Phase | Claude (Sonnet) | Codex | Pi |
|---|---|---|---|
| 1 setup | Followed the skill; relayed "**overall: healthy**, but replay only" | Found the missing network rule and offered it; `PROBLEMS FOUND` | Followed the skill; `healthy · replay only` |
| 2 no key | Got `replay-miss`, said "no key", then read the files itself | `--glob` **failed after 10 s** (`git check-ignore did not answer`); retried with `--file`, got `replay-miss`, said a key is needed | `replay-miss`, said a key is needed |
| 3 no consent | Relayed the refusal; told the user to run the command "or use the `setup` skill **to grant consent**" | Relayed the refusal and quoted the skill's never-run-it rule | Relayed the refusal |
| 4 live | 2 kept of 5, then checked by reading | `2 kept of 5 · 0 undecided · 3 dropped · live typesafe/jev-1.13 · $0.000070 measured · 448 ms` | 2 kept of 5 |

No harness tried to grant consent, and nothing was written to a repo before consent. Consent for phase 4 was given by the user in the conversation and applied by the agent with `--confirm` (the rule in AGENTS.md allows that only on an explicit ask). Phase 4 cost **$0.000225 measured** for all three (5 calls each). All three kept `src/api.js` and `src/cli.js`: `cli.js` calls `getForecast()` and makes no `fetch` of its own, so the question was loose, not the model. That note is for the cookbook: say "a call made **in this file**".

**Stalls found, and what happens to each:**

| # | Stall | Where | Disposition |
|---|---|---|---|
| S1 | No key plus a replay miss leads with "No recorded answer" | every harness | **Fixed:** with no key, the message leads with it; with a key in forced replay, it says to drop `--replay` (finding 1) |
| S2 | `doctor` headline says `healthy` when no live decision can work | Claude, Pi | **Fixed:** the brief headline is `SETUP NEEDED (key, consent)` when warnings are what stand between the shell and a live decision; `ok`, `healthy` and `live` in the JSON are unchanged (finding 2) |
| S3 | Inside the Codex sandbox without the rule, `--glob` stalls 10 s on `git check-ignore`, and the message doesn't mention the sandbox | Codex | **Fixed:** the message says a sandbox is the likely cause and that `decide doctor` prints the Codex fix (harness-neutral, since the source reader has no harness) |
| S4 | `doctor`'s key fix always prints `~/.config/system1/credentials`, even when `XDG_CONFIG_HOME` moves it | all | **Fixed:** the fix line prints the resolved path |
| S5 | The refusal's "(or use the setup skill) to consent" reads as if the skill can grant it | Claude | **Fixed:** "Consent is the user's: they run … themselves (the setup skill explains what gets sent)" |
| S6 | With a recipe adopted in `.system1/specs/`, Codex wrote its own question instead of using it (Claude and Pi used the spec) | Codex | **Fixed:** the `ask` skill's first step is now `decide spec list`, then `--spec` if one fits. Rerun: Codex listed the specs and ran `--spec swallowed-error` |

**Phase 5, one cookbook recipe (after §1 was pushed).** In each repo the recipe was adopted with the `curl` command from `docs/cookbook.md`, and the prompt was *"Are there any places in this repo where errors get swallowed? Use System 1."* All three flagged `src/cache.js` (0.88–0.97). Claude used `--spec swallowed-error`. Pi used it too: its output hides tool calls, but the ledger shows the spec's 433 input tokens per call, against 364 for Codex's own question. Codex skipped the spec (S6).

**Re-checked after the fixes** (working tree re-packed and reinstalled): from a plain shell, all four new messages print as intended with exit codes 6 and 3 unchanged; in Codex without the rule, the new `git check-ignore` message came up, Codex fell back to `--file`, and then relayed the new key-first `replay-miss`. `setup`'s description of the headline and smoke's `DOCTOR_MARKER` were updated to match. The contract is untouched: no code, exit code or envelope field changed.

## Scope

### 1. The cookbook: tested question sets

`cookbook/<name>.yaml`: a spec, plus a short `docs/cookbook.md` entry saying when to use it, what its threshold is, and why. Each recipe carries **examples with `expect`**, both clear yeses and clear noes, plus at least one borderline case that has no `expect`. Answers are recorded once, live, and replayed by a test that runs `spec check` over every recipe.

**First set (about six, covering the three use cases the `ask` skill routes to):**

- Screening, `noul`: network calls without a timeout; errors caught and swallowed; secrets written to logs or URLs.
- Gating, `noul`: is this shell command destructive.
- Routing, `choice`: triage a CI failure (flaky, regression, infrastructure).
- Criteria check, `noul` over `--split join`: does this diff plus test log satisfy an acceptance criterion.

**Thresholds** come from `docs/calibration.md`'s table for `noul`. For `choice`, each recipe says the threshold is unmeasured and why the chosen default is conservative.

**How a user adopts a recipe:** copy the file into `.system1/specs/`. The docs show the one command. Bundling recipes into the CLI (`decide spec add`) stays deferred (M5 D1). Revisit only if M9 partners ask.

**Examples are self-contained** (inline `state`), so replay is reproducible without either corpus, and nothing from jev-poc ends up in the repo beyond what M7 already published.

### 2. `docs/`

- `getting-started.md`: install per harness, the key, consent (who grants it and why an agent can't), the first decision, and how to read a brief line (`kept`, `undecided`, `source`, measured cost).
- `concepts.md`: `noul`, `choice` and `score`; thresholds and undecided; live against replay; sources and splits; what gets sent.
- `cli.md`: the commands, the envelope, the exit codes. Where possible, this is checked against `decide schema` and the 0015 exit-code table by a test, so it can't drift.
- `troubleshooting.md`: every error code and every `doctor` check, each with its fix. Written from the first-run walk in each harness (§3), not from memory.
- `cookbook.md` (§1), with `calibration.md` as it stands.
- **README:** shorter, linking into `docs/`. It gains the **supported-model statement** (M7 D4): Jev on OpenRouter is the only model, and the README says what happens if it's withdrawn.

### 3. The first-run and error-message pass

Walk the first hour **in each harness** from a clean profile, on the working tree packed as a tarball: install, `setup`, key, consent, the first `ask`, and one cookbook recipe. Log every point where a newcomer would stall. Then fix, starting with the two findings above.

**Contract guard (0015):** error **codes**, exit codes and the envelope do not change. Message text and `doctor` wording may. Anything that would change the contract is recorded and deferred, not slipped in.

### 4. macOS and the CI matrix

`ubuntu-latest` and `macos-latest`, each on Node 22 and 24, running `pnpm check`. Add one job that installs the **packed** CLI tarball and runs `decide doctor` plus a replay `many`, so the shipped artifact is exercised on both OSes. Smoke's GNU `timeout` dependency stays: smoke is local and Linux-only (known gap 5 narrows to "harnesses unverified on macOS"; M9 covers that).

### 5. Release 0.2.0

The M6 gates: `pnpm check`, `pnpm release:check`, `pnpm smoke`, `pnpm eval:routing all` (with Claude `ask` at the accepted 5–6/8, gap 1). Publish all three packages at 0.2.0, tag `v0.2.0`, and verify from the published artifacts in each harness, the way M7 §5 did. It's a minor bump: no envelope change.

## Cookbook results (§1, 2026-09-23)

All six recipes survived, and none was tuned to green. They live in `cookbook/<name>.yaml`, with answers in `cookbook/fixtures/<name>/` (settles the open question: `cookbook/` at the root, beside `docs/`). `tools/cookbook.ts record` records live in this repo, using its local consent, into a cleared namespace, so only answers for the current wording are kept. `tools/cookbook.test.ts` adopts each recipe into a temp repo the way `docs/cookbook.md` tells a user to, and replays it with no key and no consent. It fails if an example fails or is undecided, if a clear yes or no lands on the wrong side of the recipe's **own** keep threshold (not just 0.5), if a threshold has no `why`, or if `meta.threshold_basis` is missing, or is `calibration` on a non-noul question.

| Recipe | Type | Examples | Notes from the recording |
|---|---|---|---|
| `no-timeout` | noul ≥ 0.3 | 6 + 1 borderline | The first wording left the helper-only near miss **undecided (0.49)**: the walk's finding. Reworded around a *visible* network API call, it dropped to 0.22 |
| `swallowed-error` | noul ≥ 0.3 | 6 + 1 | A commented deliberate fallback scores 0.70: flagged, and documented as such |
| `secret-leak` | noul ≥ 0.3 | 6 + 1 | Redacted-prefix near miss 0.28, close to the line; logging a whole config object is undecided (documented caveat) |
| `destructive-command` | noul ≥ 0.3, escalate only | 7 + 1 | `docker system prune -af` undecided (0.53) |
| `ci-failure` | choice, **unmeasured** | 6 + 1 | Keeps only a clear (`confidence ≥ 0.5`) `flaky`/`infrastructure` |
| `done-check` | 3 × noul ≥ 0.7, `--split join` | 5 + 1 | No test output leaves `tests_pass` undecided (0.44) |

Recording cost $0.000982 measured. Every command in `docs/cookbook.md` was then run live in a consented scratch repo, and each worked as written. **Found for §2:** the `ask` skill's `references/thresholds.md` still says "this toolkit does not verify" calibration, which M7 has since done. Update it with the docs pass.

## Docs and CI results (§2, §4, 2026-09-23)

- **§2 docs.** `docs/` now has `getting-started.md`, `concepts.md`, `cli.md` and `troubleshooting.md`, beside `cookbook.md` and `calibration.md`. The README is shorter: it links to a Documentation table and carries the supported-model statement (M7 D4, "One model, one provider"). `tools/docs.test.ts` checks the docs against the code: every command in `decide help` and every flag of `ask`/`many`/`spec check`/`config`/`usage`; the exit-code table against `EXIT` and `BY_CODE`; a troubleshooting section per error code (with its exit code) and per doctor check (`DOCTOR_CHECKS`, now exported); and every local link and anchor in the README and `docs/`. Mutation check: breaking a flag, a table row, two headings and an anchor made 5 of its 12 tests fail. The troubleshooting page was written from the first-run walk (S1–S6). The `ask` skill's `thresholds.md` now cites the calibration result instead of saying it is unverified.
- **§4 CI.** `ci.yml` runs `pnpm check` on `ubuntu-latest` and `macos-latest`, each on Node 22 and 24, plus a `packed` job per OS that runs `release:check`. That now also replays a `many` run and an adopted cookbook recipe from the installed CLI tarball. **The first macOS run found a real bug:** a repo reached through a symlinked path (macOS `/var` → `/private/var`) had every file withheld as `outside-repo`, because files were realpath'd and the base directory was not. Fixed (`c0db3e1`) and covered by a test that reproduces it on Linux. The suite also passes locally with a symlinked `TMPDIR`. All six jobs green on run 35823543530.

## Release gates for 0.2.0 (§5, 2026-09-23)

- `pnpm check`: 364 tests, green at 0.2.0.
- `pnpm release:check`: 11 steps pass at 0.2.0. `npm publish --dry-run` is clean for all three packages (CLI 166.6 kB, Pi 14.4 kB). npm's two auto-corrections, `bin` path cleaning and the `repository.url` form, are cosmetic and the same as for 0.1.0.
- `pnpm smoke`: 9/9. Claude's setup check failed once because Haiku paraphrased instead of printing verbatim (its output shows it ran doctor and got `SETUP NEEDED (key, consent)`), then passed on a rerun.
- `pnpm eval:routing all`: Claude `ask` positive **6/8** (the accepted 5–6/8, gap 1); every other line is 8/8 or 4/4, negatives included.
- The version bump is committed locally and **not pushed**: the plugin shim pins `npx @garygentry/system1@0.2.0`, so it goes out with the publish. **Publish, tag and the per-harness install from the published artifacts wait for the user's go-ahead.**

## Out of scope

- A docs site (D2), `decide spec add` or bundled specs, and any new command.
- Widening the calibration claim (M9 data) or measuring `choice`/`score`.
- Harness smoke on macOS (D3).
- Routing description rounds (gap 1 is closed as a wording problem).
- CHANGELOG, CONTRIBUTING, stability policy (M10).

## Open, to settle while building

- **Which six recipes survive.** The list above is the intent. A recipe whose examples can't be made to pass for the right reasons is dropped, not tuned to green (the `design` skill's rule).
- ~~**Where the cookbook directory lives.**~~ Settled: `cookbook/` at the root.
- **Whether `doctor`'s headline change is wording or contract.** `ok` in the JSON result must stay as it is, or it is a contract change.

## Acceptance

- [x] About six recipes in the cookbook, each with passing `expect` examples, replayed by `pnpm test`; each threshold cited from `docs/calibration.md` or marked unmeasured. *(2026-09-23: six recipes, enforced by `tools/cookbook.test.ts`.)*
- [x] `docs/` has getting-started, concepts, CLI reference, troubleshooting and cookbook pages, and the README links to them and carries the supported-model statement. *(2026-09-23.)*
- [x] The CLI reference and the error table are checked against the code by a test. *(2026-09-23: `tools/docs.test.ts`.)*
- [x] A first-run walk in each of Claude, Codex and Pi is recorded here, and every stall it found is fixed or deferred with a reason. This includes the no-key message and `doctor`'s headline. *(2026-09-23: four phases plus one cookbook recipe in all three harnesses; S1–S6 fixed.)*
- [x] CI runs `pnpm check` on Ubuntu and macOS, on Node 22 and 24, plus the packed-tarball job, and all are green. *(2026-09-23: run 35823543530.)*
- [ ] 0.2.0 is published and tagged, and installs in all three harnesses from the published artifacts.
- [x] `pnpm check` green. *(2026-09-23: 364 tests at 0.2.0.)*
