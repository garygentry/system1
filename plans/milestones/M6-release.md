# M6 — Release 0.1.0

**Status:** planned (2026-09-22). The decisions below came from interviewing the user.
**Goal:** System 1 (`system1`) 0.1.0 is on npm and on GitHub, installs cleanly in Claude Code, Codex and Pi from the published artifacts, and has been reviewed as a whole approach before anything is published.

## Decisions (interview, 2026-09-22)

| # | Question | Decision |
|---|---|---|
| D1 | What gets published? | **The CLI, core and a Pi package**: `@garygentry/system1`, `@garygentry/system1-core` and `@garygentry/system1-pi`. This answers open questions 5 and 6. |
| D2 | When does the comprehensive review run? | **On a staged release candidate.** Everything is prepared and pushed, nothing is published, then the review runs against the exact artifact that would ship. |
| D3 | Who runs the review? | **Codex with `gpt-6-astra`.** Verified working on this machine after the Codex 0.155.1 update, where it is now the default model. Earlier `gpt-5.6-astra` was refused for a ChatGPT account. |
| D4 | How is it scoped? | **Several focused passes**, one per area, each writing its findings to a file. |
| D5 | What happens to the findings? | **I reproduce and triage them** into fix-now, defer and won't-fix with reasons, and the user approves that list before anything changes. |
| D6 | This repo's committed egress consent? | **Untrack `.system1/config.yaml` and gitignore it.** Every clone inherits consent today, which is exactly what `setup` warns users about. |
| D7 | `decide ask --dry-run`? | **Reject it as a usage error** (exit 2), pointing at `many`. Today it is accepted and silently ignored, and a real call is made. |
| D8 | GitHub? | **Push before the review**, so marketplace installs are tested the way a user does them, and the review sees what is actually published. |
| D9 | The name? | **System 1 (`system1`)**, decided during Phase 1 and recorded in [0016](../decisions/0016-name-system1.md). The repo, the npm packages, the plugin, `.system1/` and `SYSTEM1_*` all change; the `decide` command does not. |

## Phase 1 — prepare the release candidate (nothing published)

**Done (2026-09-22).** Nothing is on npm.

1. **Consent:** `.system1/config.yaml` is untracked and gitignored, so a fresh clone starts with no consent. `AGENTS.md` says contributors grant their own.
2. **`ask` rejects fan-out flags:** `--dry-run`, `--confirm`, `--sort`, `--limit`, `--fields` and `--concurrency` exit 2 with a message naming `many`. Before, `ask --dry-run` made a real call. Recorded in 0015.
3. **The rename to System 1** ([0016](../decisions/0016-name-system1.md)), decided mid-phase: repo, npm names, plugin and marketplace, `.system1/`, `SYSTEM1_*`, the user config directory and `X-Title`. The `decide` command, the skill names and the spec format are unchanged, and the `openrouter-decisions` transport id stays, because it names the provider's API.
4. **Version 0.1.0** everywhere from `catalog.yaml`. `doctor`'s "not published yet" branches are gone.
5. **`packages/pi`** is generated: the `pi` key plus a `prepack` that copies the skills, so they are authored once. The copy is gitignored.
6. **Publish metadata:** `publishConfig.access: public`, author, homepage, keywords, and a README and LICENSE in each package.
7. **README** rewritten: what it is, a real measured run over this repo, the three skills, the install matrix per harness, the key, and what gets sent.
8. **Dry runs:** `npm pack` gives 163 kB (CLI, 13 files), 88 kB (core, 159) and 13 kB (pi, 13). `npm publish --dry-run` is clean for all three with public access. The packed CLI installed to a scratch prefix runs `decide doctor` and reports 0.1.0.
9. **Pushed to GitHub:** `garygentry/system1`, public, `main`.
10. **Installs from GitHub verified**, in isolated config directories:
    - Codex: `codex plugin marketplace add garygentry/system1` then `codex plugin add system1@system1` → skills at 0.1.0.
    - Claude Code: `claude plugin marketplace add garygentry/system1` then `claude plugin install system1@system1` → skills plus the executable `bin/decide` shim.
    - Pi: `pi install git:github.com/garygentry/system1` → skills, with no devDependencies pulled. **This answers the doubt behind open question 6:** the git install works, so the npm Pi package is a convenience rather than a requirement.
