# M7 — Evidence: measure what we claim

**Status:** next (planned 2026-09-23). The decisions below came from interviewing the user.
**Goal:** The load-bearing word in the pitch is "calibrated", and today the README admits nobody has checked it. Replace that with **our own measurement**, published with its scope and its sample sizes, and derive the threshold guidance a newcomer actually needs from it. Close the two things M6 left open while we are in the harnesses anyway.

## First principles

- **The claim is the product.** "Typed, calibrated probabilities" is why someone would use this instead of a chat model. Shipping it to the public on a vendor's assertion is the weakest part of the whole thing.
- **Measure honestly or not at all.** A curve built from a biased sample is worse than no curve, because it launders a guess into a number. The sampling rule below is the most important paragraph in this document.
- **Scope the claim narrowly and say so loudly.** Two repos and a handful of question shapes is what we will have. That supports "here is what we measured", never "Jev is calibrated".
- **This is not `calibrate`.** The user-facing command is a post-release feature. M7 produces a script, a labelled set and a document.

## Decisions (interview, 2026-09-23)

| # | Question | Decision |
|---|---|---|
| D1 | What bar is the release clearing? | **Design partners first** — 3–5 real users on real repos (M9), then decide about anything wider. The dominant risk is that nobody outside this machine has used it. |
| D2 | What happens to `scout`, `adopt`, `compare`, `calibrate`, `guard`? | **Cut until after release.** None makes the core more trustworthy. The *measurement* idea is borrowed from `calibrate` here as evidence, without shipping the command. `scout`'s detailed plan is parked at `plans/later-scout-opportunities.md`. |
| D3 | How far do we go on the calibration claim? | **Measure it and publish the curve**, with scope caveats and n per bucket, and turn it into threshold guidance. |
| D4 | What about being single-model, single-vendor? | **Accept and document** (README statement lands in M8). A second profile waits for a second suitable model to exist. |
| D5 | What if the measured curve is bad? | **Publish it, and treat bad calibration as a release blocker** — do not proceed to design partners (M9) until it is understood or improved. The **bar for "bad" is set after seeing the curve**, not now: the pre-commitment is on the *consequence* (a blocker, not a caveat), while the trigger stays a judgement call on real data. Residual risk, accepted knowingly: the "is it bad?" call still happens post-hoc, so a future session must not quietly harden this into a fixed numeric threshold to make the release easier. |

## Scope

### 1. A labelled set, sampled without bias

**The trap, stated first.** If we label the items the model was confident about, or the survivors of a `--keep` filter, the curve is meaningless. Labels must come from a **random sample of everything screened**, including the items the model scored 0.2 and the ones it called undecided.

**Procedure:**

1. Run a sweep over a corpus with a question set, recording every answer (not just survivors) — `--record`, full output, no `--keep`.
2. Draw a random sample of the run, stratified so every predicted-probability bucket has enough rows to say anything about.
3. Label each sampled item **by reading it, before looking at the model's answer**. The label is the ground truth, so the order matters.
4. Store labels as JSONL next to the run.

**Corpora:** this repo, and `~/workspace/jev-poc`. Both are ours, which keeps the egress and licensing questions simple. It also bounds the claim: two TypeScript repos, written by one person.

**Size:** target ~200–300 labelled items. **This is the expensive part of M7** — realistically several hours of reading — and it is the item most likely to blow the estimate. If it has to shrink, shrink the number of question shapes, not the number of items per bucket; a curve with four solid buckets beats one with twelve empty ones.

**Where labels live:** committed to the repo under `evidence/labels/*.jsonl`, because they are the published basis for a public claim and have to be auditable. They hold excerpts of our own code only.

### 2. The scoring script

`tools/calibration.ts` (a script, not a shipped command — D2). It reads a recorded run plus its labels and reports:

- **Reliability by bucket:** predicted range, observed frequency, n, and an interval wide enough to be honest at small n.
- **Where the undecided floor sits.** `UNDECIDED_FLOOR = 0.15` was inherited. The data can say whether items below it are genuinely unjudgeable, and whether the floor is in the right place.
- **Per question shape.** `noul` first — a yes/no with binary ground truth is the cleanest thing to measure. `choice` and `score` follow if the labelled set supports them; if it does not, say so rather than reporting a thin number.

Offline, deterministic, tested. It must refuse to produce a curve from a sample it considers too small or too skewed, rather than printing one with a caveat nobody reads.

**Status (2026-09-23): built and tested**, ahead of the labelled set because it was the unblocked long pole. `tools/calibration.ts` + `tools/calibration.test.ts` (26 tests). It reads a `many --format json` run — merging `kept` and `undecided`, so the ≈0.5 items are scored — joins `noul` labels from JSONL, and reports reliability by 0.1-bucket with Wilson 95% intervals plus the undecided-band frequency. It refuses (no curve, exit 1) below **30** labelled pairs, under **3** buckets of ≥5, or when one bucket holds >**70%** of pairs; those constants are exported so `docs/calibration.md` can cite them. `choice`/`score` need a different (non-boolean) label shape and are counted-but-unmeasured this pass. The label JSONL schema is now fixed: `{id, question, label: bool, note?}`, joined to run rows by `id`.

