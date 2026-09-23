# Quality gates and how they are measured

Every gate, the command that runs it, and the bar it holds today. Some run on every push; the rest
spend money or harness tokens and run locally, before a release or when a change touches what they
measure. For the results themselves, dated and with their limits, see
[../evaluation.md](../evaluation.md).

| Gate | Command | Where | Bar |
|---|---|---|---|
| Build, types, lint, tests, generation, validation, notices | `pnpm check` | CI (4 jobs) and locally | all green |
| The shipped artifact | `pnpm release:check` | CI `packed` job and locally | every step `ok` |
| One live call | `pnpm test:live` | local, needs a key | passes; about $0.00003 |
| Harness smoke | `pnpm smoke` | local, Linux | 9 of 9 markers |
| Skill routing | `pnpm eval:routing all --repeat N` | local | per-skill bar below |
| Startup | `pnpm bench:startup` | local | under 150 ms over bare node |
| Calibration | `pnpm exec tsx tools/calibration.ts …` | local, offline | reproduces `docs/calibration.md` |

## Always, offline

`pnpm check` is the CI gate. It runs, in order:

- **`pnpm build`**: `tsc -b`, then the CLI bundle.
- **`pnpm typecheck`**: `tsc -b` plus `tsconfig.tools.json` for `tools/`.
- **`pnpm lint`**: `biome check .`, which also covers formatting.
- **`pnpm test`**: vitest over `packages/*/src/**/*.test.ts` and `tools/**/*.test.ts`, excluding
  `*.live.test.ts` (`vitest.config.ts`). Tests sit beside their source and run offline: the
  transport takes an injected `fetch`, and config tests pass a temporary `home`.
- **`pnpm generate:check`**: generated files match `catalog.yaml` ([deployment.md](deployment.md)).
- **`pnpm validate`**: skill frontmatter, version lockstep, Agent Plugins fields, and
  `claude plugin validate --strict` when `claude` is installed. CI has no `claude`, so that part
  runs only locally.
- **`node tools/notices.mjs --check`**: the CLI's third-party notices are current.

Inside `pnpm test`, a few suites guard things other than engine logic:

- **`tools/docs.test.ts`** keeps the docs honest. `docs/cli.md` must list every command in
  `decide help` and every flag of `ask`, `many`, `spec`, `config`, `usage` and `route`, and carry
  the exit-code table that matches `EXIT` and `BY_CODE`. `docs/troubleshooting.md` must have a
  section per error code (with its exit code) and per doctor check (`DOCTOR_CHECKS`). Every local
  link and anchor in `README.md` and `docs/*.md` must resolve. A new command, flag, code or check
  fails here until it is documented.
- **`tools/cookbook.test.ts`** replays the six recipes in `cookbook/` through `spec check`, from
  their committed fixtures in `cookbook/fixtures/`. Each recipe must say where each threshold comes
  from, and have a clear yes, a clear no and a borderline case with no `expect`; each clear case
  must fall on its side of the threshold.
- **`tools/shim.test.ts`** and **`tools/hooks.test.ts`** run the generated shim and the Claude hook
  command: the npx-cache lookup, that the hook is referenced from the Claude manifest only, passes
  the hint through, and never lets the shim download.
- **`packages/cli/src/main.test.ts`** drives the CLI end to end in process: envelopes, exit codes
  and formats. `packages/cli/src/bundle.test.ts` checks the built bundle.

