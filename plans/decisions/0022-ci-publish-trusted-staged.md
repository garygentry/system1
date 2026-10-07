# 0022. Publish from CI: trusted publishing, staged, approved with npm 2FA

- **Status:** accepted, in force since 0.4.1 (2026-09-25): the first CI release, then all three packages set to "Require two-factor authentication and disallow tokens", and the publish tokens revoked. **Amended 2026-10-06** ([Amendment 1](#amendment-1-2026-10-06-one-approval-in-github-replaces-stage--2fa)): a live publish behind the GitHub environment `release` replaces staging and per-package npm 2FA. Decision items 1, 2 and 4 and the threat model below are superseded where the amendment says so
- **Date:** 2026-09-25
- **Amends:** the M6 release procedure (publishing from the maintainer's machine). **Plan:** [`../ci-publish.md`](../ci-publish.md). **How-to:** [`docs/contributing/release.md`](../../docs/contributing/release.md).

## Context

Releases 0.1.0–0.4.0 were published from the maintainer's machine with `pnpm release:publish`, using a short-lived token or an interactive OTP. Since 2026-07-31, npm tokens that bypass 2FA can no longer manage accounts or packages. npm plans to remove their ability to publish directly in January 2027, after which they can only read and stage. We want releases that CI builds, with no long-lived secret, and that still need a person with npm 2FA to go live.

npm now offers:

- **Trusted publishing** from GitHub-hosted Actions. npm swaps the workflow's OIDC token for a credential that works for that run only. Each package trusts an exact repository, workflow file and, optionally, an environment. It needs npm ≥ 11.5.1 and Node ≥ 22.14. Public packages built from a public repo get provenance automatically.
- **Staged publishing.** `npm stage publish` uploads a version that isn't live until a maintainer runs `npm stage approve <id>` with 2FA. It needs npm ≥ 11.15.0, and the package must already exist. A trusted publisher can be limited to staging only.

## Decision

1. **Credential.** Use npm trusted publishing (OIDC) from `.github/workflows/release.yml`, in the GitHub environment `npm-publish`. There is no `NPM_TOKEN` anywhere. Once the first CI release has worked, the three packages are set to "Require two-factor authentication and disallow tokens", and the old tokens are revoked.
2. **Gate.** The trusted publisher is **stage-only**. CI stages the three packages, and nothing goes live until the maintainer approves each one with npm 2FA (`pnpm release:approve`, which runs `npm stage approve`).
3. **Trigger.** Pushing an SSH-signed `vX.Y.Z` tag starts the release. The first job has no npm credential. It runs `tools/release-verify.mjs`, which checks that:
   - the tag matches the packages' version;
   - it is annotated and signed by a key in `.github/allowed_signers`, as committed on `origin/main`;
   - it is a descendant of `origin/main`;
   - npm doesn't serve that version yet.

   The same job then runs `pnpm check` and `pnpm release:check`. Only after that does the stage job run with `id-token: write`.
4. **Ordering.** Push the tag only. `main` is pushed after npm serves all three packages. This keeps the rule M6 learned: a bump on `main` makes the marketplaces serve a shim pinned to a CLI version that must already exist.
5. **Break-glass.** `pnpm release:publish --otp` from the maintainer's own npm login stays available. It is interactive 2FA, which "disallow tokens" still permits.
6. **Hardening.**
   - Every action is pinned to a full commit SHA, and Dependabot keeps them current.
   - A ruleset blocks moving or deleting `v*` tags. A `main` ruleset blocks force-pushes and deletion and requires CI on pull requests. The admin can bypass both.
7. **No GitHub Release** is created. The publish job keeps `contents: read`, and `ROADMAP.md` stays the record of releases.

## What this protects against

- **A stolen GitHub account, a hostile tag, or an edited workflow** can at most stage a version. Going live needs the maintainer's npm 2FA, and this is the security boundary.
- **The signature check catches mistakes, not a hostile writer.** A tag push runs `release.yml` as it exists at the tagged commit, so someone with write access could remove the check. `allowed_signers` is read from `main`, so a tag can't approve its own key.
- **Provenance** shows where a package was built, not that the build was clean. Approving a release includes reviewing the file list of each staged tarball, which `release:approve` prints.

## Consequences

- A release takes three 2FA approvals, one per package. npm has no batch approval.
- A new package can't be staged. Its first version has to be published from the maintainer's machine, and then a trusted publisher added for it.
- A change to the release workflow can only be tested by a real release. Because the publisher is stage-only, a broken run can't publish anything.
- **Found while implementing this:** npm runs `prepublishOnly` before `prepack`. On a fresh checkout, Pi's skills don't exist until `prepack` has copied them, so `tools/prepublish-check.mjs` now runs `prepack` as well as `build`. Local releases never hit this, because `release:check` had already packed Pi.
- **Checked in npm 11.20.0's source rather than its docs:**
  - A staged publish goes through the same OIDC exchange as `npm publish` and turns provenance on automatically. It prints `+ name@x.y.z (staged with id <uuid>)`.
  - `npm stage list <name> --json` returns items with `id`, `packageName`, `version`, `tag`, `actor` and `shasum`.
- **Confirmed on the first CI release, 0.4.1** (plan, phase C):
  - The OIDC exchange worked first time with the pinned npm and no `registry-url` or token.
  - Staging signs provenance and logs it to sigstore, and the approved versions carry it (`dist.attestations` shows an SLSA v1 provenance for all three). `publishConfig.provenance` isn't needed.
  - Approved stages leave the list: `npm stage list` returned `[]` after approval, so `release:approve` needs no status filter.
  - `npm stage list` needs a valid npm login. The 0.4.0 token had expired and it answered E401, so the maintainer's first approval included an `npm login`.
  - A release took one web 2FA prompt per approval (three) plus one for the login.
- **Still open:** how long a stage lives before it expires, and what staging an already-staged version does. Neither came up on 0.4.1.

## Amendment 1 (2026-10-06): one approval in GitHub replaces stage + 2FA

Applies the estate release-gate policy, [ADR 0046 Amendment 4](https://github.com/garygentry/gnet-lg/blob/main/docs/decisions/0046-estate-github-access-policy.md) item 13 (gnet-lg#163), here through system1#52. The aim is **one human approval per release, which no agent can give itself**. Under the original decision a release needed three npm 2FA prompts plus several CLI steps (`release:approve`).

**Changes:**

1. **Gate.** The `publish` job (was `stage`) runs in the GitHub environment **`release`** (was `npm-publish`). The environment has a required reviewer (the maintainer), deploys only from `v*` tags, and doesn't allow an admin bypass. "Prevent self-review" is off: runs an agent starts count as the operator's own, so with it on they could never be approved. The agent's GitHub App has Actions: write, which lets it dispatch, re-run and cancel workflows. It has no Deployments or Administration write, so it can neither approve the gate nor change it.
2. **Credential.** The trusted publisher on each package is GitHub Actions, `garygentry/system1`, `release.yml`, environment `release`, with permission **publish** (was stage). The job runs `node tools/release-publish.mjs --provenance --skip-check`, which is a live `npm publish --provenance` per package. npm stays pinned at 11.20.0, with no `registry-url` and no token. Still no npm token, anywhere.
3. **Release summary.** `verify` (no credentials) now also runs `tools/release-summary.mjs` and writes the result to `$GITHUB_STEP_SUMMARY`:
   - the version and the three packages;
   - the tag message (this repo has no changelog);
   - `git log` and `git diff --stat` since the version npm serves as latest. It uses that version rather than the nearest `v*` tag, because the tag ruleset stops tags being moved, not created, and a planted tag could shrink the diff;
   - a `[!CAUTION]` block naming every file changed under `.github/`, or saying there is no trusted base.

   All of that text comes from whoever pushed the tag, so each part is fenced with a fence longer than any backtick run inside it, and can't forge markdown. The approver reads the summary on the run page before approving.

   **The summary is advice, not a control.** It is produced by the run it describes. A tag that edits `release.yml` or `tools/release-*.mjs` controls what the summary says, including whether the CAUTION block appears. No check inside a tag-triggered workflow can avoid that, because GitHub runs the tag's own copy of the workflow. The independent check is GitHub's own compare view, from npm's latest version to the tag, for `.github/` and `tools/release-*`. `release.md` makes it part of the approval.
4. **Ordering.** Push the tag only, and push `main` once the `publish` job has succeeded. That job waits until npm serves all three packages, so its success means they are live. The M6 rule still holds: the shim on `main` must never point at a CLI that npm doesn't serve. The agent can push `main` as soon as the job is green, and doesn't need to wait for the operator.
5. **Removed:** `pnpm release:approve`, `release-publish.mjs --stage` and the stage helpers (`stageIdFrom`, `stagedFor`, `atLeast`, `STAGE_NPM`). The break-glass path (item 5) is unchanged.
6. **Who does what.**
   - The agent does everything up to the gate: the release-prep PR, merging it, `release:verify`, `release:summary`, and pushing the tag. After the release it verifies with `npm view` and `smoke:published`.
   - The operator approves the environment once, on the web or in GitHub Mobile.
   - **The tag is no longer signed** (decided 2026-10-07). The agent creates an annotated tag, and `release:verify` checks that it is annotated, matches the version, descends from `main` and isn't on npm yet. It no longer checks a signature, and `.github/allowed_signers` is gone. That replaces decision item 3's signature check. A signature only ever caught mistakes, never a hostile writer (see below), and the environment approval is now the human gate. The approval stays the operator's only step.
7. **No GitHub Release and no `actions/attest-build-provenance`.** The only build artifacts are the three npm tarballs, and npm already signs SLSA provenance for those, made by this exact job. Attesting the same tarballs again would add `attestations: write` and nothing new.

**Accepted residual risk (ADR 0046 A4).** GitHub, not npm, is now the single factor:
- whoever controls the maintainer's GitHub account, or the environment's protection rules, can publish;
- npm 2FA no longer stands between a hostile tag and a live version.

What stays:
- no long-lived credential exists;
- the agent identity can't approve or reconfigure the gate (`gnet keys github` fails if it ever gains that permission);
- every publish carries provenance tying it to this workflow and commit;
- the `.github/` flag makes an edited workflow visible to the approver.

The "What this protects against" section above describes the original design. Read "the maintainer's npm 2FA" there as "the `release` environment's required reviewer".

**Operator steps, last** (the old path works until they are done):
1. For each package on npmjs.com, open Settings → Trusted publishing and set environment `release` with permission publish.
2. Keep "Require two-factor authentication and disallow tokens".
3. Cut a release through the gate, and check that all three packages are live with provenance.
4. Delete the `npm-publish` environment.

Until step 1 is done, the `publish` job fails at the OIDC exchange and publishes nothing.
