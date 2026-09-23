# Run decide in CI, git hooks and scripts

`decide` needs no agent. A script can gate a pipeline on a spec, branch on the exit code, and choose
between replaying committed answers and calling the model live. This page assumes you already have
a spec with recorded fixtures; see [specs.md](specs.md).

This is the pattern this repo's own CI uses (the cookbook replay test and `pnpm release:check`).
No outside project has run it in its own CI yet.

## Install the CLI on its own

Scripts, hooks and CI need only the CLI, not the plugin. It needs Node 22 or newer:

```sh
npm i -g @garygentry/system1
```

In CI, pin the version you tested with (`@garygentry/system1@<version>`), so a new release can't
change a gate without a reviewed diff.

## Test specs offline with replay

`decide spec check <name>` replays the answers committed in `.system1/fixtures/<name>/`. It needs
no key, no consent and no network, and costs nothing. Set `SYSTEM1_REPLAY=1` for the job too, so
that no other `decide` call in it goes live even if a key is in the environment.

By default a mismatch does **not** change the exit code: `spec check` exits 0 and reports
`passed: false`. Add `--strict` to make a mismatch exit 7 instead, and gate on the exit code. A
missing answer is `replay-miss`, exit 6, with or without `--strict`.

A GitHub Actions job that checks every spec in the repo:

```yaml
name: specs
on: [push, pull_request]

jobs:
  specs:
    runs-on: ubuntu-latest
    env:
      SYSTEM1_REPLAY: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm i -g @garygentry/system1
      - name: Replay every spec's examples
        run: |
          fail=0
          for f in .system1/specs/*.yaml; do
            name=$(basename "$f" .yaml)
            decide spec check "$name" --strict --format brief || fail=1
          done
          exit "$fail"
```

The brief headline says `PASSED` or `FAILED`, and each example that didn't pass prints its full
answers. Drop `--format brief` to get the JSON envelope, with `passed` and `counts` in `result`.

## Gate on a result

Every command prints one JSON envelope by default:

```json
{"v": 1, "ok": true, "command": "many", "result": { … }}
{"v": 1, "ok": false, "command": "many", "error": {"code": "budget-exceeded", "message": "…", "details": { … }}}
```

Branch on the exit code first, then on `error.code`. Never parse the message: it can change, and
`error.code` is stable. The codes and their exit codes are listed in
[cli.md](cli.md#exit-codes), and [troubleshooting.md](troubleshooting.md#errors) says what each
one means. The fields of each result are in [output.md](output.md).

```sh
if out=$(decide many --spec no-timeout --glob 'server/**/*.ts'); then
  echo "$out" | jq -r '.result.kept[].id'
else
  case $(echo "$out" | jq -r '.error.code') in
    replay-miss)     echo "no recorded answer: run it live once, or record the spec" ;;
    budget-exceeded) echo "$out" | jq '.error.details.projection' ;;
    egress-refused)  echo "this repo has not consented to live calls" ;;
    *)               echo "$out" | jq -r '.error.message' ;;
  esac
  exit 1
fi
```

A few things to check in a successful result:

- **Undecided items** are in `result.undecided`, apart from `kept`, and are never thresholded.
  Treat them as "a person looks", not as a pass.
- **Items that failed** on their own (while the rest succeeded) are in `result.failed`, with a
  `code` each, and `result.counts.failed` counts them. The exit code is still 0.
- **`ask` with `--keep`** puts its outcome in `result.verdict`: `kept`, `dropped` or `undecided`.

For `many`, `--format jsonl` prints one line per kept, undecided or failed item, each with a
`status`, then a `summary` line with the counts and usage. It suits streaming into other tools:

```sh
decide many --spec no-timeout --format jsonl | jq -c 'select(.status == "kept")'
```

When the answer gates something risky, use it only to add caution: "if `destructive ≥ 0.3`, stop
and ask", never "if `safe ≥ 0.9`, skip the review". See
[concepts.md](concepts.md#thresholds-and-undecided).

## Run live in CI

A live run needs three things in the job.

1. **The key, as a CI secret.** Pass it as `OPENROUTER_API_KEY`. `decide` never prints it and
   never reads a `.env` file.
2. **The repo's consent, committed.** Consent is read only from `<repo>/.system1/config.yaml`, so
   CI can go live only if that file is committed with consent in it. That shares the consent with
   everyone who clones the repo, so make it a deliberate team decision in a reviewed change. Someone
   who agrees runs `decide config egress allow --by "<who, and why>"` in a terminal at the repo
   root, and commits the file. Don't grant it from the CI job itself. What gets sent, and the
   checks it passes first, are in [concepts.md](concepts.md#what-gets-sent).
3. **The spend guard, left on.** A run projected over 200 calls or $0.05 stops with
   `budget-exceeded`, exit 4. Don't add `--confirm` to a CI command. If the team accepts a higher
   limit, raise `budget.maxCalls` or `budget.maxUsd` in the committed config, where it is reviewed.
   See [spend.md](spend.md).

```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm i -g @garygentry/system1
      - name: Screen server code for network calls with no timeout
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          SYSTEM1_SESSION: ci-${{ github.run_id }}
        run: |
          decide many --spec no-timeout --glob 'server/**/*.ts' --format brief
          decide usage --session current --format brief
```

`SYSTEM1_SESSION` tags every call in the spend ledger, so `decide usage --session current` reports
what this job spent. Live answers are not saved unless you pass `--record`.

Without a key, `decide` falls back to replay, and a question with no recorded answer is
`replay-miss`, exit 6. On GitHub, secrets are not passed to workflows run from forks, so a pull
request from a fork takes that path.

## A pre-commit gate

A git hook can judge the staged changes before they are committed. `--staged` reads the index
against `HEAD`, and `--split hunk` makes each hunk one item. This hook stops the commit when the
[`secret-leak`](cookbook.md#secret-leak) recipe keeps a hunk, or can't decide one:

```sh
#!/bin/sh
# .git/hooks/pre-commit
out=$(decide many --spec secret-leak --staged --split hunk --format json) || {
  echo "secret-leak check skipped: $(printf '%s' "$out" | jq -r '.error.code')" >&2
  exit 0
}
n=$(printf '%s' "$out" | jq '.result.counts.kept + .result.counts.undecided')
if [ "$n" -gt 0 ]; then
  printf '%s' "$out" | jq -r '(.result.kept + .result.undecided)[].id' >&2
  echo "These staged hunks may write a secret to a log, an error or a URL. Read them first." >&2
  echo "To commit anyway: git commit --no-verify" >&2
  exit 1
fi
```

Make it executable with `chmod +x .git/hooks/pre-commit`. It needs `jq`.

- **It runs live.** A new diff has no recorded answer, so the hook needs a key and the repo's
  consent, and costs about $0.00003 per hunk. Without them, `decide` exits non-zero and this hook
  lets the commit through with a note.
- **It only adds caution.** A kept or undecided hunk sends you to read it. Nothing the hook says
  lets a commit skip a check it would otherwise get.
- **The spend guard still applies.** A very large staged change can exit 4, and the hook then lets
  the commit through. Don't add `--confirm` to a hook.

Pass a diff with `--staged` or `--diff`, not as a saved file. The egress excludes then still keep
secret-shaped files, such as `.env`, out of what is sent.
