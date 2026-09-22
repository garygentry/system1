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

`doctor` (added in M4) is a report, not an operation. A failed check is a finding, so the envelope stays `ok` and the exit code is 0. `result.healthy` is false when any check failed, and `result.live` says whether a live decision would be sent. Scripts that need a gate check those fields, or use `ping`, which exits 5 when the endpoint is unreachable.

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

`--question name:noul:<text>`, `name:choice:<text>:key=desc|…` and `name:score:<text>:l0|l1|…`. The instruction text cannot contain `:`. Anything richer goes in `--questions`, a spec, or `--input`.

## Question sets (added in M5, additive)

- **Input:** `--questions <file|-|inline>` on `ask` and `many` reads a question set as YAML or JSON. A value that spans several lines, or starts with `{`, is the question set itself, so stdin stays free for the content being judged. It is the same map as a spec's `questions:`, and a whole spec-shaped document is also accepted (its `questions:` is used). Relative paths resolve against the working directory.
- **Conflicts:** it can't be combined with `--spec` or `--question`, and `--questions -` can't be combined with `--stdin` or `--input -`. Each is exit 2.

## `spec check` (added in M5, additive)

- **Usage:** `decide spec check <name|path> [--live|--replay] [--confirm] [--model <id>]` runs a spec's `examples` and compares each against its `expect`.
- **Modes:** replay is the default; the input schema accepts only `replay` and `record`. `--live` records fresh answers into the spec's fixture namespace, after the same consent and spend-guard checks as `many`.
- **Examples:** each example gives exactly one of `state` or `file`.
  - `state` is text, or a JSON value, which is sent as its JSON text.
  - `file` is `path[:START-END]`. It must be inside the repo, and it goes through the same excludes, scrubbing and size checks as any source.
  - An example whose file is outside the repo, missing, excluded or too large is reported as `withheld`, with a reason, and never sent. The other examples still run.
  - Example problems are reported by `spec validate` and `spec check` only. A spec with a bad example still loads for `ask` and `many`.
- **`expect`**, per question:
  - `true`/`false` for a noul, compared at 0.5;
  - an option key for a choice, compared with the winner;
  - a level, or `[lo, hi]`, for a score, compared with the weighted mean (a level must round to it);
  - the `--keep` shorthand without the question name (`">=0.7"`, `"in a,b"`);
  - `undecided`, meaning the answer should be too flat to act on.
- **Result:** `{spec, file, model, source, passed, counts: {examples, pass, fail, undecided, captured, withheld}, examples: [{id, status, answers, failures?, undecided?, reason?}], usage, skipped}`.
  - `captured` is an example with no `expect`, shown so it can be read.
  - Every example carries its full answers, distributions included.
- **Exit codes:** like `doctor`, a mismatch is a finding. The envelope is `ok`, the exit code is 0, and `passed` is false.
  - Exit 2: a spec with no examples, or an `expect` that doesn't fit its question (`spec validate` reports the same).
  - Exit 6: any example with no recorded answer. The message names `--live`.
- `decide schema spec-check` prints its input schema.

## `--split join` (added in M5, additive)

`join` builds one state from every source, such as a diff plus a test log for a criteria check. Each source is split by file and passed through excludes **first**, so a secret-shaped file is never folded in. Each part is headed by `--- <id> ---`, and the item id is `joined(<n>)`.

## Excerpts for items with no file (added in M5, additive)

A `many` result row with no `path` (e.g. piped `--stdin`), or covering a single line (e.g. `--split row`), carries an `excerpt`: the first 120 characters of its scrubbed text, with whitespace collapsed. `brief` prints it after the answers. Without it, an id like `stdin:12` can't be traced back to the text.

## `doctor` path-version check (added in M5)

When `decide` is on PATH, `doctor` runs it with `version` and warns if it differs from the running version. The probe has a 2 s timeout and kills the process after it. It sets `DECISIONS_NO_NPX=1`, so the plugin shim won't fall back to downloading the package with `npx`. It's a warning, because agents run the one on PATH. The CLI supplies the probe, so the engine itself still spawns only `git` (0014).
