---
name: compare
description: Measure an adopted decision-model policy against the mechanism it would replace (or an emulated chat-model baseline) over a shadow capture of real inputs, and write up the result honestly, with no winner unless there are labels. Use only when the user explicitly asks to compare, or to measure an adopted spec.
disable-model-invocation: true
---

# Compare a decision model with what it would replace

`decide compare` reads a shadow capture, sends each captured state to the decision model, and compares those answers with a baseline. It reports measured signals:
- cost and latency for each side;
- how decisive the decision model is, and how often it was undecided;
- the baseline's parse rate;
- agreement, by question and by question type.

It writes `.system1/compare/<spec>/report.json`. You read that report and write it up. **Without labels, there is no winner**: agreement shows where the two sides differ, not which one is right.

Argument: the spec's name, and optionally `--baseline emulated` or `emulated:<model>`.

## Before you start

- Run `decide doctor --format brief`. Live calls need a key and this repo's egress consent. Without them you can still dry-run (step 2 sends nothing), so the user sees the projection; then stop and suggest the `setup` skill. Never grant consent yourself.
- **The capture must exist:** `.system1/compare/<spec>/captured.jsonl`. The shadow harness `adopt` generated writes it. If it's missing, ask the user to run the harness. Don't run it yourself: it runs the existing mechanism for real, which may spend money and send data outside system1's checks.
- If doctor's `captured` check warns, git has or would commit raw inputs: the capture, or answers recorded from it. Offer to add `.system1/compare/` to `.gitignore` (and `git rm -r --cached .system1/compare/` if any is already committed). It doesn't block a dry run.

## 1. Pick the baseline

- **`current`** (the default) is the mechanism in place: its answers come from the capture, so no baseline calls are made. Prefer it. It measures the thing that would actually be replaced.
- **`emulated`** asks a chat model (Claude Haiku 4.5 by default) the same questions. That sends the captured states to a second vendor, so this repo must allow that profile first. Run `decide config egress status` to see what's allowed. If it isn't allowed:
  - tell the user that allowing it is their decision, made in a terminal (see "config" in the system1 CLI docs);
  - don't make it for them;
  - offer `current` instead.

## 2. Project, then get the go-ahead

```sh
decide compare <spec> [--baseline …] --dry-run --format brief
```

Show the user:
- the rows that would be sent;
- the invalid lines and withheld states;
- the projected cost for each side.

Above the spend guard, the real run refuses without `--confirm`. Pass `--confirm` only after the user has approved the projection.

## 3. Run it

```sh
decide compare <spec> [--baseline …] --record --format brief
```

`--record` keeps the answers in `.system1/compare/<spec>/fixtures/`, beside the capture, so the report can be rebuilt offline (`--replay`) later at no cost. Those files hold every captured state, so they stay out of git with the capture. If invalid lines are reported, say how many and the first few reasons; those rows aren't compared.

## 4. Write it up

Read `report.json` and report, with numbers and sample sizes:

1. **Cost per call for each side:** Jev's is measured; the `current` side's is what the harness reported.
   - When the baseline's `cost.total` is `null`, its cost is **unknown**, not zero: the capture had no `usage`.
   - When `complete` is `false`, the figure is a lower bound.
   - Replayed answers measure no cost: say so if either side replayed.
2. **Latency** for each side (p50, p95).
3. **Agreement** by question and by type, with `n`.
   - Name the questions where the two sides disagree most, and show a few rows from `disagreements.sample`. The sample shows ids and answers, never states.
   - Jev's undecided answers are counted apart, not as disagreements. Report the undecided share: those rows would take the existing path.
4. **Decisiveness** and, for an emulated baseline, its **parse rate**.
5. **The verdict:**
   - **No labels:** don't name a winner or imply one. Say what the agreement means: where they agree, switching changes little; where they differ, someone has to look.
   - **Labels:** report accuracy for each side with its `n` and `unanswered`, and the head-to-head over the answers both gave. `winner` comes only from that head-to-head. Say how many labelled rows it rests on, and treat a small `n` as a lean, not a result.

## 5. Point at what's next

- **Without labels:** suggest labelling. Start with the disagreeing rows, then a random sample of the rest. Each label goes in `.system1/labels/<spec>.jsonl` as `{"id": "<captured id>", "labels": {"<question>": <value>}}`. A label can cover some questions only. The user labels; don't invent labels from the model's answers.
- **Cutover is the user's.** If they want to switch the policy on, both switches are theirs: `enabled` where the app calls it, and the module's `EGRESS` line. The runtime's daily cap and fallback reason codes apply from the first live call. Never make either edit yourself.