11. **`pnpm check` (282 tests) and `pnpm smoke` (9 of 9) pass after the rename.**

1. **Consent and hygiene (D6):** untrack `.system1/config.yaml`, add it to `.gitignore`, re-grant locally, and note in `AGENTS.md` that contributors grant their own consent.
2. **`ask --dry-run` (D7):** exit 2 with a message naming `many`, with a test. Record it in 0015.
3. **Version 0.1.0:** set it in `catalog.yaml` and run `pnpm generate`, which stamps every manifest, `core/src/version.ts` and the shim's pinned `npx` fallback.
4. **The Pi package (D1):** add `packages/pi`, generated from `catalog.yaml`, holding a copy of the skills and the `pi` key, and nothing else. `pnpm generate` writes it, `pnpm validate` checks it, and the root `pi` key keeps working for a local install.
5. **Publish metadata:** check `files`, `exports`, `bin`, `repository`, `license`, `engines` and `publishConfig` in all three packages, and make sure the CLI ships `dist/bundle` and the bundled specs directory it resolves at runtime.
6. **README:** what it is, when to reach for it, the install matrix per harness, a worked `ask` example, the egress and consent statement, and the replay-only mode. Honest numbers only.
7. **Dry runs:** `npm pack` each package and inspect the tarballs; `npm publish --dry-run`; install the packed CLI tarball into a scratch directory and run `decide doctor` from it.
8. **Push to GitHub (D8):** create `garygentry/system1`, push `main` and the release branch, and check both marketplace manifests resolve from the pushed repo.

At the end of this phase, nothing is on npm, and `main` is the release candidate.

## Phase 2 — comprehensive review by astra (D2–D5)

**How it runs.** One `codex exec` per pass, from a clean workdir, each with a brief written to `plans/review/M6/<area>.md` and its findings to `plans/review/M6/findings-<area>.md`:

```sh
codex exec -m gpt-6-astra --skip-git-repo-check "$(cat plans/review/M6/<area>.md)"
```

- Codex's default sandbox is read-only, so the reviewer can read the tree and run `decide` in replay, but cannot change anything.
- Each brief states the area, the files that matter, what to try to break, and asks for findings with severity, evidence and a suggested fix. Each says: no live calls, never `decide config egress allow`, never print the key.
- Runs happen from a copy of the repo outside the working tree, so a review can't disturb the candidate.

**The passes:**

1. **The CLI-only bet (0013).** Does skills-plus-CLI still hold, given what M0–M5 measured: Codex's network rule covering only commands that start with `decide`, its sandbox hiding a child's stdout, and no plugin being able to ship the rule? What would MCP fix, and what would it cost?
2. **Egress and consent.** Every path from content to the provider: `prepare()`, excludes, scrubbing, size refusal, the consent guard, `--split join`, spec example files, fixtures and the ledger. Can an agent be led into granting consent, or into sending something the user didn't intend?
3. **Honesty of the numbers.** Projected against measured costs, the spend guard and ledger, undecided handling, replay never standing in for a live answer, and the claims in the skills and README.
4. **The contract, before publishing freezes it (0015).** The envelope, exit codes, the M5 additions (`--questions`, `spec check` and its `expect` format, `--split join`, excerpts), and what a breaking change would cost once people depend on it.
5. **Release mechanics and first install.** The three packages, version pinning, what the shim resolves once the package is real, `doctor`'s and `setup`'s install advice, and a first install per harness from a clean environment.
6. **The eval methodology** (optional sixth pass): is "the skill loaded" the right measure, is the fixture fair, and what to make of Claude's 6/8–8/8 variance between runs.

**Then:** I reproduce every finding, triage into fix-now, defer and won't-fix with reasons, and show the user that list before changing anything (D5). Fixes land on `m6-release`, and the M5-style record of findings and fixes goes in this doc.

## Phase 2 results — the astra review (2026-09-22)

Five passes ran with `codex exec -m gpt-6-astra --sandbox workspace-write`, each against its own copy of the pushed repo, with the briefs in `plans/review/M6/` and the reports beside them as `findings-*.md`. Every finding acted on below was reproduced here first, outside the Codex sandbox.

