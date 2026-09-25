# Cut a release

Take a version from a catalog bump to published, tagged and verified in all three harnesses.

1. You push a signed `vX.Y.Z` tag, and nothing else.
2. The `release` workflow checks the tag and stages the three packages on npm.
3. You approve the staged packages with npm 2FA (`pnpm release:approve`), and only then push
   `main`.

No npm token exists anywhere: CI authenticates through npm trusted publishing (OIDC), and a staged
version can't go live without your 2FA. The design and its threat model are in
[0022](../../plans/decisions/0022-ci-publish-trusted-staged.md). How the pieces fit is in
[../architecture/deployment.md](../architecture/deployment.md).

## Before you start

- You are on an up-to-date `main` with a clean working tree, and CI is green on it.
- npm is 11.15 or newer (`npm --version`; `npm i -g npm@latest`), for `npm stage`. `npm whoami`
  shows an account that can publish to the `@garygentry` scope, and it has 2FA.
- Git signs tags with your SSH key (`gpg.format ssh`, `tag.gpgsign true`, and a
  `user.signingkey`), and that key is in `.github/allowed_signers`. The workflow checks tags
  against that file as it is on `main`. Tags from `v0.2.0` on are SSH-signed; `v0.1.0` is annotated
  but unsigned.
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
pnpm smoke              # bar: 12 of 12 (setup, doctor, many, scout × 3 harnesses)
pnpm eval:routing all   # see the bar below
```

- **Routing.** If the release changes a skill description or the route triggers, run with
  `--repeat 3` or more and hold the bars in [quality.md](../architecture/quality.md#live-and-local):
  Codex and Pi negatives must stay at 100%. Otherwise one run is a sanity check that nothing has
  regressed.
- **Startup.** If the release touches `main.ts`, the bundle or the route path, run
  `pnpm bench:startup` too (under 150 ms of overhead).
- **Dry run.** Once the bump is committed (step 3), `node tools/release-publish.mjs --stage
  --dry-run` runs every guard and `npm stage publish --dry-run` for each package, just as CI will.
  Read the file lists. npm's correction to the `bin` path is expected.

## 3. Commit, tag, and push the tag only

The tags are annotated, signed, and sit on the bump commit (`v0.3.1` is on `59cdfc6`). Their message
is the version and a one-line summary, for example `0.3.1: routing hook works for plugin-only Claude
installs`.

```sh
git commit -am "Release X.Y.Z: version bump (not yet published)"
git tag -s vX.Y.Z -m "X.Y.Z: <what this release is>"
pnpm release:verify vX.Y.Z           # the checks CI runs first; "npm does not serve" must pass
git push origin vX.Y.Z               # the tag only
```

**Don't push `main` yet.** The shim pins `npx @garygentry/system1@X.Y.Z`, and the marketplaces
serve the plugin from `main`. A pushed bump with no package behind it gives a plugin-only Claude
user a shim that can't find its CLI. Pushing the tag uploads the bump commit without moving
`main`.

## 4. CI stages the release

The tag starts `.github/workflows/release.yml`:

- **`verify`** has no npm credential. It runs `tools/release-verify.mjs`, which checks that:
  - the tag is `v` plus the packages' version;
  - it is annotated and signed by a key in `.github/allowed_signers` as committed on `origin/main`;
  - it builds on `origin/main`;
  - npm doesn't serve that version yet.

  Then it runs `pnpm check` and `pnpm release:check`.
- **`stage`** runs in the `npm-publish` environment with `id-token: write`, on Node 24 and a
  pinned npm 11. It runs `node tools/release-publish.mjs --stage --skip-check`. Each package's
  `npm stage publish` swaps the OIDC token for a credential that is valid for this run only. The
  run page's summary lists the three stage ids.

It publishes with npm, not pnpm, as every release has: the CLI's published `devDependencies` still
read `workspace:*`, which pnpm would rewrite. That is harmless, because consumers never install
devDependencies. Each package's `prepublishOnly` (`tools/prepublish-check.mjs`) runs its `build`
and `prepack` and refuses to publish if any `bin`, `exports` or `files` entry is missing.

If `verify` fails, nothing was staged. Fix the cause and either re-run the job or, if the fix
changes the commit, move the tag: `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`, which
needs your ruleset bypass, then tag again. Only move a tag while nothing at that version is staged
or live. If `stage` fails partway, run `npm stage list <name>` and approve or reject what is there
before re-running it. A package that is already live is skipped.

## 5. Approve, then push `main`

```sh
pnpm release:approve X.Y.Z
git push origin main
```

`release:approve` works through the three packages in order:

1. It finds exactly one stage of `X.Y.Z` for each package that isn't live yet. It stops if one is
   missing or duplicated. Reject extra stages with `npm stage reject <id>`.
2. It downloads each staged tarball and prints its file list and sizes. Read them: this review is
   the gate.
3. After you confirm, it runs `npm stage approve <id>` for core, the CLI and Pi. npm asks for 2FA.
4. It waits, up to 3 minutes, until npm serves all three. The registry lags a publish by about
   40 s (0.4.0).

You can approve on npmjs.com instead (the Staged Packages tab). Wait until `npm view <name>@X.Y.Z
version` answers for all three before pushing `main`.

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
`set -a; . ./.env; set +a`). If you take it from `~/.config/system1/credentials`, strip the YAML
quotes, or the provider answers 401 "Missing Authentication header" (0.4.0 hit this):
`OPENROUTER_API_KEY=$(sed -n 's/^openrouter_api_key: *//p' ~/.config/system1/credentials | tr -d "\"'")`. It spends each harness's tokens as well.

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

If CI can't stage, publish with your own npm login. That is interactive 2FA, which "Require
two-factor authentication and disallow tokens" still allows. It needs no token.

```sh
pnpm release:publish --dry-run          # every guard, plus npm publish --dry-run per package
pnpm release:publish --otp <code>       # publishes core → cli → pi, then waits until npm serves them
git push origin vX.Y.Z main             # tag and main together, after npm serves all three
```

It refuses to start unless the working tree is clean, every package is at the same version, and
`release:check` passes. A package npm already serves is skipped, so after an expired OTP you can
run it again. Pushing the tag afterwards still starts the workflow. Its `verify` job then stops at
"npm does not serve this version yet", so it stages nothing.

A new package has to go this way once: `npm stage publish` can't create a package. Add its trusted
publisher afterwards.

## One-time setup

This has already been done for the three packages; the record is in
[the plan](../../plans/ci-publish.md) (phase B).
Redo it if the repository, the workflow file name or the environment ever changes: npm trusts that
exact triple.

```sh
for p in @garygentry/system1-core @garygentry/system1 @garygentry/system1-pi; do
  npm trust github "$p" --repo garygentry/system1 --file release.yml --env npm-publish --allow-stage-publish --yes
done
npm trust list @garygentry/system1
```

- **GitHub:** create an environment `npm-publish` that deploys only from tags matching `v*`. Add
  rulesets that stop `v*` tags being updated or deleted, and stop `main` being force-pushed or
  deleted, with an admin bypass on both.
- **npm, for each package:** set Settings → Publishing access to *Require two-factor
  authentication and disallow tokens*, and revoke any old publish tokens.
