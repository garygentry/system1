# Cut a release

Take a version from a catalog bump to published, tagged and verified in all three harnesses. There
is no release workflow in CI: releases run from a maintainer's machine, with
`pnpm release:publish` for the npm step and `pnpm smoke:published` to verify. The steps are
written down here from `package.json`,
`plans/milestones/M6-release.md`, `plans/milestones/M8-onboarding.md`, the release commits and
[ROADMAP known gap 1](../../plans/ROADMAP.md#1-claude-does-not-hand-off-a-review-of-its-own-work-routing-ask).
How the pieces fit is in [../architecture/deployment.md](../architecture/deployment.md).

## Before you start

- You are on an up-to-date `main` with a clean working tree, and CI is green on it.
- `npm whoami` shows an account that can publish to the `@garygentry` scope.
- Git signs tags with your SSH key (`gpg.format ssh`, `tag.gpgsign true`, and a
  `user.signingkey`). Tags from `v0.2.0` on are SSH-signed; `v0.1.0` is annotated but unsigned.
- `claude`, `codex` and `pi` are installed and signed in, for `pnpm validate`, smoke and the
  routing evals. Each of those spends that harness's tokens.
- An OpenRouter key is available for the live checks at the end.

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
- **Dry run.** Once the bump is committed (step 3), `pnpm release:publish --dry-run` runs every
  guard and `npm publish --dry-run` for each package. Read the file lists. npm's corrections to
  the `bin` path and the `repository.url` form are expected.

## 3. Commit the bump, but don't push it yet

```sh
git commit -am "Release X.Y.Z: version bump (not yet published)"
```

**Don't push until npm has all three packages.** The shim pins `npx @garygentry/system1@X.Y.Z`,
and the marketplaces serve the plugin from `main`. A pushed bump with no package behind it gives a
plugin-only Claude user a shim that can't find its CLI.

## 4. Publish the three packages

```sh
pnpm release:publish                  # add --otp <code> if npm asks for one
```

It refuses to start unless the working tree is clean, every package is at the same version, and
`release:check` passes. Then it publishes `@garygentry/system1-core`, `@garygentry/system1` and
`@garygentry/system1-pi`, in that order, with `npm publish`. Last, it waits (up to 3 minutes)
until npm serves all three: the registry lags a publish, by about 40 s for 0.4.0. It uses `npm publish` rather than `pnpm publish`, as every release has: the CLI's published
`devDependencies` still read `workspace:*`, which pnpm would rewrite. That is harmless, because
consumers never install devDependencies.

A package npm already serves at this version is skipped, so if a publish fails partway (an
expired `--otp` code, a network error), fix the cause and run it again. It never tags or pushes.

Each package's `prepublishOnly` (`tools/prepublish-check.mjs`) rebuilds it and refuses to publish
if any `bin`, `exports` or `files` entry is missing. The Pi package's `prepack` copies the skills
in. `publishConfig.access` is already `public`.

## 5. Tag and push

The tags are annotated, signed, and sit on the bump commit (`v0.3.1` is on `59cdfc6`). Their message
is the version and a one-line summary, for example `0.3.1: routing hook works for plugin-only Claude
installs`.

```sh
git tag -s vX.Y.Z -m "X.Y.Z: <what this release is>"
git tag -v vX.Y.Z                     # optional: needs gpg.ssh.allowedSignersFile set up
git push origin main vX.Y.Z
```

Push the branch and the tag together, in one `git push`, and only after `release:publish` has
confirmed npm serves all three packages.

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