Three of five verdicts were "hold publication": egress ("I would not publish this candidate with its current egress promises"), contract, and release. The other two said hold for fixes but keep the architecture.

### Fixed

**Egress — the promises did not hold as written.**
- **Excludes matched the name you typed, not the file it resolved to.** A symlink `innocent.txt -> .env` was read and sent. Paths now resolve through symlinks, and excludes match both spellings.
- **Any absolute path was sent under this repo's consent** (`--file /etc/hostname`). Content that resolves outside the repo root is now withheld as `outside-repo`, with `--allow-outside` for deliberate use (the user chose the strict default).
- **A diff path git had quoted became `unknown`**, so excludes stopped matching it. Quoted paths are decoded; a section whose path can't be read is withheld instead of sent.
- **The question set was never scrubbed**, though it is sent with every request and an agent can paste anything into it.
- **Splitting happened before scrubbing**, so a private key split across line windows lost the markers that identify it, and a `{"password": …}` field was scrubbed without its name. Documents are scrubbed whole, before splitting, and a field whose name means a credential is redacted by name.
- **`createDeciderFromEnv()` skipped `prepare()` entirely.** The decider itself now scrubs state and questions and applies the size limit, so the library cannot be used to bypass them.
- **Fixtures hold the exact text that was sent**, and `design` told users to commit them with no warning. The README, `design` and `setup` now say so plainly.

**Honesty.**
- **An undecided answer could win a ranking.** Only questions `keep` filtered on counted; an item ranked first by an undecided score was kept and reported as decided. `sort`'s question counts too, and kept rows carry their own `undecided` list. 0015's definition was wrong and is corrected.
- **Missing usage was reported as measured zero.** `usage.reported: false` now marks it, and `brief` says the total is incomplete.
- **Claims narrowed:** the README and skills attribute calibration to the provider (nothing here measures it), and quote cost per ~700-token item beside the measured per-item cost of the example run.

**Contract, before publishing freezes it.**
- **`--input` could smuggle fields the CLI ignores** (`dryRun` on `ask`). Every tool schema refuses unknown properties, and `questions` is a typed union, so `decide schema` now describes a valid question.
- **A spec accepted unknown keys**, so `kepe:` or `exepct:` silently became no policy, and `passed: true` could mean nothing was checked. Unknown keys are refused, `version:` names the format (1) and a newer one is refused, `meta:` is the reserved extension area, and `spec validate` also checks `source.split` and each example's `file`.
- **Exit codes were inconsistent:** `usage --bogus` exited 1 (reserved for bugs) where `ask --bogus` exited 2. Every command parses through one typed helper.
- **`--format=json` was ignored** for `version` while `--format json` worked.

**Release mechanics.**
- **The bundle stripped third-party licence notices** while inlining MIT and ISC dependencies. `tools/notices.mjs` generates `THIRD-PARTY-NOTICES.md` from the bundled packages; it ships in the tarball and `pnpm check` fails if it drifts.
- **The "pinned" shim ran any `decide` on PATH.** It now accepts a PATH hit only when it resolves inside a real install of this package.
- **Relative paths meant the repo root**, so the same command in a subdirectory judged a different file. Command-line paths follow the shell; a spec's own `source` stays repo-anchored.
- **A clean checkout packed empty packages.** `prepublishOnly` refuses to publish without a current build, and `pnpm release:check` builds, packs, installs the CLI tarball into a scratch prefix, runs it, and checks the notices and the Pi skills.
- **The Pi tarball couldn't be repacked.** `prepack.mjs` ships and is a no-op when the skills are already there.
- **`git check-ignore` had no timeout** and hung in the reviewer's sandbox. It is bounded, and a timeout is a typed error rather than a silent loss of ignore rules.

### Deferred, with reasons

