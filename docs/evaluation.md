# Evaluation: what we've measured, and what we haven't

This page collects every measurement behind System 1's claims, with its date, its method, its
result and its limits. It includes the results that went badly and the attempts that were
reverted. The numbers are for 0.3.1 unless a row says otherwise, and all of them were taken
between 2026-09-22 and 2026-09-23 on one author's machine.

Two things frame all of it:

- **Nobody outside this project has used System 1 yet.** Every result below comes from the author,
  their two repos and purpose-built fixtures. Design partners (M12, after the `scout`, `guard` and `adopt` milestones) are the next outside step, and they are
  what would show whether any of this holds up for other people.
- **One model, one date.** Every answer quality result is for `typesafe/jev-1.13` as it behaved
  on 2026-09-22 and 2026-09-23.

## Summary

| Question | Result | How sure |
|---|---|---|
| Are `noul` probabilities calibrated on questions that reading the text settles? | Yes, closely: Brier 0.028, calibration error 0.054 | Two TypeScript repos by one author, one AI labeller |
| Are they calibrated on subjective questions? | Unknown | Our labels were too one-sided to test it |
| Are `choice` and `score` calibrated? | Unknown | Not measured |
| Do the cookbook recipes give the answers their examples expect? | Yes, all six, replayed in CI | Small example sets, 6 to 8 each |
| Does a live decision work through the `ask` skill in each harness? | Yes, in Claude Code, Codex and Pi, with the same files kept in each | One prompt per release, on toy repos |
| Does the agent use System 1 when it should, and not when it shouldn't? | Codex and Pi: every time. Claude with the hook: 91% of positives on the blind set, no false triggers | Five runs per set. Claude misses some checks of its own work |
| Does a new user reach a first live decision? | Yes, after six first-run stalls were fixed | The author walked it in each harness on Linux; no outside user yet |
| Does it work on macOS? | The CLI does (CI). The harnesses are unverified | See [known gaps](../plans/ROADMAP.md#5-macos-is-unverified) |

## Answer quality: calibration

The full study is in [calibration.md](calibration.md). In short: we took 40-line excerpts from every
TypeScript file in two repos (997 excerpts), asked four yes/no questions of each, and labelled a
stratified sample of 478 answers blind, without the model's answer in view.

- **Checkable questions** (does this excerpt do I/O; does it raise or handle an error): 246
  labelled pairs. Weighted to the population, Brier 0.028 against 0.187 for a constant guess,
  calibration error 0.054, and 97% accuracy at a 0.5 cut. The one consistent departure is mild
  under-confidence between 0.6 and 0.8, which is the safe direction for a gate.
- **Subjective questions** (does this excerpt contain a defect; can it be understood alone): the
  labels came out degenerate (defect true in 1 of 108, standalone true in 124 of 124). They record
  where one reader draws the line, not ground truth, so no curve is reported.
- **Thresholds.** The 0.3 / 0.5 / 0.7 guidance in the docs and the cookbook comes from this
  sample. For example, keeping at `≥ 0.3` gave 88% precision and 97% recall, and keeping at `≥ 0.7`
  gave 98% precision and 80% recall.

**Limits.** Every label comes from one labeller, an AI agent (Claude), so this is a model graded
against one careful AI reader. A human agreement pass was planned and deferred; the tooling for it
is kept (`tools/calibration-agreement.ts`). Two repos, one author, one language: nothing here says
the curve holds on other code, on prose or on logs. The sweep cost $0.043 measured.

## Cookbook recipes

Each of the six [cookbook](cookbook.md) recipes is a spec with 6 to 8 examples, recorded live once
and replayed in CI. `pnpm test` adopts each recipe into a temporary repo, as the cookbook tells a
user to, and fails if any example fails, comes back undecided, or lands a clear case on the wrong
side of the recipe's own threshold. None was tuned to green. Recording all six cost $0.000982.

What the recordings showed at the edges:

| Recipe | Borderline behaviour worth knowing |
|---|---|
| `no-timeout` | The first wording left a helper-only near miss undecided (0.49). Reworded around a network call visible in the file, it dropped to 0.22 |
| `swallowed-error` | A commented, deliberate fallback scores 0.70: it is flagged, and the recipe says so |
| `secret-leak` | A redacted-prefix near miss scores 0.28, close to the 0.3 line. Logging a whole config object is undecided |
| `destructive-command` | `docker system prune -af` is undecided (0.53) |
| `ci-failure` | A `choice` question, so its threshold is **unmeasured** and the recipe says so |
| `done-check` | With no test output, `tests_pass` is undecided (0.44), which is the intended outcome |

## Live runs in each harness

After each release, one live `ask` ran in each harness from the published packages, on a clean
profile, with a prompt that never names `decide`.

| Release | Repo | Claude Code | Codex | Pi |
|---|---|---|---|---|
| 0.1.0 | 7 files | 2 kept, $0.000423, 863 ms | 2 kept, $0.000418, 591 ms | 2 kept, $0.000425, 1.2 s |
| 0.2.0 | 5 files | 3 kept, $0.000076, 606 ms | 3 kept, $0.000070, 694 ms | 3 kept, $0.000082, 457 ms |

In each release all three harnesses chose `decide many` and kept the same files. Costs are the
decision calls only, as the provider measured them; harness tokens are extra. For 0.3.0, Codex
and Pi repeated the check. Verifying Claude found a bug that no eval had caught: with only the
plugin installed, the routing hook had no CLI to run, so it never hinted. 0.3.1 fixed it, and the
fix was verified on a fresh profile with the marketplace plugin and no global `decide`.

## Routing: does the agent reach for it?

A skill only helps if the agent loads it at the right moments. `pnpm eval:routing` drives real
headless sessions in each harness over a fixture repo with planted defects. Each prompt is written
the way a user would type it and never names the skill. Positives must load `ask` (triage a batch,
check criteria against a diff, pick from a long list). Negatives must not ("count the TODOs",
"rename this function"). There are three prompt sets:

- `routing.yaml`, the tuning set;
- `routing-holdout.yaml`, written blind to the hook, then used to tune the hook's second version;
- `routing-holdout-2.yaml`, written blind and used only to judge.

### What happened

1. **Claude declines to check its own work.** At the 0.1.0 release, Claude loaded `ask` for 6 of 8
   positives against a bar of 7. Codex and Pi scored 8/8. Both misses were criteria checks over a
   small diff Claude had just written. It handed off every batch task.
2. **Five description rewrites didn't fix it.** One reached 7/8 for Claude, but it made Codex and
   Pi trigger on "write a function" and "rename this function" (negatives fell from 8/8 to 5/8), so
   it was reverted. Over-triggering is the worse failure, because it sends code and spends money on
   tasks that need no judgement.
3. **Single runs were measuring noise.** Six Claude runs on the same wording scored 6, 6, 6, 6, 5
   and 7 out of 8. Since then, every change has been judged on the mean of repeated runs
   (`--repeat N`).
4. **A prompt hook, for Claude only** ([decision 0018](../plans/decisions/0018-claude-routing-hook.md)).
   On each prompt, `decide route` matches a few local patterns and adds a one-line hint to use
   `ask`. It sends nothing. Blind negatives also showed that the 0.2.0 skill description made Codex
   and Pi over-trigger on "run npm test" and "commit this", so the description was narrowed too.

### Current results

Claude ran five times per set; Codex and Pi ran three times. The figures are hits summed over all
runs.

| Set | Claude, no hook | Claude, with hook | Codex, old → new description | Pi, old → new description |
|---|---|---|---|---|
| `routing.yaml` | pos 28/40, neg 40/40 | pos 40/40, neg 40/40 | pos 24/24, neg 24/24 | pos 24/24, neg 24/24 |
| `routing-holdout.yaml` | not run | pos 53/60, neg 60/60 | neg 24/36 → 36/36, pos 36/36 | neg 22/36 → 36/36, pos 36/36 |
| `routing-holdout-2.yaml` (blind) | pos 53/80, neg 80/80 | pos 73/80, neg 80/80 | neg 32/48 → 48/48, pos 48/48 | neg 36/48 → 48/48, pos 48/48 |

**What this shows.** No harness now loads the skill for a task that doesn't need it, on any set.
On the blind set, Claude's hit rate on positives went from 66% without the hook to 91% with it.

**What is still open.**

- Claude is two misses over the bar (at most 5 misses) on both held-out sets. It shipped that way
  by the maintainer's choice.
- Most remaining misses are prompts the hook did hint that Claude sometimes ignored. One blind
  prompt matches no pattern, and no pattern was added for it, because that would be tuning on the
  judge set.
- **Disclosed peek:** the hint's wording was made more direct after reading one miss from the
  blind set, so that set can no longer be called fully blind. A new blind set is the next honest
  measurement.
- The hook only sees what the user types. It can't catch Claude deciding by itself to grade its own
  work. A hook that fires when the agent stops (the `guard` `done-check` pack, planned for M10) is the planned fix.

## The first hour

Before 0.2.0, the author walked the first hour in each harness on Linux: a clean profile, a fresh
five-file repo, and four steps (setup with no key; a question with no key; a key but no consent;
then live). It found six stalls, and all six were fixed:

| # | Stall | Fix |
|---|---|---|
| S1 | With no key, the first error was "No recorded answer", not "no key" | The message now leads with the missing key |
| S2 | `doctor` said `healthy` when no live decision could work | The headline now says `SETUP NEEDED (key, consent)` |
| S3 | In the Codex sandbox, `--glob` stalled for 10 s with an unexplained error | The message names the sandbox and the fix |
| S4 | `doctor` printed the wrong credentials path when `XDG_CONFIG_HOME` was set | It prints the resolved path |
| S5 | A refusal read as if the setup skill could grant consent | It says consent is the user's to give |
| S6 | Codex wrote its own question instead of using an adopted recipe | The `ask` skill now checks `decide spec list` first |

No agent tried to grant consent, and nothing reached the provider before consent. CI later
found one more bug on its first macOS run: a repo reached through a symlinked path had every file
withheld. That is fixed and covered by a test.

## Speed and cost

- **Price.** $0.042 per million input tokens, Jev's listed price: about $0.00004 for a 700-token
  item, counting the ~300 tokens the provider adds to every call. The live runs above
  cost $0.00007 to $0.00043 for 5 to 7 files. A 57-file run over this repo cost $0.0035.
- **Latency, end to end.** A 5-to-7-file fan-out took 0.46 to 1.2 s, and the 57-file run 2.6 s.
  An endpoint check (`decide ping`) answered in about 175 ms.
- **CLI startup.** The target is under 150 ms over bare `node`, checked with `pnpm bench:startup`.
  The routing hook adds a `decide route --hook` run to every Claude prompt, and that command is
  held to the same target.

## Scout: does screening find the right things?

Before `scout` was built (2026-09-24), draft signal questions were run through `decide many` over
two repos, one call per file, with no local prefilter:

| Repo | Files | Cost (measured) | Kept | Real | Correct but intentional | False positives |
|---|---|---|---|---|---|---|
| `jev-poc` | 188 | $0.0150 | 38 | 0 | 4 (chat-model and keyword baselines kept for comparison) | 34, nearly all demos that already use a decision model through a shared helper |
| this repo | 197 | $0.0130 | 11 | 1 (the routing hook's regexes) | 2 | 8 |

- **Recall:** every known place in either repo where a chat model or a keyword rule makes such a
  judgement was kept.
- **Precision:** poor without a prefilter, for two reasons that scout now handles locally. A
  per-file question can't see a decision-model call made through another file, and the model
  doesn't see file paths, so it can't tell a fixture from product code.
- **Bias:** both repos are System 1 or Jev code. A repo the questions weren't written against is
  still to come.

The signal tables scout ships are replay-tested in CI: every example passes, and the screen keeps
and drops exactly the examples it should (`tools/signals.test.ts`).

## Not measured

- Calibration on subjective questions, on `choice` and `score`, on languages other than
  TypeScript, and on prose or logs.
- Agreement between two labellers.
- Anyone other than the author installing and using it.
- The harnesses on macOS or Windows.
- Whether a decision leads to a better outcome than the agent reading the files itself: fewer
  missed defects, less context used, less time. No experiment has compared the two yet.

## Rerun it

| What | Command | Needs |
|---|---|---|
| Offline tests, docs checks, cookbook replay | `pnpm check` | nothing |
| One live decision | `pnpm test:live` | a key and this repo's consent |
| Calibration scoring | `pnpm exec tsx tools/calibration.ts --run <run> --labels <labels>` | nothing; the runs and labels are in [`evidence/`](../evidence/README.md) |
| Routing | `pnpm eval:routing all --repeat 3` (`EVAL_ROUTING=tools/evals/routing-holdout-2.yaml` for the blind set) | the three harnesses installed; spends their tokens |
| Harness smoke tests | `pnpm smoke` | the three harnesses installed |
| Startup | `pnpm bench:startup` | nothing |

The history behind each number is in [`plans/ROADMAP.md` § Known gaps](../plans/ROADMAP.md#known-gaps)
and the milestone records in [`plans/milestones/`](../plans/milestones/).
