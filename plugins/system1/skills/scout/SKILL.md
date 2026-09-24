---
name: scout
description: Find the places in a codebase, or in a set of skills, hooks and agent configuration, where a chat-model call, a hand-written keyword rule or an agent fan-out makes a closed judgement a decision model could make, and record them as a ranked backlog with projected savings. Use only when the user explicitly asks to scout, or to find decision-model opportunities.
disable-model-invocation: true
---

# Scout for decisions worth handing over

Scout screens a target with `decide many`, reads only what the screen keeps, and records each real opportunity in `.system1/opportunities.json` with `decide opportunities add`. It never reads every file itself, and it never measures a saving. Every figure it writes is **projected**, and the backlog shows its inputs.

Arguments, all optional: a target (a path, `skills`, `plugins` or `agents`) and `--depth quick|full` (default `full`).

## Before you start

- Run `decide doctor --format brief`. Scouting sends the content of the files it screens to the decision model, so it needs a key and **egress consent for this repo**. If consent is missing, tell the user and stop. Granting it is theirs to do; never run `decide config egress allow` yourself.
- **Stay inside the repo.** Only screen content inside this repo. Content outside it, such as installed plugins or a home-directory agent config, needs the user to name it in this conversation. Even then, never add `--allow-outside` yourself: suggest the user copies it into a scratch repo, or ask them to confirm, and say what would leave the machine.

## 1. Pick the mode and the table

| Target | Mode | Signal table (in this skill's `references/`) |
|---|---|---|
| source code (default: the repo) | `code` | `signals-code.yaml` |
| skills, agent definitions, hooks, workflow or prompt files | `agents` | `signals-agents.yaml` |

Pass the table's **full path** to `--spec`. Each table screens for several signals in one pass (`keepAny`) and drops what it is confident is not an opportunity (`keep`).

## 2. Prefilter locally (sends nothing)

Everything you leave out here costs nothing and can't become a false positive.

- **By path**, with `--exclude` (repeatable): tests, fixtures, mocks, eval harnesses, generated and vendored code, build output. For example `--exclude '**/*.test.*' --exclude '**/__tests__/**' --exclude '**/fixtures/**' --exclude '**/dist/**'`. Adjust these to the repo's own layout.
- **Code that already uses a decision model.** Search the target for `@garygentry/system1`, `decide ask`, `decide many`, `/api/alpha/decisions` and `typesafe/jev`. Also find the files that call a model only *through* those modules (they import them), and exclude both. A per-file question can't see a call made in another file.

## 3. Project, then get the user's go-ahead

Run the sweep with `--dry-run` first and show the user what it would send: the number of items, the files withheld or left out, and the projected cost.

```sh
decide many --spec <path>/references/signals-code.yaml --glob '<target>/**/*.{ts,tsx,js,py}' \
  --exclude '…' --dry-run --format brief
```

Over 200 items or $0.05, `decide` stops at this projection. Pass `--confirm` only after the user has approved the projected cost. Below that, say what it will cost and go ahead unless they object.

## 4. Screen

Run the same command without `--dry-run`.

- **`--depth quick`**: add `--keep-any` with a tighter cut (`>=0.5`) on each of the table's signals. `full` uses the table's own recall-first threshold (`>=0.3`).
- **Failed items** (a provider error): re-run them once, with `--file` for each, before you report them.
- **Oversize files** (`state-too-large`, or skipped as `too-large`): re-run them with `--split lines:400/40`. Never drop them silently. Large modules are where model calls tend to hide.
- **Undecided items** are listed apart. Read them as you read survivors.

## 5. Read the survivors, and only those

For each kept or undecided file, read the lines that triggered it and decide which of these it is:

- **A real opportunity.** A closed judgement (a label, a yes or no, a pick, a score) that a decision model could make, done today by a chat model, a keyword rule or a per-item agent step.
- **Correct but intentional.** For example a chat-model or keyword *baseline* kept on purpose for comparison. Record it as `rejected`, with the reason.
- **A false positive.** Don't record it. Count it for the report.

For each real opportunity, prepare a candidate:

| Field | What to put |
|---|---|
| `mode` | `code` or `agents` |
| `location` | `{path, lines: {start, end}}` |
| `mechanism` | what does the job today, in a sentence |
| `shape` | `single` (one verdict), `fanout` (one per item), `cascade` (a cheap gate in front of an expensive call) or `pairwise` (same or different) |
| `benefit` | `cost`, `quality` or `latency`: what replacing it would mainly buy. A free regex replaced by a model is `quality`, not `cost` |
| `evidence` | **a few distinctive lines copied verbatim** from the file. The id is derived from them, so don't paraphrase |
| `questions` | a draft question set, written with the `ask` skill's `question-craft.md` |
| `projected` | `volume` per `per` (a day, a PR, a run), `currentCostPerItemUsd`, `decisionCostPerItemUsd` (about 0.00003 per item for Jev), and a `note` saying where each figure came from. `decide` computes the saving; don't write one |
| `risk` | `{level: low\|medium\|high, note}`: what goes wrong if the replacement errs |
| `next` | usually "save the spec with the design skill, then adopt" |
| `source` | `{sweep: "scout-<date>-<mode>", answers: live\|replay}`, the same sweep id for the whole run |

Estimate `volume` from what the code shows (a loop over tickets, a per-request path) and say so in `note`. If you can't estimate it, use 1 per call and say that.

## 6. Record

Write the candidates as a JSON array to `.system1/scout/candidates-<sweep>.json`, then run:

```sh
decide opportunities add --file .system1/scout/candidates-<sweep>.json --format brief
```

Pass the file with `--file`, never through a pipe. If `add` refuses a candidate, fix it and re-run. It validates everything and repairs nothing.

## 7. Report

Show the user:

1. **The top opportunities, grouped by `benefit`.** Within `cost`, rank by projected saving (`decide opportunities list --keep benefit=cost --format brief`). Within `quality` and `latency`, rank by what the verdict gates and how often. Label every saving **projected**.
2. **What the sweep did:** items screened, left out and withheld, kept, undecided, false positives, and the **measured** cost from the run's `usage`.
3. **Anything that didn't get screened:** failed, oversize or outside-repo items.
4. **Where the backlog is**, and the next step for the best entry: save its question set as a spec with the `design` skill, then `adopt` it.

Don't claim a saving is real. Scout projects it; measuring it is `compare`'s job, after `adopt`.
