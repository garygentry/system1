I would hold 0.1.0 for two correctness fixes and narrower claims. The biggest risk is **silently treating an undecided answer as actionable**: `many` can rank it first while reporting zero undecided items. Cost reporting also turns missing measurements into measured zero. Replay isolation and projection labelling generally hold up. This review used offline checks only, with synthetic fixtures under `/tmp/s1-review/`; no repo files were changed.

## Findings

1. **High — An undecided answer can win a ranking without any warning.**

   **Location:** `packages/core/src/project/project.ts:127`, `packages/core/src/tools/many.ts:176`, `packages/cli/src/format.ts:68`.

   Once `--keep` exists, only questions referenced by that filter count toward undecided handling. A different question used by `--sort` can be undecided yet determine which item survives `--limit`. `many` then removes the original uncertainty metadata, and brief output prints the answer without `UNDECIDED`.

   This follows decision 0015’s narrow definition, so the **design contract itself needs correction**, alongside the implementation. It contradicts the README’s unconditional promise.

   **Exact repro:** run the [offline replay reproducer](/tmp/s1-review/honesty/undecided.mjs):

   ```sh
   rtk proxy node /tmp/s1-review/honesty/undecided.mjs
   ```

   It supplies two synthetic fixtures, filters on decided `relevant`, then sorts on `risk` and limits to one. Observed output:

   ```text
   decide many: 1 (of 2) kept of 2 · 0 undecided · 0 dropped · replay typesafe/jev-1.13 · $0.000000 measured · 10 ms
   kept:
     uncertain  relevant=0.90  risk=1.10(0.10)  "uncertain"
   ```

   **Fix:** include sorting questions in uncertainty gating. Preserve all per-question undecided metadata in returned rows and display it regardless of filtering or field selection.

2. **High — Missing provider measurements become “measured” zero; accounting also omits failures.**

   **Location:** `packages/core/src/model/validate.ts:100`, `:140`; `packages/core/src/decide.ts:133`; `packages/core/src/tools/usage.ts:23`.

   Absent usage becomes three zeroes; missing or wrongly typed individual fields also become zero. These values flow into both the ledger and the formatter as measurements. This makes an upstream schema change look like free service.

   **Exact repro, from the repo root:**

   ```sh
   rtk proxy node --input-type=module <<'JS'
   import {parseDecisionResponse} from './packages/core/dist/model/validate.js';
   import {briefAsk} from './packages/cli/dist/format.js';
   const r = parseDecisionResponse(
     {answers:{q:{type:'noul',noul:0.9}}},
     {q:{type:'noul',instructions:'Relevant.'}}, 'typesafe/jev-1.13');
   console.log(JSON.stringify(r.usage));
   console.log(briefAsk({
     id:'demo', source:'live', servedBy:r.model, answers:r.answers,
     undecided:[], usage:r.usage, latencyMs:1,
     skipped:{total:0,byReason:{},sample:[]},
     redactions:{total:0,items:0}
   }));
   JS
   ```

   Observed:

   ```text
   {"input_tokens":0,"output_tokens":0,"cost":0}
   decide ask: demo · live typesafe/jev-1.13 · 1 ms · $0.000000 measured
     q=0.90
   ```

   This injects a response locally; it makes no live call.

   Accounting is additionally limited to successfully validated responses whose fixture recording succeeds: logging happens afterward. Retries do not double-count successful usage, but failed attempts are absent. Whether the provider bills lost or failed responses: **I could not verify this**. `usage` should explicitly state that coverage is incomplete.

   **Fix:** represent unknown usage separately from zero, validate nonnegative measurements, retain available usage independently of answer validation/fixture persistence, and report failed attempts and accounting completeness.

3. **Medium — “Calibrated” is asserted rather than demonstrated; headline cost lacks its input-size condition.**

   **Location:** `README.md:12`, `packages/core/src/model/profiles.ts:43`, `plugins/system1/skills/ask/SKILL.md:8`, `plans/milestones/M5-skills-specs.md:262`.

   The profile sets `calibrated: true`; I found no statistical calibration evaluation. Routing evals measure skill selection, and checking a few spec examples does not establish probability calibration. The floor’s anecdotal adjustment likewise does not establish calibration.

   **Exact repository search:**

   ```sh
   rtk proxy rg -n -i \
     'brier|expected.calibration.error|reliability.diagram' \
     packages/core/src tools
   ```

   Observed: **no output, exit 1**. Together with the inspected evaluation code, this supports “no calibration evaluation found,” not “the model is uncalibrated.” **I could not verify the calibration claim.**

   The cost claim has narrower support: the committed response reports 685 input tokens and `$0.00002877`, matching the profile’s `$0.042/million` input-token price. However, the README’s own example averages `$0.003521 / 57 = $0.00006177` per call. `$0.00003` is plausible for roughly 714 input tokens, not a general per-item price.

   M5 labels its historical runs as measured, appropriately, but supplies abbreviated commands and omits exact inputs for several runs. **I could not verify those historical measurements or reproduce their timings.**

   **Fix:** attribute calibration to the provider until independently evaluated; qualify price by token count; preserve exact commands, inputs, model build, and raw usage for published benchmarks.

## Checked and fine

- Dry-run brief output explicitly says `projected`, includes `price as of 2026-09-19`, and says `no calls made`; it makes no freshness guarantee.
- Replay misses return `replay-miss`, exit 6, without synthesized answers.
- Offline `spec check` correctly reports `source: replay` and zero incremental cost.
- Central uncertainty handling recognizes noul midpoint and choice/score confidence at 0.15.
- The projected call guard accepts 200 and rejects 201; it is a preflight approval threshold, not a hard spending cap.
- Session filtering and `SYSTEM1_SESSION` override passed targeted checks; nested-harness ambiguities are documented.
- Threshold guidance correctly leaves policy to callers and forbids using model confidence to bypass existing review.

## If I were you

Fix uncertainty propagation and unknown-cost representation before publishing the contract. Describe the ledger as observed usage with explicit completeness limits. Sell typed, inexpensive judgments; reserve stronger calibration claims for evidence you can ship. Preserve reproducible benchmark artifacts alongside the attractive numbers.
hook: Stop
hook: Stop Completed