### 3. `docs/calibration.md`

The published result. It carries, in this order: what was measured, **on what corpora and what shapes**, the curve with n per bucket, what it does *not* support, and the threshold guidance that follows from it.

The guidance is the part a newcomer uses: which threshold for screening where a miss is cheap, which before acting unattended, and what to do with undecided. Today the honest answer to "what threshold should I use?" is "pick one" — this is what replaces that.

### 4. README: stop repeating the vendor

The current sentence ("the provider describes these probabilities as calibrated; nothing here measures that independently") gets replaced by what we measured, its scope, and a link — **keeping the same honesty**. If the measurement disagrees with the vendor, the measurement is what ships.

### 5. Close M6's open box: a live decision per harness

One live decision through the **`ask` skill** — not the CLI directly — in Claude, Codex and Pi, from the published artifacts, with cost recorded. Blocked on release night by the Codex/Pi usage limit. Grouped here because it needs real harness sessions, as does §6.

### 6. One bounded retry at the Claude routing gap

Fresh eyes on the 6/8, as described under Known gaps in the ROADMAP. **One attempt, with the guard rail that broke it last time as a hard acceptance condition: Codex and Pi `ask` negatives stay 8/8, or the change reverts.** If it fails again, stop pulling this lever and let the hook close it post-release.

## Out of scope

- `decide calibrate` as a user-facing command, and every other cut feature (D2).
- Any claim about Jev beyond the corpora measured.
- A second model profile (D4).
- Docs, cookbook, macOS and CI matrix — those are M8.

## Open, to settle while building

- **Which question shapes the labelled set can actually support.** `noul` is certain; `choice` and `score` depend on how the sample falls.
- **Whether jev-poc's recorded fixtures already carry usable ground truth** — *checked 2026-09-23: no.* `~/workspace/jev-poc/fixtures/*.json` record only *predicted* answers (Jev `noul`/`choice`/`score`, plus a Haiku baseline and a Jev-vs-baseline `agree` flag); there is no `label`/`truth`/`expected` field anywhere (grep clean). Scenario **names** encode the demo author's intended answer (`sound`/`stub`/`untested`; `clean`/`harassment`/`threat`), so truth is *derivable by reading*, but (a) it still needs hand-labelling and (b) these are curated demo cases, not a random sweep of real content, so using them as-is would violate §1's sampling rule. Net: they can't replace the unbiased labelled set; at most they're a legible, quick-to-label supplement **if** the curation caveat is documented. Labelling is therefore closer to the "day of reading" end, not "hours".
- **How to present intervals at small n** without implying more precision than 30 rows can carry.
- **What to do if the curve is bad.** *Settled 2026-09-23 (D5): publish it, and treat bad calibration as an M9 release blocker; the bar for "bad" is judged after seeing the curve, not fixed now.* The response is the pre-commitment; the trigger stays a judgement call — see D5 for the residual-risk caveat.

## Results (2026-09-23)

- **Checkable group (`io`, `errors`):** 246 pairs. The curve is monotone and near-diagonal: population-weighted Brier 0.028 (base rate 0.187), ECE 0.054, 97% accurate at 0.5. The one pattern is mild under-confidence between 0.6 and 0.8.
- **Judgement group (`defect`, `standalone`):** the single-labeller labels are degenerate (defect true in 1 of 108, standalone true in 124 of 124). They measure the labeller's reading of the rubric, not the model. **User decision:** publish checkable only, and report judgement as unmeasured with that reason.
- **D5 verdict (user):** the checkable curve is **not bad**, so M9 is not blocked.
- **Still open:** the maintainer's 30-item agreement pass (`evidence/labels/agreement-v1.worksheet.jsonl`, via the "Second-labeller check" artifact), §5 (a live `ask` in each harness) and §6 (the routing retry).

## Acceptance

- [x] A labelled set of ~200–300 items exists under `evidence/labels/`, drawn by the documented unbiased procedure, with the procedure recorded alongside it. *(2026-09-23: 478 pairs, all 20 strata populated; procedure, seeds, pins and labelling rules in `evidence/README.md`.)*
- [x] `tools/calibration.ts` is tested, deterministic and offline, and refuses to report a curve from a sample too small or too skewed. *(2026-09-23: built, 26 tests; verified against synthetic fixtures. Awaits the real labelled run.)*
- [x] `docs/calibration.md` publishes the curve with n per bucket, names its corpora and shapes, and states plainly what it does not support. *(Label-agreement figure pending the maintainer's 30-item pass.)*
- [x] Threshold guidance in the docs is derived from that data, not from taste. *(Weighted precision and recall by threshold.)*
- [x] The README no longer rests the central claim on the provider's assertion.
- [x] A finding about `UNDECIDED_FLOOR` is recorded, whether or not it moves. *(It stays: the band came true 53% of the time, weighted; see the docs.)*
- [ ] One live decision through the `ask` skill in each of Claude, Codex and Pi, with costs recorded — M6's last open box.
- [ ] The routing retry has been attempted once and its outcome recorded, with Codex/Pi negatives still 8/8.
- [ ] `pnpm check` green.
