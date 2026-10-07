# Cut a release

Take a version from a catalog bump to published, tagged and verified in all three harnesses.

1. An annotated `vX.Y.Z` tag is pushed, and nothing else.
2. The `release` workflow's `verify` job checks the tag, runs the gates and writes a release
   summary on the run page.
3. The maintainer approves the `release` environment **once**, on the web or in GitHub Mobile.
   The `publish` job then publishes all three packages live, with provenance.
4. Once npm serves them (the job waits for that), `main` is pushed.

An agent can do every step except the approval. Its GitHub identity can't approve the
environment or change its rules. No npm token exists anywhere: CI authenticates through
npm trusted publishing (OIDC). The design and its threat model are in
[0022](../../plans/decisions/0022-ci-publish-trusted-staged.md) and its Amendment 1. How the pieces fit is in
[../architecture/deployment.md](../architecture/deployment.md).

## Before you start

- You are on an up-to-date `main` with a clean working tree, and CI is green on it.
- Tags are annotated. Tags `v0.2.0`–`v0.5.1` were also SSH-signed, but nothing checks that any
  more (0022 Amendment 1). Create the tag with `git tag -a`, and with `--no-sign` if your git
  config has `tag.gpgsign true`.
- `claude`, `codex` and `pi` are installed and signed in, for `pnpm validate`, smoke and the
  routing evals. Each of those spends that harness's tokens.
- An OpenRouter key is available for the live checks at the end.
- The one-time setup below has been done.

## 1. Bump and generate

1. Set `version:` in `catalog.yaml`. Use a minor bump for new behaviour and a patch for a fix. A
   breaking change to the envelope also needs a new `ENVELOPE_VERSION` and a decision record
   ([0015](../../plans/decisions/0015-cli-contract-v1.md)).
2. Regenerate, then run the full check:

   ```sh
   pnpm generate
   pnpm check
   ```

   `pnpm generate` stamps the version into 10 files: `.claude-plugin/marketplace.json`, the three
   plugin manifests, the shim's pinned version in `plugins/system1/bin/decide`,
   `packages/core/src/version.ts`, and the root, core, CLI and Pi `package.json` files. With
   `catalog.yaml`, that is the whole diff: compare `git show --stat 59cdfc6` (the 0.3.1 bump).

## 2. Run the local gates

CI covers `pnpm check` and `pnpm release:check`. The rest run only here.

```sh
pnpm validate           # with claude on PATH: adds `claude plugin validate --strict`
pnpm release:check      # packs all three, installs the CLI tarball, replays offline
pnpm smoke              # bar: 26 of 26 (Claude 8, Codex 10, Pi 8; see quality.md)
pnpm eval:routing all   # see the bar below
```