`pnpm release:check` then exercises the packed tarballs offline; its steps are listed in
[deployment.md](deployment.md#ci).

## Live and local

These spend real money or harness tokens, so CI doesn't run them.

- **`pnpm test:live`** runs `packages/core/src/decide.live.test.ts`: one real call that answers a
  `noul`, a `choice` and a `score`, records the fixture, and replays it identically. It loads this
  repo's `.env` (`vitest.live.config.ts`, the only place a `.env` is read) and skips without a key.
  It builds its own decider with a fixed state, so it doesn't depend on the repo's consent file.
- **`pnpm smoke`** (`tools/smoke/all.sh`) drives real headless Claude, Codex and Pi sessions, and
  skips any harness that isn't installed. Per harness it checks three markers: `setup` ran
  `decide ping`, `setup` ran `decide doctor`, and `ask` ran `decide many --spec smoke` in replay.
  The bar is 9 of 9. It needs GNU `timeout`, and its workdirs live outside the repo, under
  `~/.cache/system1-smoke`, because Codex and Pi read `AGENTS.md` from parent directories.
- **`pnpm eval:routing [claude|codex|pi|all] [--repeat N]`** (`tools/evals/run.ts`) runs each
  prompt in a set through a headless session and records which skills loaded. No decision is made
  (replay, no key). `EVAL_ROUTING=<file>` swaps the prompt set; `EVAL_ROUTE=off` turns the Claude
  hook off for a baseline.
  - **The bar in code, per skill and polarity:** positives may miss at most N times in total over
    N runs (a mean of one miss per run); negatives may never miss. The output shows each unsteady
    prompt's hit rate.
  - **Judge on repeats.** One run can't tell a one-prompt change from noise (six runs of one
    Claude description scored 5 to 7 of 8), so any wording change is judged on `--repeat 3` or
    more. The 0018 acceptance runs used 3 for Codex and Pi and 5 for Claude.
  - **Where it stands** ([ROADMAP known gap 1](../../plans/ROADMAP.md#1-claude-does-not-hand-off-a-review-of-its-own-work-routing-ask),
    [0018 § Results](../../plans/decisions/0018-claude-routing-hook.md#results)): Codex and Pi
    score 100% on positives and negatives on every set (×3). Claude with the hook (×5) scores 40/40
    on `routing.yaml`, 53/60 on `routing-holdout.yaml` and 73/80 on `routing-holdout-2.yaml`, with
    every negative held. Both held-out sets are **2 misses over the ≤ 5-miss bar**, and the user
    chose to ship that way.
  - **The guard rail:** a description change must keep Codex and Pi negatives at 100%, or it
    reverts. `routing-holdout-2.yaml` is spent as a blind set; judge the next change on a new
    `routing-holdout-3.yaml`.
- **`pnpm bench:startup [runs]`** (`tools/bench-startup.ts`) takes the median of 15 runs (by
  default) per command and subtracts bare `node -e 0`. `decide version`, `decide help` and
  `decide route --hook` must each stay under 150 ms of overhead, or it exits 1. `config` and
  `many --dry-run` are reported but not gated. Compare the overhead column: absolute times move
  with machine load.

## Evidence

The calibration claim rests on a recorded sweep and labels committed under `evidence/`
([evidence/README.md](../../evidence/README.md) has the procedure and pins). To rerun the scoring,
per corpus, offline and deterministically:

```sh
pnpm exec tsx tools/calibration.ts --run evidence/runs/system1-v1.json --labels evidence/labels/sample-v1.jsonl
pnpm exec tsx tools/calibration.ts --run evidence/runs/jev-poc-v1.json --labels evidence/labels/sample-v1.jsonl
```

Each run reports the labels it could match and drops the rest, since one label file covers both
corpora. Pooled figures are reweighted by the stratum populations in
`evidence/labels/sample-v1.manifest.json`. `tools/calibration.ts` refuses rather than mislead: it
won't draw a curve from too few labels or too few populated buckets. Its logic is covered by
`tools/calibration.test.ts` in `pnpm test`. Re-running the sweep itself is a live
`decide many --record --format json` over the pinned commits and costs a few cents.

The current result, for checkable `noul` propositions only: Brier 0.028 and expected calibration
error 0.054, over two TypeScript repos by one author, with one AI labeller
([docs/calibration.md](../calibration.md)). Subjective questions, `choice` and `score` are
unmeasured, and the second-labeller agreement check is deferred
([known gap 3](../../plans/ROADMAP.md#3-calibrated-is-measured-only-for-checkable-propositions)).
