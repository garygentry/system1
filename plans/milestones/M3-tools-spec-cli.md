# M3 — Tool definitions, spec format, CLI contract

**Status:** done (2026-09-22)
**Goal:** `decide ask` and `decide many` work end to end, live and replayed. They take input by reference, filter results in the engine, and fail with typed errors. The output envelope and exit codes are frozen as a contract ([0015](../decisions/0015-cli-contract-v1.md)).

## Layers

- **`core/tools/`**: definitions that don't depend on any harness. Each one is an input schema (TypeBox), a handler `run(input, ctx)` and a result type. The CLI only turns argv into input and formats the result. A later MCP or Pi adapter reuses these unchanged.
  - `ask`: exactly one item, answered against one question set.
  - `many`: a fan-out over N items. It runs `prepare`, then the budget guard, then the pool (capped by `config.concurrency`), then projection.
  - `usage`: a summary of the ledger.
- **`core/spec/`**: the question-spec format and loader. The durable file format.
- **`core/project/`**: `keep`, `sort`, `limit` and `fields`.
- **`cli/`**:
  - Commands: `ask`, `many`, `usage`, `config [show|egress allow|deny|status]`, `spec list|show|validate`, `schema <tool>`, `ping`, `version`, `help`.
  - Formats: `json`, `jsonl`, `brief`.

## Spec format (`.decisions/specs/<name>.yaml`)

```yaml
description: Which files matter to a stated goal.   # required
questions: { <name>: <choice|score|noul question> } # required, same shape as the wire
keep: ["relevant.noul>=0.7"]                        # optional default projection
sort: relevant.noul:desc                            # optional
policy:                                             # optional; thresholds with a reason each
  thresholds:
    relevant: { value: 0.7, why: "Jev is decisive; 0.7 keeps borderline files out." }
source: { glob: ["src/**/*.ts"], split: file }      # optional default source
examples: [{ id: auth, state: "...", expect: { relevant: true } }]  # optional
provenance: { from: "...", displaces: "..." }       # optional
```

- **Lookup order:** `<repo>/.decisions/specs/`, then `$XDG_CONFIG_HOME/decisions/specs/`, then the specs bundled with the plugin (`DECISIONS_SPECS_PATH`, or the CLI package's `specs/`). A path given directly is always accepted.
- **Name:** the file stem, which is also the fixture namespace.
- **Validation:**
  - questions pass `assertQuestionSet`;
  - `keep` and `sort` parse and name real questions;
  - each threshold has a `why`.

## Projection syntax

- **`--keep <q>[.<field>]<op><value>`**, repeatable (ANDed).
  - Operators: `>= > <= < = !=`, plus `in` with a comma-separated list.
  - The default field is the natural one: `noul` → `noul`, `score` → `score`, `choice` → `choice`. For a choice, `probabilities.<key>` and `confidence` also work.
  - Examples: `relevant>=0.7`, `kind=fix`, `kind in fix,feature`, `risk.score>1`, `kind.probabilities.fix>=0.5`.
- **`--sort <q>[.<field>][:asc|desc]`**, defaulting to descending.
- **`--limit N`** and **`--fields q1,q2`**, which limit the answers shown.
- **Undecided:** an item is undecided when any question that `keep` references (or any question at all, if there is no `keep`) is undecided. It is **listed separately and never kept or dropped by a threshold**.

## Acceptance

- [x] 220 offline tests (up from 159) cover:
  - the spec loader: lookup order, shadowing, loading by path, invalid specs listed rather than hidden;
  - the keep/sort parser and evaluator: undecided routed before any threshold, and only for the questions that are referenced;
  - `ask`, `many` and `usage` against a content-steered fake endpoint: spend guard, consent before any call, partial failures, an all-failed run raised as one error, record→replay, spec defaults;
  - CLI argv mapping, all three formats, each exit code, the consent guard, and `config show` never printing the key.
- [x] **Live run** (repo consent granted by the user, 2026-09-22):
  - `decide many` over `packages/core/src/**/*.ts` with a secret-handling relevance question.
  - Result: 50 items, 6 kept (`exclude.ts`, `scrub.ts`, `prepare.ts`, the egress and prepare tests, `index.ts`), 2 undecided (`tools/many.ts`, which only *calls* `prepare`, and its test) and 42 dropped.
  - Measured **$0.0028, 2.0 s**. Replayed with no key: identical, 169 ms, $0.
- [x] The contract is recorded in [0015](../decisions/0015-cli-contract-v1.md). `pnpm check` passes.

## Found by running it live

- **Upstream sometimes stalls a request, with no response and no error status.** The first live fan-out took 30.9 s:
  - one request of 50 hung until the old 30 s per-attempt timeout, then succeeded on retry;
  - normal calls take 225–650 ms, whatever the state size (106 B → 7 KB measured);
  - the stall is intermittent, and did not recur in eight later runs at widths 4 to 8.
  - **Fix:** the default per-attempt timeout is now 5 s, configurable as `timeoutMs`, so a stall costs one retry instead of the whole run.
  - *Open:* is a timed-out request billed upstream? If stalls turn out to be common, consider hedging, i.e. firing a duplicate after about 1.5 s.
- **Jev is not bit-for-bit deterministic.** The same files moved by ±0.01 between live runs (0.95 → 0.94, 0.87 → 0.86). Tests must never pin exact live values. Replay exists to give exact values.
- **The first glob swept up `.decisions/config.yaml`.** Our own state directory is now always ignored, like `node_modules` and `.git`.
- **Ad-hoc fixtures are gitignored here** (`.decisions/fixtures/adhoc/`). Fixtures under a named spec's namespace are meant to be committed as offline test data. `setup` should suggest the same split (M5).
