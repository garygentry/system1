# Calibration evidence

The published basis for the calibration claim (M7, `plans/milestones/M7-evidence.md`).
Everything here is committed so the result can be audited and re-derived.

| Path | What it is |
|---|---|
| `questions/code-v1.yaml` | The four `noul` questions swept. Each one's `criteria` is also the labelling rubric. |
| `runs/<corpus>-v1.json` | The recorded sweep: `decide many --record --format json`, **no `--keep`**, every answer. |
| `labels/sample-v1.manifest.json` | Seed, cap, and every stratum's population and sample size. |
| `labels/sample-v1.worksheet.jsonl` | The drawn sample, shuffled, with no model answers. |
| `labels/sample-v1.jsonl` | Labels `{id, question, label, note?}`, the input to `tools/calibration.ts`. |

## Procedure (v1)

1. **Corpora.** This repo and `~/workspace/jev-poc`, each at a pinned commit (see below). Every
   tracked TypeScript file under the globs, split into 40-line excerpts (`--split lines:40`).
   Test code is included, because it is part of what gets screened.
2. **Questions.** Two groups, reported separately:
   - *checkable*: `io`, `errors`. Truth is verifiable from the excerpt alone.
   - *judgement*: `defect`, `standalone`. Closer to real screening use, so the labels are softer.
3. **Sweep.** Every excerpt × every question, recorded in full. The population is every
   `noul` answer in the run, kept and undecided alike.
4. **Sample.** `tools/calibration-sample.ts`, seeded. Stratified by (group, 0.1 probability
   bucket), with up to `cap` pairs per stratum drawn uniformly at random, or the whole
   stratum when it is smaller. Per-bucket frequencies are unbiased. Any pooled figure must
   be reweighted by the stratum populations in the manifest.
5. **Label blind.** Each worksheet item is labelled by reading the excerpt (the file at the
   pinned commit, lines per the id) against the question's rubric, **without seeing the
   model's answer**. Only the excerpt is used, because that is all the model saw.
6. **Agreement check (deferred in v1).** A second labeller independently labels a random 30
   of the sampled pairs, and the agreement rate is reported with the curve. In v1 this was
   deferred: the published labels are single-labeller, and the docs say so. The tooling is
   kept (see "Running the second-labeller check").
7. **Score.** `tsx tools/calibration.ts --run <run> --labels <labels>`, per corpus and per group.

## Pins (v1, recorded 2026-09-23)

| Corpus | Commit | Globs (`--split lines:40`) | Excerpts | Failed |
|---|---|---|---|---|
| system1 | `baf4eb5` | `packages/*/src/**/*.ts`, `tools/*.ts`, `tools/{smoke,evals}/*.ts` | 320 | 1 |
| jev-poc | `3111ae9` | `{src,server,shared,scripts,e2e}/**/*.{ts,tsx}` | 680 | 2 |

- Model `typesafe/jev-1.13`, `source: live`. Measured cost: $0.0142 (system1) + $0.0290 (jev-poc).
- **The 3 failed excerpts** (`tools/calibration-sample.ts:161-198`, `server/transport.ts:121-160`,
  `src/demos/guardrail/demo.ts:121-160`) were refused upstream with a Cloudflare HTTP 403. One
  retry reproduced it, so the block is deterministic and depends on the content, not on any
  answer. They are outside the population.
- Population: 997 excerpts × 4 questions = 3,988 `noul` answers. Sample: seed `20260923`,
  cap 25 per stratum, 478 pairs across 389 excerpts, with all 20 strata populated. The seed and
  cap were fixed before the stratum counts were seen.
- Agreement subset: `labels/agreement-v1.worksheet.jsonl`, 30 pairs drawn from the sample with
  seed `20260924`.

## Labelling rules applied (v1)

Recorded because they decide borderline cases and a second labeller should apply the same ones.

- **io:** counts a call whose evident purpose is file, network or subprocess I/O, directly or
  through a wrapper that does it (`loadConfig`, `prepare`, `runAsk`, `page.goto`, hooks that ask
  on mount), including stubbed or injected fetches. Printing to stdout, `localStorage`, dynamic
  `import()`, and an import that is never called do not count.
- **errors:** counts `throw`, `try/catch`, `.catch`, rejection or `toThrow` assertions, a
  structured failure result (an error envelope, `{code, message}`, a skipped or dropped record
  with a reason), and branching on an operation's error to surface it. A bare
  `null`/`undefined` sentinel, and a `throw` that falls past the excerpt's end, do not count.
- A fact learned from another excerpt (for example that `serverMode()` issues a GET) was applied
  to every excerpt that uses it, including ones already labelled.

## Running the second-labeller check

`agreement/check.template.html` is a blind labelling page. It shows the excerpt, the proposition
and its rubric, and never the model's answer or the first label. Build it for a worksheet with:

```sh
pnpm exec tsx tools/calibration-agreement.ts \
  --worksheet evidence/labels/agreement-v1.worksheet.jsonl \
  --questions evidence/questions/code-v1.yaml \
  --pin system1=.@baf4eb5 --pin jev-poc=../jev-poc@3111ae9 \
  --out agreement-check.html
```

Publish the output as a Claude Artifact with the `db` capability. Answers land in its
`agreement` collection as `{k, id, question, corpus, label, note}`, which is the label JSONL
shape. Read them back, then compare them with `labels/sample-v1.jsonl` by `(id, question)`.
The same tool serves a later round (new questions, a new sample) given a new worksheet. Hand
the second labeller only the rubric, not the rules above, so the check measures the rubric.
