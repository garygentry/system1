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
6. **Agreement check.** A second labeller (the maintainer) independently labels a random 30
   of the sampled pairs. The agreement rate is reported with the curve, since single-labeller
   ground truth for the judgement group is itself a judgement.
7. **Score.** `tsx tools/calibration.ts --run <run> --labels <labels>`, per corpus and per group.

## Pins

Filled in when the sweep is recorded.
