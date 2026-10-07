# Fresh-machine check

A quick check that the published `decide` installs and works on this machine, in a clean
profile, without spending anything. It takes a few seconds, longer the first time npm downloads
the package. The maintainer runs it before every design-partner session. A partner on a Mac can
run it too, if they're willing, before or after their session: it is the first check of System 1
on macOS outside CI.

You need Node 22 or newer, npm and git. From a clone of the repo, at the release being tried:

```sh
git clone https://github.com/garygentry/system1.git
cd system1
git checkout v0.6.0
sh tools/partners/fresh-check.sh
```

In a checkout with dependencies installed, `pnpm partners:check` runs the same script.

## What it does

1. Reports Node, git, the OS and any of `claude`, `codex` and `pi` it finds, with their versions.
2. Says whether **your** profile has an OpenRouter key: `present (environment)`,
   `present (credentials file)` or `absent`. It never opens the credentials file, and never prints
   or uses the key.
3. Installs `@garygentry/system1` at that version from npm into a throwaway directory, with a
   throwaway config directory and a small throwaway repo. Your global install, your config and your
   repos are left alone.
4. Runs `decide doctor` there. In a clean profile it should say `SETUP NEEDED (key, consent)`, and
   nothing else should be wrong.
5. Replays one recorded decision (`decide many --spec smoke`), which needs no key and no network.
6. Runs `decide ping`, which reaches the model's endpoint with no key and costs nothing.
7. Checks that no consent and no credentials were written, then deletes the throwaway directory.

It ends with `fresh-check: PASS` or `fresh-check: FAIL`, and a few lines to paste into the
session notes. On a failure it keeps the throwaway directory and prints where it is.

## Options

| Option | Use |
|---|---|
| `--version X.Y.Z` | Check another release than the checkout's |
| `--decide <path>` | Check a local build (`packages/cli/dist/bundle/decide.mjs`) instead of installing from npm |
| `--offline` | Send nothing at all: no `ping`, and doctor's probe goes to a local port. Needs `--decide` |
| `--keep` | Keep the throwaway directory |

## What it doesn't check

Your harness's plugin, your key, or your consent: those are what the first hour itself tests, from
the [README](../../README.md). The script never grants consent and never handles a key.
