# Calibration: what we measured

`decide` returns a `noul` as a probability. The provider describes Jev's probabilities as
calibrated. This page reports our own check of that claim, including where it holds, where we
could not measure it, and what threshold to use as a result.

**Short version:** on yes/no questions whose answer you can check by reading the excerpt, Jev's
`noul` tracked the observed frequency closely. We could not measure it on subjective questions.
All of this comes from two TypeScript repos written by one person.

## What was measured

| | |
|---|---|
| Model | `typesafe/jev-1.13`, live, 2026-09-23 |
| Corpora | this repo (`baf4eb5`) and a companion demo app, `jev-poc` (`3111ae9`); both are TypeScript by the same author |
| Unit | 40-line excerpts of every tracked `.ts`/`.tsx` file, tests included: 997 excerpts |
| Questions | 4 `noul` propositions (`evidence/questions/code-v1.yaml`), two per group |
| Population | 3,988 answers, all of them recorded, with no `--keep` filter |
| Sample | 478 pairs, stratified by 0.1 probability band and group, seeded, up to 25 per stratum |
| Labels | read blind against each question's rubric, without the model's answer in view |
| Cost | $0.043 measured for the whole sweep |

The procedure, the seeds, the labelling rules and every label are in [`evidence/`](../evidence/README.md).
Rerun `tools/calibration.ts` over them to reproduce the numbers.

## The curve: checkable propositions

These are the `io` question ("this excerpt performs file, network or subprocess I/O") and the
`errors` question ("this excerpt raises or handles an error"). Reading the excerpt settles both.

| Predicted | n | Observed | 95% interval |
|---|---:|---:|---|
| 0.0–0.1 | 25 | 0% | 0–13% |
| 0.1–0.2 | 25 | 4% | 1–20% |
| 0.2–0.3 | 25 | 12% | 4–30% |
| 0.3–0.4 | 25 | 28% | 14–48% |
| 0.4–0.5 | 21 | 43% | 24–63% |
| 0.5–0.6 | 25 | 60% | 41–77% |
| 0.6–0.7 | 25 | 88% | 70–96% |
| 0.7–0.8 | 25 | 100% | 87–100% |
| 0.8–0.9 | 25 | 92% | 75–98% |
| 0.9–1.0 | 25 | 100% | 87–100% |

Weighted back to the population of 1,994 answers:

- **Brier score:** 0.028. A constant guess at the base rate scores 0.187.
- **Expected calibration error:** 0.054.
- **Accuracy:** 97% at a 0.5 cut.

Each band's observed rate falls within a few points of the band, or its interval covers the
band. The one consistent departure is that answers between 0.6 and 0.8 come true **more** often
than stated. That is under-confidence, which is the safe direction for a gate.

Each question and corpus shows the same pattern.

| Slice | Weighted Brier | ECE |
|---|---:|---:|
| `io` | 0.030 | 0.063 |
| `errors` | 0.026 | 0.067 |
| this repo | 0.052 | 0.082 |
| `jev-poc` | 0.020 | 0.048 |

## What it does not support

- **Subjective questions: not measured.** The other two questions asked whether an excerpt
  "contains a defect" and whether it "can be understood without other files". The single
  labeller marked 1 of 108 sampled defect pairs true and 124 of 124 standalone pairs true,
  whatever the model said. So those labels record where one reader draws the line on a
  judgement call, not ground truth. They cannot show whether the model is calibrated, and we
  report no curve for them. Treat Jev's probabilities on subjective propositions as rankings,
  and set their thresholds on your own data (`decide spec check`).
- **Other code, other people.** Two repos, one author, one language. Nothing here says the curve
  holds on a different codebase, on prose, or on logs.
- **`choice` and `score`.** Not measured. They need a different kind of label.
- **Other models.** This measures one model on one date.

## Which threshold to use

These numbers are for checkable propositions like the two above, from the same weighted sample.

| Keep when `noul ≥` | Share kept | Precision | Recall |
|---|---:|---:|---:|
| 0.2 | 30% | 81% | 99% |
| 0.3 | 28% | 88% | 97% |
| 0.5 | 25% | 95% | 93% |
| 0.7 | 20% | 98% | 80% |
| 0.9 | 13% | 100% | 52% |

- **Screening, where a miss costs more than a false positive:** keep `≥ 0.3`. You read
  about 12% extra and miss about 3%.
- **A balanced default:** `≥ 0.5`.
- **Before acting on its own, unattended:** `≥ 0.7`. About 98% of what passes is true, but one
  true case in five goes unacted on, so leave a path for the rest.
- **Undecided answers** (within 0.075 of 0.5): read them yourself. They came true 53% of the time,
  which is a coin flip, and made up 2% of all answers.

## The undecided floor

`UNDECIDED_FLOOR = 0.15` treats a `noul` within 0.075 of 0.5 as undecided. The data supports
keeping it:

- Items in that band came true 53% of the time, weighted (n = 37). The floor is catching
  genuine coin flips, not hiding answers that lean one way.
- Split by question, the band leans the opposite way for each: `io` 79% (n = 19) and `errors`
  22% (n = 18). The samples are too small to act on, but a per-question floor may be worth a
  look once more data exists.

The floor stays where it is.

## Label reliability

A second labeller (the maintainer) independently labelled 30 randomly chosen sample pairs.
Agreement: **pending.**

<!-- M7: fill in the agreement rate, per group, and any systematic disagreement. -->
