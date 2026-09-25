# 0022. Publish from CI: trusted publishing, staged, approved with npm 2FA

- **Status:** accepted, in force since 0.4.1 (2026-09-25): the first CI release, then all three packages set to "Require two-factor authentication and disallow tokens", and the publish tokens revoked
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
