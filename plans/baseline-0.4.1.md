# Plan: baseline before M10 — the quoted-key fix, shipped as 0.4.1 through the CI release path

- **Status:** proposed, 2026-09-25
- **Why:** [0022](decisions/0022-ci-publish-trusted-staged.md) has so far only been checked with dry runs and unit tests. The first real CI release should carry a small, low-risk change, so that a problem in the pipeline can't be confused with a problem in a large feature. A small fix is ready: the quoted API key from the M10 handoff. Ship it as 0.4.1, close phases C–D of [`ci-publish.md`](ci-publish.md), then start M10 on a release path that has been proven.
- **Done when:** 0.4.1 has been published by the CI release path and verified in all three harnesses; npm refuses tokens for all three packages; 0022 has its "still to confirm" items answered; `main` is clean, and nothing is left open except M10.

## Starting state (2026-09-25)

- `main` is at `930874d` (#17, the CI release path), and the working tree is clean apart from this file.
- **Phase B is done** (not yet written into `ci-publish.md`; step 1 below does that):
  - Trusted publishers are set on `@garygentry/system1-core`, `@garygentry/system1` and `@garygentry/system1-pi`: github, `garygentry/system1`, `release.yml`, environment `npm-publish`, permission `stage publish`. The npm trust ids are core `ca4de797-…`, cli `30212865-…` and pi `9d073b74-…`.
  - The GitHub environment `npm-publish` deploys only from tags matching `v*`.
  - Ruleset 23977750 "release tags" blocks updating or deleting `refs/tags/v*`. Ruleset 23977751 "main" blocks deleting or force-pushing `main` and requires the six `ci.yml` checks. The admin can bypass both.
- The maintainer's npm is 12.1.0 at `~/.local/bin/npm`. After upgrading, zsh needed `hash -r`, because `/usr/bin/npm` 10.9.8 is still installed.

## Steps

### 1. Record phase B, and commit this plan (small, direct to `main` or a one-commit PR)

- In `plans/ci-publish.md`:
  - Set the status to "A–B done; C–D pending (see baseline-0.4.1.md)".
  - Add a short "Phase B record" section with the facts above: ids, the environment policy and the rulesets.
  - Add the `hash -r` gotcha.
- In `docs/contributing/release.md`, under "Before you start": after upgrading npm, run `hash -r` (zsh), then check `npm --version`.
- Commit this file with those changes.

### 2. Quoted-key fix (a PR: `fix/quoted-api-key`)

**Bug:** `resolveApiKey` in `packages/core/src/config/load.ts` (about lines 506–531) passes the key through `nonEmpty()`, which only trims it. A key wrapped in quotes, such as `OPENROUTER_API_KEY='"sk-or-…"'` from a sourced YAML line, or `openrouter_api_key: "'sk-or-…'"` in the credentials file, is sent with the quotes still on. The provider then answers 401 "Missing Authentication header". The 0.4.0 published smoke run hit this.

- **Fix:**
  - In `resolveApiKey`, strip **one matching pair** of surrounding `"` or `'` quotes after trimming, for both sources (the env var and the credentials file). If the stripped value is empty, count it as missing.
  - Leave a key with a quote on one side only unchanged. That is corruption, not quoting.
  - Return a flag with the value, `stripped: true`, and carry it on the loaded config next to `apiKeySource`, for example `apiKeyQuoted: boolean`.
- **Doctor:** in `packages/core/src/tools/doctor.ts` (the `key` check at about line 178), stay `ok` but add to the detail that the key was wrapped in quotes, the quotes were removed, and where to fix it at the source (the env var or the credentials file). Use `warn` if doctor has that status; check `DOCTOR_CHECKS` and the status union.
- **Never print the key, or any part of it.**
- **Tests (write them first):**
  - `packages/core/src/config/config.test.ts`: double quotes, single quotes, quotes plus whitespace, a lone quote left unchanged, quotes around nothing counted as missing, and the credentials-file path.
  - The doctor test: the detail mentions the quotes and never contains the key.
  - Any test that loads config must pass a temp `home` (AGENTS.md).
- **Docs:**
  - `docs/troubleshooting.md`: replace the 401 "Missing Authentication header" advice with "quotes are stripped now; doctor tells you".
  - `docs/contributing/release.md` §6: drop the `tr -d "\"'"` workaround from the smoke-key recipe, or keep it only as a note for versions up to 0.4.0.
  - `tools/docs.test.ts` must stay green.
- **Optional, 5 minutes:** `packages/core/src/spec/lint.ts:143`. The `texts` variable is unused, and line 172 recomputes the same thing with `unquoted` (it came in with #10). Delete it if it's dead. If a check meant to use it, fix the check. This clears one of the two lint warnings `pnpm check` prints.
- **Gate:**
  - `pnpm check` passes.
  - An adversarial review by a general-purpose agent, which has caught real bugs before every merge.
  - The PR's CI passes, which the `main` ruleset now requires. Squash-merge it.

### 3. Release 0.4.1 through CI (phase C of `ci-publish.md`)

Follow `docs/contributing/release.md`. Only the maintainer can do the 2FA steps and the live smoke run; the agent prepares, checks and records.

1. On an up-to-date `main`: set `version: 0.4.1` in `catalog.yaml`, run `pnpm generate`, then `pnpm check`.
2. Local gates, per release.md §2:
   - `pnpm validate` (with `claude` on PATH), `pnpm release:check` and `pnpm smoke`.
   - This release doesn't touch the skills, routing or `main.ts`, so one `pnpm eval:routing all` run is enough as a sanity check, and the startup bench is skipped.
   - The local stage dry run (`node tools/release-publish.mjs --stage --dry-run`) comes after the commit in step 3, because it needs a clean tree.
3. Commit, tag, verify, and push the tag only:
   - Commit with the message "Release 0.4.1: version bump (not yet published)".
   - `git tag -s v0.4.1 -m "0.4.1: quoted OPENROUTER_API_KEY works; first release staged from CI"`.
   - Run `pnpm release:verify v0.4.1`. Every check must pass except "tag builds on origin/main"; that one passes only if `origin/main` is up to date, so run `git fetch` first.
   - Run `git push origin v0.4.1`. **Don't push `main`.**
4. Watch the `release` run with `gh run watch`.
   - `verify` must pass.
   - `stage`'s summary must list three stage ids.
   - If `stage` fails at the OIDC exchange (ENEEDAUTH or E401 on `npm stage publish`), re-run the job with `ACTIONS_STEP_DEBUG` set, or add `--loglevel verbose` to the npm call, and read the `oidc` lines. The usual causes are:
     - the workflow file name, repository or environment doesn't match the trusted publisher exactly;
     - `repository.url` doesn't match;
     - the npm version is below 11.15.
   - If it can't be fixed quickly, publish from the maintainer's machine instead (release.md "Break-glass") and fix the workflow in a follow-up.
5. The maintainer runs `pnpm release:approve 0.4.1`: review the file lists, then approve each package with 2FA. The script then waits until npm serves all three.
6. `git push origin main`. The admin bypass skips the required checks on this direct push, which is expected.
7. Verify from the published artifacts (release.md §6):
   - `pnpm smoke:published 0.4.1 --live`, with the key taken **with its quotes still on**, which proves the fix.
   - Check the Claude hook by hand.
8. **Record what the first CI release showed**, in 0022's "Consequences" and in `ci-publish.md` phase C:
   - Did the OIDC exchange work, and what did it take?
   - Provenance: `npm view @garygentry/system1@0.4.1 dist.attestations`, and the badge on npmjs.com. If it's missing, set `publishConfig.provenance: true` through the generator and note it for 0.5.0.
   - What `npm stage list --json` looked like after approval: are approved stages still listed, and with what `status`? If `release:approve` misbehaved, fix it (and `stagedFor`, which may need to filter on `status`).
   - How long a stage lives before it expires, if npmjs.com shows this.
   - The time from pushing the tag to live, and anything in the steps that was awkward.

   Then update `plans/ROADMAP.md` with the 0.4.1 entry (in the shape of the 0.4.0 one: tag, gates, per-harness results with measured costs, and the CI release notes).

### 4. Lock down npm (phase D)

The maintainer does these, with 2FA:

1. On npmjs.com, for each of the three packages, set Settings → Publishing access to **Require two-factor authentication and disallow tokens**.
2. Run `npm token list`, then `npm token revoke <id>` for every token that can publish, including the short-lived one from 0.4.0. Keep any read-only tokens only if something still uses them.
3. Check: `npm trust list <pkg>` is unchanged, and `npm access get status`, or the settings page, shows the new policy.

Then the agent:
- sets 0022's status to "accepted, in force since 0.4.1";
- sets `ci-publish.md` to complete;
- removes the remaining token wording from release.md ("a short-lived token" in the plan's "Why" can stay as history).

### 5. Clear the pipeline noise

- **Dependabot:** expect one grouped PR bumping the actions to new majors (checkout v4→v7, setup-node v4→v7, pnpm/action-setup v4→v6).
  - Read each changelog for breaking inputs. Watch setup-node ≥ v5's automatic caching with `packageManager`, and pnpm/action-setup's version handling.
  - Merge only if CI passes. Otherwise close it and pin the majors to ignore until after M10.
  - If `release.yml` changes, it can only be proven by the next release (0.5.0). Note that in the PR.
- **Ruleset upkeep:** the `main` ruleset requires the check names `check (ubuntu-latest, 22)` and so on. Add one line to `docs/architecture/deployment.md` § CI: "Changing the ci.yml matrix? Update ruleset 23977751's required checks, or merges stall."
- **`.handoff/npm.md`:** the research has been used (it's summarised in 0022 and `ci-publish.md`), so delete it. `.handoff/` is git-excluded.

### 6. Hand over to M10

- Start from the M10 handoff (`.handoff/m10.md`). Its step 1, the quoted-key fix, is already done by this plan, so start at the §1 spike: can a Codex plugin ship a Stop hook that blocks?
- The spec is `plans/milestones/M9-M11-scout-guard-adopt.md` §M10. It releases as 0.5.0 through the path this plan proved.

## Risks

- **The first OIDC stage fails.** Nothing goes live, because the publisher is stage-only. Publish from the maintainer's machine, then fix. Don't leave the tag in place if the bump commit has to change: delete and re-tag using the admin bypass, but only if nothing is staged.
- **The ruleset blocks something unexpected.** For example, the tag push is refused because of the `update` rule. Creating a tag is not an update, but if GitHub does refuse it, the admin bypass covers it; note what happened.
- **npm's stage list JSON differs from what npm 12.1.0's source shows.** `release:approve` fails closed (it approves nothing) and the error says so. Approve on npmjs.com instead, then fix the script.
