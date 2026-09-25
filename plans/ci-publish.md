# Plan: publish from CI with trusted publishing and staged approval

- **Status:** complete, 2026-09-25 (C: the 0.4.1 release; D: the lock-down, done by the maintainer)
- **Decision:** [`decisions/0022-ci-publish-trusted-staged.md`](decisions/0022-ci-publish-trusted-staged.md)
- **Replaces:** `docs/contributing/release.md` §4 (publishing from the maintainer's machine) as the documented path. `pnpm release:publish` stays as a break-glass option.
- **Inputs:** `.handoff/npm.md` (agent research), checked against the primary sources listed at the end.

## Why

Releases are published from the maintainer's machine, using a short-lived token or an OTP. Since 2026-07-31, npm tokens that bypass 2FA can't manage accounts or packages. npm plans to remove their ability to publish directly in **January 2027**. After that they can only read packages and stage publishes. We want publishing that runs in CI, holds no long-lived secret, and needs a human with npm 2FA to make each version live.

## Decisions (from the interview)

| # | Question | Choice |
|---|---|---|
| 1 | Credential | **npm trusted publishing (OIDC)** from GitHub Actions. There is no `NPM_TOKEN` anywhere. |
| 2 | Go-live gate | The trusted publisher is **stage-only** (`--allow-stage-publish`). CI runs `npm stage publish`. The maintainer runs `npm stage approve`, with 2FA, once for each of the three packages. |
| 3 | Trigger | Pushing an **SSH-signed `vX.Y.Z` tag**. CI checks the signature against `.github/allowed_signers` taken from `origin/main`, checks the tag against the version, and checks that the tag commit descends from `origin/main`. |
| 4 | Ordering | Push **the tag only**. CI stages, you approve, npm serves the packages, and **then** you push `main`. This keeps today's rule that no bump reaches `main` (where the marketplaces serve the plugin) before npm serves the CLI that the shim pins. |
| 5 | Break-glass | Keep `pnpm release:publish` for publishing from your npm login with an interactive `--otp`. That is still allowed under "Require 2FA and disallow tokens". |
| 6 | Hardening | Add a `v*` tag ruleset and a `main` ruleset (no force-push or deletion, CI required on PRs, admin bypass). SHA-pin every action and have Dependabot keep them current. After the first CI release, lock the packages to "Require 2FA and disallow tokens" and revoke the old tokens. |
| 7 | GitHub Release | No. The publish job keeps `contents: read` and `id-token: write`, and the ROADMAP stays the record of releases. |

### What this protects against, and what it doesn't

- **A stolen GitHub account, or a malicious tag or workflow change:** it can stage a version but can't make it live. That needs the maintainer's npm 2FA, and this is the security boundary.
- **The signature check** guards against mistakes: an unsigned or wrong-key tag, or a tag on the wrong commit. It is not a defence against someone who already has write access. A tag push runs `release.yml` as it exists *at the tagged commit*, so a writer could remove the check. That's acceptable, because staging is the gate. `allowed_signers` is read from `origin/main` rather than from the tag, so a tag can't approve its own key.
- **Provenance** shows *where* a package was built, not that the build was clean. The unprivileged job runs `pnpm check` and `release:check`, and approval should include a look at the staged tarball (`npm stage download`).

## Release flow after this change

```
local:  bump catalog → pnpm generate → pnpm check → local-only gates (validate, smoke, eval:routing)
        git commit -m "Release X.Y.Z: version bump (not yet published)"
        git tag -s vX.Y.Z -m "X.Y.Z: …"
        git push origin vX.Y.Z              ← tag only, main NOT pushed
CI:     verify (no OIDC): signature, tag==version, ancestry, pnpm check, release:check
        stage  (env npm-publish, OIDC): npm stage publish ×3 → job summary lists stage ids
local:  pnpm release:approve X.Y.Z          ← npm stage approve ×3 (2FA), waits until npm serves all three
        git push origin main
        pnpm smoke:published X.Y.Z --live   ← unchanged §6
```

If CI fails *before* anything is staged, fix the problem and either re-run the job, or move the tag. Moving it means deleting and re-tagging under the admin bypass, which is allowed only while nothing at that version has been staged or approved. Once a version is approved, never move its tag. Anything wrong after that ships as a patch release, as 0.3.1 did.

## Implementation

### A. Repository changes (one PR)

1. **Decision record `0022-ci-publish-trusted-staged.md`.** Record choices 1–7, the threat model above, and the January 2027 deadline. Link it from `ROADMAP.md`.
2. **Normalise `repository.url`.** npm requires it to match the repo exactly. Today `cli` has `git+https://github.com/garygentry/system1.git`, while `core` and `pi` have `https://github.com/garygentry/system1`.
   - Have `tools/generate.ts` stamp `repository: { type: "git", url: "git+https://github.com/garygentry/system1.git", directory: "packages/<pkg>" }` into **all three** package.json files, built from `catalog.yaml`'s `repository`. Today it does this only for Pi, and core's value is written by hand.
   - Add a `tools/validate.ts` check that all three match that exact form.
3. **`.github/allowed_signers`.** Add one line: `gary@garygentry.net namespaces="git" <contents of ~/.ssh/id_ed25519.pub>`. Add `pnpm release:verify vX.Y.Z` (`tools/release-verify.mjs`), which the workflow runs too, so the maintainer can run the same check locally (this also fixes the `gpg.ssh.allowedSignersFile` error that release.md mentions today).
4. **`tools/release-publish.mjs`.**
   - Add `--stage`. It runs `npm stage publish` instead of `npm publish`, skips the wait for npm to serve the packages, and prints each stage id with the `npm stage approve <id>` command for it.
   - Add `--skip-check`. CI already ran `release:check` in the verify job, and `prepublishOnly` still rebuilds and checks the files.
   - Keep the existing "skip if npm already serves this version" logic.
   - It reads each stage id from npm's `+ name@x.y.z (staged with id <uuid>)` line and writes them to the job summary.
5. **`tools/release-approve.mjs`, run as `pnpm release:approve X.Y.Z`.**
   - It lists the staged versions of the three packages (`npm stage list <name>`), shows each tarball's file list and size, and asks for confirmation.
   - It then runs `npm stage approve <id>` for core, cli and pi. npm asks for 2FA.
   - It reuses the "wait until npm serves all three" loop from `release-publish.mjs` (factor it out into `tools/release-lib.mjs`).
   - It finishes with "Next: `git push origin main`".
   - It needs npm ≥ 11.15 locally and refuses to run on an older version with a clear message.
6. **`.github/workflows/release.yml`.** The filename is part of npm's trusted identity, so it must never be renamed.
   - `on: push: tags: ['v[0-9]+.[0-9]+.[0-9]+']`, top-level `permissions: {}`, `concurrency: { group: release, cancel-in-progress: false }`, and `timeout-minutes` on every job.
   - **`verify`** runs on `ubuntu-latest` with `permissions: contents: read`:
     - Check out with `fetch-depth: 0`.
     - Run `git fetch --force origin "+refs/tags/$TAG:refs/tags/$TAG"`, because checkout turns annotated tags into lightweight ones.
     - Fetch `main`.
     - Verify the signature: `git show origin/main:.github/allowed_signers > "$RUNNER_TEMP/signers"` and `git -c gpg.ssh.allowedSignersFile="$RUNNER_TEMP/signers" verify-tag "$TAG"`.
     - Check that `$TAG` equals `v` + the catalog version, and that all three `package.json` files carry that version.
     - Check ancestry with `git merge-base --is-ancestor origin/main "$GITHUB_SHA"`, and check that npm does not already serve the version.
     - Run `pnpm install --frozen-lockfile`, then `pnpm check`, then `pnpm release:check`.
   - **`stage`** runs with `needs: verify`, `environment: npm-publish` and `permissions: { contents: read, id-token: write }`:
     - Run checkout, then pnpm setup, then setup-node. Pin Node 24 (npm trusted publishing needs Node ≥ 22.14, and the repo's `.nvmrc` 22 may resolve lower on the runner cache). Leave out `registry-url` and don't set `NODE_AUTH_TOKEN`, so npm uses the OIDC exchange.
     - Run `npm install -g npm@<exact 11.x ≥ 11.15.0>`. Pin it to an exact version, and have Dependabot or a manual bump keep it current.
     - Run `pnpm install --frozen-lockfile`, then `node tools/release-publish.mjs --stage --skip-check`.
     - Write the stage ids and approve commands to `$GITHUB_STEP_SUMMARY`.
   - Pin every action by full commit SHA, with the version in a comment. The stage job never downloads artifacts from the verify job; it rebuilds from the tag.
7. **Pin `ci.yml` too**, and add `.github/dependabot.yml` covering the `github-actions` ecosystem weekly. Leave npm updates out; that is a separate decision.
8. **Docs.**
   - Rewrite `docs/contributing/release.md` §3–§5 for the tag-only push, the stage, the approve and then the push of `main`.
   - Move the current §4 to a "Break-glass: publish from your machine" section.
   - Add "Before you start" requirements: npm ≥ 11.15 locally, and a 2FA device.
   - Update the publishing notes in `docs/architecture/deployment.md` and the "What CI does not cover" part of `docs/ci-and-scripts.md`, and add the `release` workflow to its jobs table.
   - Add both new scripts to the scripts table.
   - Update `docs/docplan.json` if the doc tests require it.
9. **Tests.**
   - Unit-test the argument handling of `release-publish.mjs` and `release-approve.mjs`, and the version, tag and ancestry checks if they are factored into a function (`tools/release-lib.test.ts`). Stub `npm`, as the existing tools tests do; no network.
   - Test the validate check from step 2.
   - `pnpm check` stays green.

### B. One-time setup: the maintainer does these with 2FA; the agent can run the `gh` parts with your OK

1. Upgrade the local npm with `npm i -g npm@latest`; it needs to be ≥ 11.15. It's at 10.9.8 today.
2. **Trusted publisher, stage-only, for each package** (run with 2FA):
   ```sh
   for p in @garygentry/system1-core @garygentry/system1 @garygentry/system1-pi; do
     npm trust github "$p" --repo garygentry/system1 --file release.yml --env npm-publish --allow-stage-publish --yes
   done
   npm trust list @garygentry/system1   # confirm: stage-only, env npm-publish
   ```
3. **GitHub environment `npm-publish`.** Allow deployments only from tags matching `v*`. Add no required reviewers: approval happens on npm.
4. **Rulesets.**
   - `v*` tags: block update and deletion, with the admin on the bypass list.
   - `main`: block force-push and deletion, and require the `ci` checks on pull requests, with the admin on the bypass list for the direct release push.

### Phase B record (done 2026-09-25)

- **Trusted publishers** on `@garygentry/system1-core`, `@garygentry/system1` and `@garygentry/system1-pi`: github, `garygentry/system1`, `release.yml`, environment `npm-publish`, permission `stage publish`. npm trust ids: core `ca4de797-…`, cli `30212865-…`, pi `9d073b74-…`.
- **Environment `npm-publish`** deploys only from tags matching `v*`, with no required reviewers.
- **Rulesets:** 23977750 "release tags" blocks updating or deleting `refs/tags/v*`. 23977751 "main" blocks deleting or force-pushing `main` and requires the six `ci.yml` checks. The admin can bypass both.
- **Gotcha:** the maintainer's npm 12.1.0 is at `~/.local/bin/npm`, but `/usr/bin/npm` 10.9.8 is still installed. After the upgrade, zsh kept the old path until `hash -r`.

### C. First CI release (the next real version)

1. Cut it by following the new flow. Because the trusted publisher is stage-only, a broken first run can't publish anything bad. If CI can't stage, run the break-glass `pnpm release:publish --otp …` and fix things afterwards.
2. **Check on this first run** (the docs don't cover these; note the results in 0022):
   - OIDC works with the pinned npm, without `registry-url`.
   - Approved versions carry provenance (`npm view @garygentry/system1@X.Y.Z dist.attestations`, and the npmjs.com badge). If they don't, add `publishConfig.provenance: true` or `--provenance` and re-test on the next release.
   - What happens when a stage is re-run for a version that is already staged, and whether `npm stage list` needs anything more than a normal login. Adjust `release-approve.mjs` and the re-run guidance to match.
   - How long a stage lives before it expires.
3. Record the run in `ROADMAP.md` as usual (§7).

### Phase C record (0.4.1, 2026-09-25)

- **Timing:** the tag was pushed at 21:39:29 UTC. `verify` and `stage` passed by 21:40:48 (run 36192731176). npm served all three packages at about 21:47, after the maintainer's login and three approvals.
- **OIDC and provenance:** both worked first time; see 0022 "Consequences" for the details.
- **Stage list:** empty after approval.
- **Warnings:** the approvals printed `Unknown env config "verify-deps-before-run"` (and `npm-globalconfig`, `_jsr-registry`). These are pnpm settings passed to scripts as `npm_config_*`, which npm 12 warns will become errors. The release scripts now run npm without them (`npmEnv` in `tools/release-lib.mjs`).
- **Annotations:** the pinned checkout, setup-node and pnpm/action-setup actions target Node 20 and are forced onto Node 24. The Dependabot bump (baseline step 5) addresses this.
- **Live smoke:** `smoke:published 0.4.1 --live` passed 9 of 9 with the key taken from the credentials file, quotes still on.

### D. Lock-down, after C succeeds

Done 2026-09-25, by the maintainer on npmjs.com. The npm 12 CLI can't read the publishing-access setting (`npm access` only sets `mfa`), and `npm token list` and `npm trust list` ask for web 2FA, so this was checked in the browser rather than by an agent.

1. On npmjs.com, set each of the three packages to Settings → Publishing access → **Require two-factor authentication and disallow tokens**.
2. Revoke every npm granular token that can publish (`npm token list`, then `npm token revoke`), including the short-lived one from 0.4.0.
3. Update 0022's status and remove any mention of tokens from release.md.

## Known limits

- **New packages:** `npm stage publish` can't create a package, so a fourth package would have to be published once from the maintainer's machine (break-glass), and then have a trusted publisher added.
- **Three approvals per release:** approval is per package and has no batch mode. `release:approve` sequences them, but each may ask for 2FA.
- **Only GitHub-hosted runners:** trusted publishing doesn't support self-hosted runners.
- **`release.yml` changes take effect only for tags that contain them.** Test changes to the workflow on a real release; there is no dry run of the OIDC exchange.

## Sources

- [Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/): npm ≥ 11.5.1, Node ≥ 22.14.0, stage-only publishers, the exact `repository.url` match, and automatic provenance.
- [Staged publishing](https://docs.npmjs.com/staged-publishing/): npm ≥ 11.15.0, the package must already exist, and approval needs 2FA.
- [`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust/): `--allow-stage-publish`, `--env`, `--file`, `list` and `revoke`.
- [Restricting bypass-2FA tokens (2026-07-31)](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/): the January 2027 end of direct publishing.
- [Stage-only tokens (2026-09-18)](https://github.blog/changelog/2026-09-18-stage-only-npm-tokens-for-safer-automation/): the fallback if OIDC isn't available.
- [Things you need to do for npm trusted publishing to work](https://philna.sh/blog/2026/01/28/trusted-publishing-npm/): the `repository.url` form, and provenance sometimes needing the flag.
- [Hardening npm publishing: OIDC and staged](https://codenote.net/en/posts/npm-trusted-publishing-oidc-staged-hardened-release/): approval per package, and the limits of provenance.
