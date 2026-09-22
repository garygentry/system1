# M6 — Release 0.1.0

**Status:** planned (2026-09-22). The decisions below came from interviewing the user.
**Goal:** `decisions` 0.1.0 is on npm and on GitHub, installs cleanly in Claude Code, Codex and Pi from the published artifacts, and has been reviewed as a whole approach before anything is published.

## Decisions (interview, 2026-09-22)

| # | Question | Decision |
|---|---|---|
| D1 | What gets published? | **The CLI, core and a Pi package**: `@garygentry/decisions`, `@garygentry/decisions-core` and `@garygentry/decisions-pi`. This answers open questions 5 and 6. |
| D2 | When does the comprehensive review run? | **On a staged release candidate.** Everything is prepared and pushed, nothing is published, then the review runs against the exact artifact that would ship. |
| D3 | Who runs the review? | **Codex with `gpt-6-astra`.** Verified working on this machine after the Codex 0.155.1 update, where it is now the default model. Earlier `gpt-5.6-astra` was refused for a ChatGPT account. |
| D4 | How is it scoped? | **Several focused passes**, one per area, each writing its findings to a file. |
| D5 | What happens to the findings? | **I reproduce and triage them** into fix-now, defer and won't-fix with reasons, and the user approves that list before anything changes. |
| D6 | This repo's committed egress consent? | **Untrack `.decisions/config.yaml` and gitignore it.** Every clone inherits consent today, which is exactly what `setup` warns users about. |
| D7 | `decide ask --dry-run`? | **Reject it as a usage error** (exit 2), pointing at `many`. Today it is accepted and silently ignored, and a real call is made. |
| D8 | GitHub? | **Push before the review**, so marketplace installs are tested the way a user does them, and the review sees what is actually published. |

## Phase 1 — prepare the release candidate (nothing published)

1. **Consent and hygiene (D6):** untrack `.decisions/config.yaml`, add it to `.gitignore`, re-grant locally, and note in `AGENTS.md` that contributors grant their own consent.
2. **`ask --dry-run` (D7):** exit 2 with a message naming `many`, with a test. Record it in 0015.
3. **Version 0.1.0:** set it in `catalog.yaml` and run `pnpm generate`, which stamps every manifest, `core/src/version.ts` and the shim's pinned `npx` fallback.
4. **The Pi package (D1):** add `packages/pi`, generated from `catalog.yaml`, holding a copy of the skills and the `pi` key, and nothing else. `pnpm generate` writes it, `pnpm validate` checks it, and the root `pi` key keeps working for a local install.
5. **Publish metadata:** check `files`, `exports`, `bin`, `repository`, `license`, `engines` and `publishConfig` in all three packages, and make sure the CLI ships `dist/bundle` and the bundled specs directory it resolves at runtime.
6. **README:** what it is, when to reach for it, the install matrix per harness, a worked `ask` example, the egress and consent statement, and the replay-only mode. Honest numbers only.
7. **Dry runs:** `npm pack` each package and inspect the tarballs; `npm publish --dry-run`; install the packed CLI tarball into a scratch directory and run `decide doctor` from it.
8. **Push to GitHub (D8):** create `garygentry/decisions`, push `main` and the release branch, and check both marketplace manifests resolve from the pushed repo.

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

## Phase 3 — publish and verify

1. `pnpm check`, `pnpm smoke` and `pnpm eval:routing all` green on the final candidate.
2. `npm publish` all three packages at 0.1.0, and tag `v0.1.0`.
3. **Install from the published artifacts, per harness, on a clean profile:**
   - Claude Code: install the plugin from the GitHub marketplace, with `decide` coming from the plugin's `bin/`.
   - Codex: install the plugin, plus `npm i -g @garygentry/decisions`, plus the `prefix_rule`, exactly as `setup` describes it.
   - Pi: `pi install npm:@garygentry/decisions-pi`, plus the global CLI.
4. **One live end-to-end decision per harness**, through the `ask` skill, with the measured cost recorded here.
5. `decide doctor` reports healthy and live-ready in each harness, and its install hints now name a package that exists.
6. Update the ROADMAP (M6 row, open questions 5 and 6), and record the release in this doc.

## Out of scope

- `scout`, `adopt`, `compare`, `calibrate` and hooks (M7–M10).
- Bundled generic specs (M5, D1: revisit when questions recur across repos).
- A GitHub Actions release workflow. The first publish is done by hand, and automating it can follow.

## Open, to settle while building

- Whether `@garygentry/decisions-core` is published at 0.1.0 with the CLI or held back until someone needs the library (D1 says publish it; revisit only if the packaging proves awkward).
- Whether `pi install git:` of the pushed repo works, which would make the Pi package optional (open question 6's original doubt).
- macOS: the smoke scripts need GNU `timeout`, carried over from M4.

## Acceptance

- [ ] `.decisions/config.yaml` is untracked and gitignored; a fresh clone starts without consent.
- [ ] `ask --dry-run` exits 2, with a test, and 0015 says so.
- [ ] `packages/pi` is generated, validated, and 0.1.0 is stamped everywhere by `pnpm generate`.
- [ ] README has the install matrix, a worked example, and the egress statement.
- [ ] `npm pack`/`publish --dry-run` are clean for all three, and the packed CLI runs `doctor` from a scratch install.
- [ ] `main` is pushed to GitHub, and both marketplace manifests resolve from it.
- [ ] The astra passes have run, their findings and my triage are recorded here, and the user approved the plan before any fix landed.
- [ ] All three packages are published at 0.1.0 and tagged.
- [ ] Each harness installs from the published artifacts and runs one live decision through the `ask` skill, with costs recorded.
- [ ] `pnpm check`, `pnpm smoke` and `pnpm eval:routing all` pass on the released commit.