- **An MCP adapter.** All five passes agreed CLI-only is right for 0.1.0. The one thing it would fix, sandbox network policy, depends on the host anyway (0013).
- **A real calibration evaluation.** It belongs with M9's `calibrate`, which needs labels. Until then the claim is attributed, not made.
- **Publish provenance, a changelog and a security contact.** Worth doing, but they don't change the artifact; M6 ships the tested tarballs by hand.
- **Spend accounting for failed attempts.** The ledger records what the provider reported for successful calls; whether a failed attempt is billed is unverified, so `usage` says what it covers rather than guessing.
- **`decide usage` completeness wording** and the historical numbers in M5: those runs are labelled measured and dated, and are not being re-run.

## Routing evals on the release candidate (2026-09-22)

| | Claude (Sonnet) | Codex | Pi | Bar |
|---|---|---|---|---|
| `ask` positive | **6/8** | 8/8 | 8/8 | ≥ 7/8 |
| `ask` negative | 8/8 | 8/8 | 8/8 | 8/8 |
| `design`, `setup` | 4/4, 4/4, 4/4 | same | same | |

**Claude's two misses are both criteria checks over a 22-line diff** ("is the task in TASK.md done", and the pre-commit rules check). It hands off every batch task and both pick-from-many cases; it declines only when asked to re-check a small diff it just made.

**A fifth description round was tried and reverted.** Leading with "before you report a task done, check it with this skill rather than grading your own work" moved Claude to 7/8, but dropped `ask` negatives in **Codex and Pi from 8/8 to 5/8**: it then triggered on "write a function", "rename this function" and "add a .gitignore entry". Over-triggering is the worse failure, since it spends money and sends code for tasks that need no judgement, so the wording went back. The user accepted 6/8 for the release.

Note: Pi's `design` and `setup` results in that run were void, because its Codex-backed provider returned "The usage limit has been reached" partway through. Its `ask` negatives were real completed sessions.

## Phase 3 — publish and verify

1. `pnpm check`, `pnpm smoke` and `pnpm eval:routing all` green on the final candidate.
2. `npm publish` all three packages at 0.1.0, and tag `v0.1.0`.
3. **Install from the published artifacts, per harness, on a clean profile:**
   - Claude Code: install the plugin from the GitHub marketplace, with `decide` coming from the plugin's `bin/`.
   - Codex: install the plugin, plus `npm i -g @garygentry/system1`, plus the `prefix_rule`, exactly as `setup` describes it.
   - Pi: `pi install npm:@garygentry/system1-pi`, plus the global CLI.
4. **One live end-to-end decision per harness**, through the `ask` skill, with the measured cost recorded here.
5. `decide doctor` reports healthy and live-ready in each harness, and its install hints now name a package that exists.
6. Update the ROADMAP (M6 row, open questions 5 and 6), and record the release in this doc.

## Out of scope

- `scout`, `adopt`, `compare`, `calibrate` and hooks (M7–M10).
- Bundled generic specs (M5, D1: revisit when questions recur across repos).
- A GitHub Actions release workflow. The first publish is done by hand, and automating it can follow.

## Open, to settle while building

- Whether `@garygentry/system1-core` is published at 0.1.0 with the CLI or held back until someone needs the library (D1 says publish it; revisit only if the packaging proves awkward).
- Whether `pi install git:` of the pushed repo works, which would make the Pi package optional (open question 6's original doubt).
- macOS: the smoke scripts need GNU `timeout`, carried over from M4.

## Acceptance

- [ ] `.system1/config.yaml` is untracked and gitignored; a fresh clone starts without consent.
- [ ] `ask --dry-run` exits 2, with a test, and 0015 says so.
- [ ] `packages/pi` is generated, validated, and 0.1.0 is stamped everywhere by `pnpm generate`.
- [ ] README has the install matrix, a worked example, and the egress statement.
- [ ] `npm pack`/`publish --dry-run` are clean for all three, and the packed CLI runs `doctor` from a scratch install.
- [ ] `main` is pushed to GitHub, and both marketplace manifests resolve from it.
- [ ] The astra passes have run, their findings and my triage are recorded here, and the user approved the plan before any fix landed.
- [ ] All three packages are published at 0.1.0 and tagged.
- [ ] Each harness installs from the published artifacts and runs one live decision through the `ask` skill, with costs recorded.
- [ ] `pnpm check`, `pnpm smoke` and `pnpm eval:routing all` pass on the released commit.
