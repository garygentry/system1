# Keep a large run within budget

At about $0.00003 per 700-token item, one run rarely costs much. A fan-out over a large tree can
still add up. This page projects a run before it starts, narrows it, and reviews what it cost.
Why the guard exists is in [concepts.md](concepts.md#spend).

## Project before you run

Add `--dry-run` to a `decide many` command. It reads and splits the sources, applies the egress
checks, and projects the calls and cost. It sends nothing.

```sh
decide many --spec no-timeout --dry-run --format brief
```

```text
decide many (dry run): would send 2 item(s) to typesafe/jev-1.13 · projected $0.000020 (~487 tokens, price as of 2026-09-19) · no calls made
first: src/a.ts, src/b.ts
```

The projection is an estimate from the listed price, and it's labelled as projected. What was
actually spent comes from the provider's usage report, after the run.

## Narrow the run

Each item is one call, so cost follows the number of items and their size:

- **A tighter source.** `--glob 'server/**/*.ts'` instead of the spec's default, or a few named
  `--file`s. Flags on the command line replace a spec's default source.
- **A coarser split.** `--split file` (the default) makes one call per file. `hunk`, `row` and
  `lines:N` make one per hunk, line or window, so a finer split means more calls.
- **`--limit` does not reduce calls.** It caps how many kept items come back, after every item
  has been judged. Use it to shorten the output, not the bill.

Run `--dry-run` again after each change.

## Change the spend guard

A live run projected over **200 calls or $0.05** stops with `budget-exceeded`, exit 4, before any
call is made. The error's `details.projection` has the figures. Replay is never guarded, since it
costs nothing.

To go ahead once, add `--confirm`. **That is the user's decision, not the agent's**: an agent
should show you the projection and wait. `decide spec check --live` takes `--confirm` too.

To move the guard, set it in `~/.config/system1/config.yaml` or `<repo>/.system1/config.yaml`.
The repo's file wins:

```yaml
budget:
  maxCalls: 500
  maxUsd: 0.10
```

A run is stopped when it goes over either limit. See [configuration.md](configuration.md) for the
other keys.

## Review what was spent

Every live and replayed call is logged to `.system1/usage.jsonl` in the repo. Replays are logged at
zero cost, so the call count stays honest.

```sh
decide usage --format brief                       # everything in this repo's ledger
decide usage --session current --format brief     # this harness session
decide usage --since 2026-09-01 --format brief    # since a date
```

The figures are measured, from the provider's usage report. `--session current` needs a harness
session (Claude Code, Codex or Pi) or `SYSTEM1_SESSION`; outside one, it's an `invalid-request`.
In CI, set `SYSTEM1_SESSION` to the run's id: see
[ci-and-scripts.md](ci-and-scripts.md#run-live-in-ci).
