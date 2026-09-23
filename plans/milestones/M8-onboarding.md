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

## Out of scope

- A docs site (D2), `decide spec add` or bundled specs, and any new command.
- Widening the calibration claim (M9 data) or measuring `choice`/`score`.
- Harness smoke on macOS (D3).
- Routing description rounds (gap 1 is closed as a wording problem).
- CHANGELOG, CONTRIBUTING, stability policy (M10).

## Open, to settle while building

- **Which six recipes survive.** The list above is the intent. A recipe whose examples can't be made to pass for the right reasons is dropped, not tuned to green (the `design` skill's rule).
- **Where the cookbook directory lives:** `cookbook/` at the root, or under `docs/`. Settle when the test is written.
- **Whether `doctor`'s headline change is wording or contract.** `ok` in the JSON result must stay as it is, or it is a contract change.

## Acceptance

- [ ] About six recipes in the cookbook, each with passing `expect` examples, replayed by `pnpm test`; each threshold cited from `docs/calibration.md` or marked unmeasured.
- [ ] `docs/` has getting-started, concepts, CLI reference, troubleshooting and cookbook pages, and the README links to them and carries the supported-model statement.
- [ ] The CLI reference and the error table are checked against the code by a test.
- [ ] A first-run walk in each of Claude, Codex and Pi is recorded here, and every stall it found is fixed or deferred with a reason. This includes the no-key message and `doctor`'s headline.
- [ ] CI runs `pnpm check` on Ubuntu and macOS, on Node 22 and 24, plus the packed-tarball job, and all are green.
- [ ] 0.2.0 is published and tagged, and installs in all three harnesses from the published artifacts.
- [ ] `pnpm check` green.
