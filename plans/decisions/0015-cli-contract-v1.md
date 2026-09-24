# 0015. CLI contract v1: envelope, exit codes, projection syntax

- **Status:** accepted. **Extended 2026-09-23** (additive, same envelope `v`): `spec check --strict` opts into exit **7** when an example does not pass. Without the flag, a mismatch is still exit 0 as below. **Extended 2026-09-24 (M9, additive):** `spec lint`, `opportunities`, `--exclude` and the `filtered` skip reason; exit 7 widened to `spec lint` (see the last section).
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

*Amended 2026-09-24:* a terminal gets no further prompt; typing the command there is the decision. `--confirm` is also the documented way for a **user** to grant consent where there is no terminal: Claude Code's `!` prompt has no TTY (verified on 2.1.281), so a user there types `! decide config egress allow --confirm`. Machine-read messages (error envelopes, doctor `fix:` lines) never carry the `!` form, because in a shell a leading `!` runs the command and only inverts its exit status. Without `--by`, the record says which route granted it: `decide config` or `decide config --confirm`.

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

## Egress and input rules (tightened in M6, after the review)

- **Inputs are strict.** Every tool schema refuses unknown properties, and `questions` is a typed union rather than an opaque record. `--input` can no longer carry a field the CLI silently ignores (`{"dryRun": true}` on `ask` used to be accepted and dropped). `decide schema <tool>` therefore describes a valid question.
- **The repo is the boundary.** Every file-backed source resolves symlinks, and content that resolves outside the repo root is withheld (`outside-repo`) unless `--allow-outside` is given. Consent is granted per repo (0009), so a path that leaves it needs saying so.
- **Excludes match the resolved path** as well as the one given, so `innocent.txt -> .env` is withheld.
- **Paths on the command line are relative to the working directory**; a spec's own `source` stays relative to the repo root.
- **A diff section whose path can't be read is withheld**, rather than being sent under the name `unknown`. Git's quoted paths are decoded first.
- **Scrubbing runs on whole documents before splitting**, so a key split across lines or windows is still redacted, and a structured field whose name means a credential (`{"password": …}`) is redacted by name. The decider scrubs the state *and the question set* again before the wire, so a caller using the library directly cannot skip it, and the size limit applies there too.
- **`redactions.items`** counts documents or items that had at least one redaction.

## Unknown usage is not zero (M6)

`usage.reported: false` marks a response where the provider sent no usage, or an unreadable one. The zeroes then mean "unknown", not "free", and `brief` says the total is incomplete. A sum containing one such call is marked the same way.

## Undecided covers what the projection acts on (M6)

An item is undecided when any question that `keep` filters on **or that `sort` ranks by** is undecided; with neither, any question at all. Before this, an item ranked first by an undecided score was kept and reported as decided. Kept rows also carry their own `undecided` list, so a flat answer the projection didn't act on is still visible.

## Spec file format (tightened in M6)

- Unknown keys are refused, so `kepe:` or `exepct:` fails instead of silently becoming no policy.
- `version:` names the spec format (currently 1). A newer one is refused with an upgrade message rather than guessed at.
- `meta:` is the reserved place for anything the engine doesn't read.
- `spec validate` also checks `source.split` and each example's `file`.

## `ask` rejects fan-out flags (added in M6)

`--dry-run`, `--confirm`, `--sort`, `--limit`, `--fields` and `--concurrency` belong to `many`. `ask` is one state and one call, so it exits 2 instead of accepting them silently. Before this, `ask --dry-run` made a real call.

## `--split join` (added in M5, additive)

`join` builds one state from every source, such as a diff plus a test log for a criteria check. Each source is split by file and passed through excludes **first**, so a secret-shaped file is never folded in. Each part is headed by `--- <id> ---`, and the item id is `joined(<n>)`.

## Excerpts for items with no file (added in M5, additive)

A `many` result row with no `path` (e.g. piped `--stdin`), or covering a single line (e.g. `--split row`), carries an `excerpt`: the first 120 characters of its scrubbed text, with whitespace collapsed. `brief` prints it after the answers. Without it, an id like `stdin:12` can't be traced back to the text.

## `doctor` path-version check (added in M5)

When `decide` is on PATH, `doctor` runs it with `version` and warns if it differs from the running version. The probe has a 2 s timeout and kills the process after it. It sets `SYSTEM1_NO_NPX=1`, so the plugin shim won't fall back to downloading the package with `npx`. It's a warning, because agents run the one on PATH. The CLI supplies the probe, so the engine itself still spawns only `git` (0014).

## M9 foundation: `spec lint`, `opportunities`, `--exclude` (added 2026-09-24, additive)

Same envelope `v`: every addition is a new command, a new field or a new enum value. Plan: `milestones/M9-M11-scout-guard-adopt.md` §M9.

- **`--exclude <glob>`** (`ask`, `many`; input field `exclude`), repeatable. Paths matching it are left out and reported in `skipped` with the new reason **`filtered`** and the pattern as `detail`. It is kept apart from `excluded`, which stays the egress safety rule, so withheld secrets stay easy to spot. Patterns are re-anchored like `--glob`, except one that starts with `**/`. An absolute pattern inside the repo is made relative; one outside it, or a `!` negation, is `invalid-request`. Egress excludes run first, so a path both would drop is reported as `excluded`.
- **`decide spec lint [name|path] [--strict]`** (tool `spec-lint`). Offline: no key, no consent, no egress. The result is `{specs: [{name, file, origin, findings, invalid?}], counts: {specs, errors, warnings, invalid}, passed}`; each finding is `{check, severity, question?, message, fix}`. Checks and severities are listed in `docs/cli.md`. Heuristics warn; only a certain problem is an error.
- **Exit 7 widened.** It means "a check ran and did not pass": `spec check --strict` (unchanged), or `spec lint` when there is an error-level finding or an invalid spec (named or not), or with `--strict` any warning. A named spec that doesn't exist stays `invalid-request`, exit 2. As with `spec check`, the envelope stays `ok: true`; the result says why.
- **`spec check` carries `lint`** (the same findings, run first). They are reported only: `passed` and `spec check --strict` still judge the examples alone, so existing CI gates behave as before.
- **`decide opportunities add --file <json> | list | check`** (tools `opportunities-add`, `opportunities-list`, `opportunities-check`): the scout backlog in `.system1/opportunities.json`. Local; nothing is sent.
  - `add` takes a JSON array of candidates, or `{candidates}`, from a file. There is no stdin form, because the Codex `prefix_rule` doesn't cover a pipe into `decide`. It returns `{file, added, updated, staled, total}`.
  - `list` takes the `--keep`/`--sort` grammar over **record fields**, not answers: there is no undecided rule, and field names are checked against the record. It returns `{file, total, matched, basis: "projected", opportunities}`.
  - `check` returns `{file, exists, entries, byStatus}`.
  - A malformed backlog is `invalid-request`, exit 2, listing every problem, and is never repaired or overwritten. `add` and `list` refuse it the same way.
- **`doctor` gains a `backlog` check**: ok when the file is absent or valid, and a warning when it is malformed.

