# Output reference

The `result` of each command, for scripts that parse `decide`'s output. The envelope around it
(`v`, `ok`, `command`, `result` or `error`) and the exit codes are in
[cli.md § Output](cli.md#output) and [cli.md § Exit codes](cli.md#exit-codes).

- **There is no published schema for results.** `decide schema` prints the schemas of tool
  **inputs** only. This page is written from the result types in `packages/core/src/tools/`, and
  no test checks it against them.
- **Adding a field isn't a breaking change**, so ignore fields you don't know. A breaking change
  bumps `v`.
- A field marked *optional* is left out, not set to `null`, when it doesn't apply.
- On failure the envelope carries `error`, not `result`, whatever the format. Branch on
  `error.code`.

The examples below are real output, from replaying the [cookbook](cookbook.md)'s `no-timeout`
recipe with no key, pretty-printed.

## Answers

Each answer is keyed by its question's name, in an `answers` object. The `type` says which shape
it has:

| `type` | Fields |
|---|---|
| `noul` | `noul`: the probability, 0 to 1, that the statement holds |
| `choice` | `choice`: the winning option key. `probabilities`: option key → probability. `confidence`: 0 to 1 |
| `score` | `score`: the probability-weighted mean level (it can fall between levels). `probabilities`: level → probability, with the levels as strings (`"0"`, `"1"`, …). `confidence`: 0 to 1. `legend` (optional): level → its criterion text |

```json
{
  "no_timeout": { "type": "noul", "noul": 0.97 },
  "cause": {
    "type": "choice",
    "choice": "flaky",
    "probabilities": { "flaky": 0.99, "unclear": 0, "infrastructure": 0.01, "regression": 0 },
    "confidence": 0.99
  }
}
```

An answer too flat to act on is still returned in full. Its question's name is listed as
undecided beside it (`undecided`, or `questions` in `many`'s undecided list). See
[concepts.md § Thresholds, and undecided](concepts.md#thresholds-and-undecided).

## Shared fields

These objects appear in several results.

**`usage`**: measured spend, from the provider's report. It is zero on a replay or a dry run.

| Field | |
|---|---|
| `input_tokens` | number |
| `output_tokens` | number |
| `cost` | US dollars |
| `reported` | *optional*. `false` when the provider reported no usage for at least one call, so the figures are a lower bound |

**`projection`**: cost worked out before running, from the listed price. Never a measurement.

| Field | |
|---|---|
| `basis` | always `"projected"` |
| `calls` | number of calls the request would make |
| `estimatedInputTokens` | number |
| `projectedUsd` | US dollars |
| `priceAsOf` | the date of the listed price |

**`skipped`**: items withheld before sending.

| Field | |
|---|---|
| `total` | number withheld |
| `byReason` | reason → count. Reasons: `binary`, `too-large`, `gitignored`, `excluded`, `outside-repo` |
| `sample` | up to 5 of them, excluded ones first: `{path, reason, detail?}`. For `excluded`, `detail` is the pattern that matched |

**`redactions`**: `{total, items}`, the number of secret-shaped strings removed before sending,
and how many items they were in.

## `ask`

| Field | |
|---|---|
| `spec` | *optional*. The spec's name, when `--spec` was used |
| `id` | the item's id. For a file, its path, or `path:START-END` for part of one |
| `path` | *optional*. The file, relative to the repo |
| `lines` | *optional*. `{start, end}`, 1-based and inclusive |
| `source` | `live` or `replay` |
| `model` | the model id requested |
| `servedBy` | the model build that answered, e.g. `typesafe/jev-1.13-20260917` |
| `answers` | see [Answers](#answers) |
| `undecided` | names of the answers too flat to act on. Can be empty |
| `verdict` | *optional*, only with `keep` (from `--keep` or the spec): `kept`, `dropped` or `undecided`. `undecided` when any question the filters name is undecided |
| `usage` | see [Shared fields](#shared-fields) |
| `latencyMs` | measured time for the call |
| `skipped` | see [Shared fields](#shared-fields) |
| `redactions` | see [Shared fields](#shared-fields) |

```json
{
  "spec": "no-timeout",
  "id": "src/search.ts",
  "path": "src/search.ts",
  "lines": { "start": 1, "end": 4 },
  "source": "replay",
  "model": "typesafe/jev-1.13",
  "servedBy": "typesafe/jev-1.13-20260917",
  "answers": { "no_timeout": { "type": "noul", "noul": 0.86 } },
  "undecided": [],
  "verdict": "kept",
  "usage": { "input_tokens": 0, "output_tokens": 0, "cost": 0 },
  "latencyMs": 1,
  "skipped": { "total": 0, "byReason": {}, "sample": [] },
  "redactions": { "total": 0, "items": 0 }
}
```

## `many`

| Field | |
|---|---|
| `dryRun` | `true` for `--dry-run`: nothing was sent, and `kept`, `undecided` and `failed` are empty |
| `spec` | *optional*. The spec's name |
| `model` | the model id |
| `source` | *optional*: `live` or `replay`. Absent on a dry run |
| `counts` | `{items, kept, keptTotal, undecided, dropped, failed, skipped}`. `keptTotal` is the number kept before `--limit`; `kept` is the number returned |
| `kept` | result rows that passed every `keep` filter, in `sort` order when there is one |
| `undecided` | result rows too flat to judge, each with `questions`: the names that were undecided |
| `failed` | `{id, code, message}` for each item whose call failed. `code` is an [error code](cli.md#exit-codes) |
| `skipped` | see [Shared fields](#shared-fields) |
| `redactions` | see [Shared fields](#shared-fields) |
| `usage` | measured, across every call. See [Shared fields](#shared-fields) |
| `projection` | the projection made before running. See [Shared fields](#shared-fields) |
| `wallClockMs` | measured time for the whole run |
| `sampleIds` | *optional*, dry run only: the first 5 item ids that would be sent |

Dropped items are counted in `counts.dropped` and not listed.

Only the questions that `keep` and `sort` act on decide whether a row is undecided. With neither,
every question counts.

A **result row** has:

| Field | |
|---|---|
| `id` | the item's id |
| `path` | *optional*. The file, relative to the repo |
| `lines` | *optional*. `{start, end}` |
| `excerpt` | *optional*. The start of the item's text (up to 120 characters, after scrubbing), when the id alone doesn't lead back to it: an item with no file, such as `--text` or `--stdin`, or a single line of a file |
| `undecided` | *optional*. Names of this row's undecided answers. It can appear on a kept row, for a question the filters didn't act on |
| `answers` | see [Answers](#answers). With `--fields`, only those questions |

A run in which some items fail still exits 0, with the failures in `failed`. When every item
fails with the same code, the whole run fails with that code instead.

```json
{
  "spec": "no-timeout",
  "model": "typesafe/jev-1.13",
  "skipped": { "total": 0, "byReason": {}, "sample": [] },
  "redactions": { "total": 0, "items": 0 },
  "projection": {
    "basis": "projected",
    "calls": 4,
    "estimatedInputTokens": 1144,
    "projectedUsd": 4.8048000000000005e-05,
    "priceAsOf": "2026-09-19"
  },
  "dryRun": false,
  "source": "replay",
  "counts": { "items": 4, "kept": 2, "keptTotal": 2, "undecided": 0, "dropped": 2, "failed": 0, "skipped": 0 },
  "kept": [
    {
      "id": "src/forecast.ts",
      "path": "src/forecast.ts",
      "lines": { "start": 1, "end": 5 },
      "answers": { "no_timeout": { "type": "noul", "noul": 0.97 } }
    },
    {
      "id": "src/search.ts",
      "path": "src/search.ts",
      "lines": { "start": 1, "end": 4 },
      "answers": { "no_timeout": { "type": "noul", "noul": 0.86 } }
    }
  ],
  "undecided": [],
  "failed": [],
  "usage": { "input_tokens": 0, "output_tokens": 0, "cost": 0 },
  "wallClockMs": 28
}
```

## `many --format jsonl`

One JSON object per line, with no envelope around them:

1. one line per kept row, then one per undecided row, then one per failed item. Each is the row
   (or the `failed` entry) with a `status` added: `kept`, `undecided` or `failed`;
2. a last line with `"status": "summary"` and `v`, carrying every other field of the `many`
   result: `counts`, `usage`, `projection`, `skipped` and the rest.

Dropped items get no line. A dry run prints only the summary line.

```json
{"status":"kept","id":"src/forecast.ts","path":"src/forecast.ts","lines":{"start":1,"end":5},"answers":{"no_timeout":{"type":"noul","noul":0.97}}}
{"status":"kept","id":"src/search.ts","path":"src/search.ts","lines":{"start":1,"end":4},"answers":{"no_timeout":{"type":"noul","noul":0.86}}}
{"v":1,"status":"summary","spec":"no-timeout","model":"typesafe/jev-1.13","skipped":{"total":0,"byReason":{},"sample":[]},"redactions":{"total":0,"items":0},"projection":{"basis":"projected","calls":4,"estimatedInputTokens":1144,"projectedUsd":0.000048048000000000005,"priceAsOf":"2026-09-19"},"dryRun":false,"source":"replay","counts":{"items":4,"kept":2,"keptTotal":2,"undecided":0,"dropped":2,"failed":0,"skipped":0},"usage":{"input_tokens":0,"output_tokens":0,"cost":0},"wallClockMs":27}
```

When the run fails as a whole, the output is a single error envelope line, the same as in `json`:

```json
{"v":1,"ok":false,"command":"many","error":{"code":"source-error","message":"No such file: .env","details":{"path":".env"}}}
```

Every other command ignores `jsonl` and prints its `json` envelope, except `version`, which prints
the number.

## `spec check`

The envelope's `command` is `spec`.

| Field | |
|---|---|
| `spec` | the spec's name |
| `file` | the spec file's path |
| `model` | the model id |
| `source` | `replay` (the default), or `live` with `--live` |
| `passed` | `true` when no example is `fail`, `undecided` or `withheld` |
| `counts` | `{examples, pass, fail, undecided, captured, withheld}` |
| `examples` | one result per example, in file order |
| `usage` | see [Shared fields](#shared-fields) |
| `skipped` | see [Shared fields](#shared-fields) |

Each example result:

| Field | |
|---|---|
| `id` | the example's id |
| `status` | `pass`: every expectation met. `fail`: at least one decided answer missed. `undecided`: nothing failed, but an expected question was too flat to judge. `captured`: the example has no `expect`. `withheld`: not sent, for the reason in `reason` |
| `answers` | *optional*. Every answer, with its full distribution. Absent when `withheld` |
| `failures` | *optional*. `{question, expected}` for each miss, `expected` as written in the spec |
| `undecided` | *optional*. Names of the expected questions that came back too flat |
| `reason` | *optional*. Why a `withheld` example wasn't sent |

A mismatch is a result (`passed: false`, exit 0, or 7 with `--strict`), not an error. A spec with no examples is
`invalid-request`. In replay, any example with no recorded answer makes the command fail with
`replay-miss`.

```json
{
  "spec": "no-timeout",
  "file": "/work/demo/.system1/specs/no-timeout.yaml",
  "model": "typesafe/jev-1.13",
  "source": "replay",
  "passed": true,
  "counts": { "examples": 7, "pass": 6, "fail": 0, "undecided": 0, "captured": 1, "withheld": 0 },
  "examples": [
    { "id": "fetch-no-limit", "status": "pass", "answers": { "no_timeout": { "type": "noul", "noul": 0.97 } } },
    { "id": "fetch-timed-signal", "status": "pass", "answers": { "no_timeout": { "type": "noul", "noul": 0.02 } } }
  ]
}
```

(Examples cut to two, `usage` and `skipped` left out, and the path shortened.)

## Other commands

**`spec list`**: `{specs: [...]}`, each `{name, origin, file, description?, error?, shadowed?}`.
`origin` is `repo`, `user` or `bundled`. `error` is set when the file doesn't validate. `shadowed`
is `true` when a directory earlier in the lookup has the same name.

**`spec show`**: the spec as loaded: its [fields](spec-format.md#top-level-fields), plus `name`,
`file` and `origin` (`repo`, `user`, `bundled`, or `path` when given as a path).

**`spec validate`**: `{valid: [names], invalid: []}`. When any spec is invalid, the command fails
with `invalid-request`, and `error.details.invalid` lists `{name, error}` for each (when no name
was given).

**`usage`**:

| Field | |
|---|---|
| `basis` | always `"measured"` |
| `calls` | calls logged, live and replayed |
| `liveCalls`, `replayCalls` | the split |
| `input_tokens`, `output_tokens`, `cost` | totals. `reported: false` appears when any logged call had no usage report |
| `ledger` | the ledger file's path |
| `session` | *optional*. The session filtered on |
| `since` | *optional*. The date filtered on, as given |

**`config`**: `{repoRoot, model, endpoint, concurrency, timeoutMs, budget, egress, apiKey, replay,
session, sessionOrigin, profiles, route, files, specDirs, warnings}`. `egress` is
`{consent, exclude, defaultExcludes}`, where `defaultExcludes` is a count. `profiles` lists the
profile in effect for each `id` the config files set, once per `id`; built-ins nobody overrides
aren't repeated. `warnings` lists the keys and values loading
ignored, each prefixed with its file. `apiKey` is a description such as `"absent (replay only)"`, never
the key. `config egress status|allow|deny` gives `{egress: {consent, file, changed?}}`. See
[configuration.md](configuration.md#what-resolved).

**`route`**:

| Field | |
|---|---|
| `enabled` | `false` when routing hints are off |
| `matched` | `true` when a hint would be shown |
| `triggers` | the triggers that fired: `{name, source, text}`. `source` is `builtin` or `config`; `text` is what matched, up to 120 characters |
| `ignoredBy` | *optional*. The ignore pattern that vetoed a match |
| `message` | *optional*, only when `matched`: the hint |
| `files` | `{user?, repo?}`: the config files that were read |

**`doctor`**: `{healthy, live, harness, session, version, node, checks}`. `healthy` is `false`
when any check failed; warnings alone keep it `true`. `live` says whether a live decision would
be sent. `harness` and `session` are `null` outside a harness. Each check is
`{name, status, detail, fix?}`, with `status` `ok`, `warn` or `fail`. Not every check appears
every time: `config` appears only when it fails, `config-keys` only when keys were ignored, and
`path-version` only when `decide` is on
PATH. The checks are described in [troubleshooting.md](troubleshooting.md#doctor-checks).

**`ping`**: `{ok, model, endpoint, probe, keyPresent, latencyMs?, httpStatus?, contextLength?, configError?}`.
`configError` is set when a config file failed to load, so the probe used the environment only.
Except in `brief`, an unreachable endpoint is an error envelope (`provider-unreachable`, exit 5) with
these fields in `error.details`.

**`schema`**: the JSON Schema of the named tool's input.

**`version`**: `{version}` with `--format json`. Without `--format`, `decide version` prints only
the number.
