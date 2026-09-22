# 0015. CLI contract v1: envelope, exit codes, projection syntax

- **Status:** accepted
- **Date:** 2026-09-22
- **Source:** M3. This freezes the draft in the ROADMAP's "CLI contract".

## Envelope

Every command prints exactly one JSON envelope (the `json` format, which is the default):

```json
{"v": 1, "ok": true,  "command": "many", "result": { … }}
{"v": 1, "ok": false, "command": "many", "error": {"code": "budget-exceeded", "message": "…", "details": { … }}}
```

- `v` changes only on a breaking change to the envelope or to a result shape. Adding fields is not breaking.
- `error.code` is one of the engine's `ErrorCode`s (`packages/core/src/errors.ts`), or `error` for a bug. `details` is structured. For example, `budget-exceeded` carries `projection` and `budget`.
- `--format brief` is the agent-facing text: one line per result, undecided items listed separately, and measured and projected figures labelled. `--format jsonl` (`many` only) prints one tagged line per result (`status: kept | undecided | failed`), then one `summary` line.

### `many` result

```
{dryRun, spec?, model, source?, counts: {items, kept, keptTotal, undecided, dropped, failed, skipped},
 kept: [{id, path?, lines?, answers}], undecided: [{…, questions}], failed: [{id, code, message}],
 skipped: {total, byReason, sample}, redactions: {total, items},
 usage (measured), projection (projected), wallClockMs, sampleIds? (dry run)}
```

### `ask` result

```
{spec?, id, path?, lines?, source, model, servedBy, answers, undecided, verdict?, usage, latencyMs,
 skipped, redactions}
```

`verdict` is present only when `keep` is given. It is `kept`, `dropped` or `undecided`.

## Exit codes

| Code | Meaning | Error codes |
|---|---|---|
| 0 | ok. This includes a `many` run where only some items failed; they are listed in `failed` | — |
| 1 | a bug | `error` |
| 2 | usage, config or source problem | `invalid-request`, `state-too-large`, `unknown-model`, `config-error`, `source-error`, `no-key` |
| 3 | egress refused | `egress-refused` |
| 4 | spend guard; the projection is in `details` | `budget-exceeded` |
| 5 | provider failure | `provider-unreachable`, `provider-http`, `malformed-response` |
| 6 | replay miss | `replay-miss` |

When a `many` run fails for every item with the same code, that code is raised for the whole run.

## Projection syntax

- `--keep <question>[.<field>]<op><value>`, repeatable and ANDed.
  - Operators: `>= > <= < = !=` and `in a,b`.
  - The default field is the question type's natural value (`noul`, `choice` or `score`). `confidence` and `probabilities.<key>` are also accepted.
- `--sort <question>[.<field>][:asc|desc]`, descending by default. A choice sorts by confidence.
- `--limit N` and `--fields a,b`.
- **Undecided comes first and is never thresholded.** An item is undecided when any question that `keep` references is undecided, or any question at all when there is no `keep`.

## Consent guard

`decide config egress allow` needs an interactive terminal or `--confirm`. Skills must never pass `--confirm` for the user, because consent is the user's decision (decision 0009).

## Inline questions

`--question name:noul:<text>`, `name:choice:<text>:key=desc|…` and `name:score:<text>:l0|l1|…`. The instruction text cannot contain `:`. Anything richer goes in a spec or in `--input`.