- **Routing.** If the release changes a skill description or the route triggers, run with
  `--repeat 3` or more and hold the bars in [quality.md](../architecture/quality.md#live-and-local):
  Codex and Pi negatives must stay at 100%. Otherwise one run is a sanity check that nothing has
  regressed.
- **Startup.** If the release touches `main.ts`, the bundle or the route path, run
  `pnpm bench:startup` too (under 150 ms of overhead).
- **Dry run.** Once the bump is committed (step 3), `pnpm release:publish --dry-run` runs every
  guard and `npm publish --dry-run` for each package, as CI will (CI also passes `--provenance`,
  which only works there). Read the file lists. npm's correction to the `bin` path is expected.

## 3. Commit, tag, and push the tag only

Release-prep changes such as fixes and docs land through PRs as usual. The version bump does
not: it is one commit on top of `origin/main`, and it reaches GitHub through the tag. `main`
fast-forwards to it once npm serves the release (step 5).

The tags are annotated and sit on the bump commit (`v0.3.1` is on `59cdfc6`). Their message
is the version and a one-line summary, for example `0.3.1: routing hook works for plugin-only Claude
installs`. The message heads the release summary.

```sh
git commit -am "Release X.Y.Z: version bump (not yet published)"
git tag -a --no-sign vX.Y.Z -m "X.Y.Z: <what this release is>"
pnpm release:verify vX.Y.Z           # the checks CI runs first; "npm does not serve" must pass
pnpm release:summary vX.Y.Z          # preview what the approver will read
git push origin vX.Y.Z               # the tag only
```

**Don't push `main` yet.** The shim pins `npx @garygentry/system1@X.Y.Z`, and the marketplaces
serve the plugin from `main`. A pushed bump with no package behind it gives a plugin-only Claude
user a shim that can't find its CLI. Pushing the tag uploads the bump commit without moving
`main`.

## 4. CI verifies, and waits for one approval

The tag starts `.github/workflows/release.yml`:

- **`verify`** has no npm credential. It runs `tools/release-verify.mjs`, which checks that:
  - the tag is `v` plus the packages' version;
  - it is annotated;
  - it builds on `origin/main`;
  - npm doesn't serve that version yet.

  Then it runs `pnpm check` and `pnpm release:check`. Last, `tools/release-summary.mjs` writes the
  release summary to the run page. It has the packages, the tag message, and the commits and
  `git diff --stat` since the version npm serves as latest. It uses that version, not the nearest
  tag, so a planted tag can't shrink the diff. A **CAUTION** block names any file changed under
  `.github/`, or says there is no trusted base to compare against.
- **`publish`** runs in the `release` environment with `id-token: write`, on Node 24 and a
  pinned npm 11. It waits until the maintainer approves the environment. Then it runs
  `node tools/release-publish.mjs --provenance --skip-check`. Each package's `npm publish` swaps
  the OIDC token for a credential that is valid for this run only. The job then waits, up to
  3 minutes, until npm serves all three. The registry lags a publish by about 40 s (0.4.0).

**The approval.** Before approving, the maintainer reads the summary on the run page. Pay
particular attention to the CAUTION block: a tag runs the workflow as the tagged commit wrote it.

**The summary is advice, not a control.** It is written by the run it describes, so a tag that
edits `release.yml` or `tools/release-*.mjs` can rewrite the summary too, including leaving out
the CAUTION block. So also check GitHub's own compare view,
`https://github.com/garygentry/system1/compare/vPREV...vX.Y.Z`, where `vPREV` is the version
`npm view @garygentry/system1 version` gives. Type the URL yourself rather than following a link
in the summary. Look for changes under `.github/` and `tools/release-*`. Any you didn't expect
mean: don't approve.

Then approve under "Review deployments", on the web or in GitHub Mobile. An agent can't approve
it. It can watch the run (`gh run watch`) and tell the maintainer it is waiting.

It publishes with npm, not pnpm, as every release has: the CLI's published `devDependencies` still
read `workspace:*`, which pnpm would rewrite. That is harmless, because consumers never install
devDependencies. Each package's `prepublishOnly` (`tools/prepublish-check.mjs`) runs its `build`
and `prepack` and refuses to publish if any `bin`, `exports` or `files` entry is missing.

If `publish` fails with `ENEEDAUTH` right after the tarball listing, npm didn't accept the OIDC
token: the package's trusted publisher doesn't match this run's repository, workflow file or
environment, or doesn't allow publish. Check `npm trust list <package>` against
[One-time setup](#one-time-setup), fix it, and re-run the failed job (`gh run rerun <id>
--failed`), which needs one more approval. Nothing was published.

If `verify` fails, nothing was published. Fix the cause and either re-run the job or, if the fix
changes the commit, move the tag: `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`, which
needs the maintainer's ruleset bypass, then tag again. Only move a tag while nothing at that
version is live. If `publish` fails partway, re-run the job (a new approval). A package that is
already live is skipped.

## 5. Push `main`

When `publish` is green, npm serves all three. Confirm, then push:

```sh
npm view @garygentry/system1@X.Y.Z version   # and -core, -pi
git push origin main
```

## 6. Verify from the published artifacts

The routing evals and Claude's smoke run the checkout bundle, so they can't see a packaging bug.
0.3.1 exists because this step found one: with only the plugin installed, 0.3.0's hook had no CLI
to run and stayed silent. Verify each harness on a **fresh profile holding only auth**, in a
consented toy repo outside this one, with no global `decide` unless the harness needs it.

- **Claude Code (plugin only).** Add the marketplace and install the plugin with
  `claude plugin marketplace add garygentry/system1` and `claude plugin install system1@system1`.
  Declaring the marketplace in `settings.json` isn't enough for `claude -p` (M8). Leave `decide`
  off PATH. Check that the hook stays silent before the first `decide` call (it never downloads)
  and hints after it, once the shim has fetched the CLI into npx's cache. Then give a prompt that
  doesn't name the skill, such as "Go through every file under src/ and flag the ones that make
  outbound network requests", and check that Claude loads `ask` and makes a live `decide many`
  call.
- **Codex.** Install the plugin from the marketplace, run `npm i -g @garygentry/system1@X.Y.Z`, and
  add the `prefix_rule` exactly as `setup` describes it. Run one live `ask`.
- **Pi.** `pi install npm:@garygentry/system1-pi` plus the global CLI. Run one live `ask`.

`tools/smoke/published.sh` drives all of this. Each harness gets a fresh profile under
`~/.cache/system1-smoke/published-X.Y.Z/` holding only a link to your auth. It installs from the
marketplace and npm, never from the checkout, and runs in a copy of
`tools/smoke/published-repo/`.

```sh
pnpm smoke:published X.Y.Z                 # install and run doctor per harness; spends nothing
pnpm smoke:published X.Y.Z --live          # plus one live ask per harness (~$0.0001 each)
pnpm smoke:published X.Y.Z codex --live    # one harness only
```

Without `--live` it checks that each harness installs the X.Y.Z plugin (from `main`, so the bump
must be pushed) and CLI, and that `decide doctor` runs through them. With `--live` it also grants
egress consent **in the throwaway fixture repo only**, and gives each agent the prompt above.
The pass marker is a `decide many` or `decide ask` line showing `live` with a measured cost.
`--live` needs `OPENROUTER_API_KEY` in the environment (for example
`set -a; . ./.env; set +a`), or taken from the credentials file:
`OPENROUTER_API_KEY=$(sed -n 's/^openrouter_api_key: *//p' ~/.config/system1/credentials)`.
From 0.4.1, `decide` removes the YAML quotes that leaves on; to smoke 0.4.0 or earlier, append
`| tr -d "\"'"` inside the `$(…)`, or the provider answers 401 "Missing Authentication header".
It spends each harness's tokens as well.

The Claude hook's silent-then-hinting behaviour isn't asserted by the script. Check it by hand in
the Claude profile the script leaves behind (`CLAUDE_CONFIG_DIR=~/.cache/system1-smoke/published-X.Y.Z/claude`).
Record each harness's `decide` line and its cost.

## 7. Record it

Update `plans/ROADMAP.md` (and the current milestone, if the release closes one) with what was
published, where it was tagged, and the per-harness results with measured costs, then commit and
push. See commit `4a538f1` for the shape.

If verification finds a bug, fix it and cut a patch release from step 1, as 0.3.1 did for 0.3.0.
0.3.0 was left published and superseded rather than withdrawn.

## Break-glass: publish from your machine

If CI can't publish, publish with your own npm login. That is interactive 2FA, which "Require
two-factor authentication and disallow tokens" still allows. It needs no token.

```sh
pnpm release:publish --dry-run          # every guard, plus npm publish --dry-run per package
pnpm release:publish --otp <code>       # publishes core → cli → pi, then waits until npm serves them
git push origin vX.Y.Z main             # tag and main together, after npm serves all three
```

It refuses to start unless the working tree is clean, every package is at the same version, and
`release:check` passes. A package npm already serves is skipped, so after an expired OTP you can
run it again. Pushing the tag afterwards still starts the workflow. Its `verify` job then stops at
"npm does not serve this version yet", so it publishes nothing.

A new package has to go this way once, because a trusted publisher can only be added to a package
that already exists. Add its trusted publisher afterwards.

## One-time setup

Redo this if the repository, the workflow file name or the environment ever changes: npm trusts
that exact triple. The 2026-10-06 switch from `npm-publish` (stage-only) to `release` (publish) is
recorded in [0022](../../plans/decisions/0022-ci-publish-trusted-staged.md) Amendment 1.

- **GitHub:** an environment `release` with:
  - the maintainer as a required reviewer;
  - "prevent self-review" **off** (runs an agent starts count as the maintainer's own);
  - no admin bypass;
  - deployments only from tags matching `v*`.

  Add rulesets that stop `v*` tags being updated or deleted, and stop `main` being force-pushed or
  deleted, with an admin bypass on both.
- **npm, for each package:** one trusted publisher: GitHub Actions, `garygentry/system1`,
  workflow `release.yml`, environment `release`, permission **publish**. A package holds one
  trusted publisher, so replace the old one rather than adding a second. Check the result with
  `npm trust list`: on 0.6.0, an edit on npmjs.com changed the permission but left the
  environment at `npm-publish`, and the first `publish` run failed with `ENEEDAUTH`. On the CLI
  (an npm with `npm trust`, such as 12.1, logged in):

  ```sh
  for p in @garygentry/system1-core @garygentry/system1 @garygentry/system1-pi; do
    npm trust list "$p"     # note the id
  done
  npm trust revoke <package> --id=<id>
  npm trust github <package> --repo garygentry/system1 --file release.yml --env release --allow-publish --yes
  ```

  Then `npm trust list` shows, for each package, `environment: release` and
  `permissions: publish`.

  Set Settings → Publishing access to *Require two-factor authentication and disallow tokens*,
  and revoke any old publish tokens.
