---
name: ask
description: Load this skill before you read through a file, diff or directory of many items to judge each one yourself. Use it whenever the user asks you to classify, route, triage, label, filter, vet or give a verdict on a batch of items (tickets, reviews, commits, CI failures, log lines, the commands in a script, source files, rows), to pick the best match out of a long list of candidates (one package, file, helper or option out of hundreds), or to check a diff, log or test output against rules or acceptance criteria (is the task done, is this safe to commit), even if they never mention decisions or decide. It hands each item to a fast, calibrated decision model through the `decide` CLI (about 300 ms and $0.00003 per item), which is cheaper and more consistent than reading every item yourself. Not for generating text, counting, arithmetic, dates or exact matching.
---

# Ask the decision model

`decide` sends text to a decision model. The model returns a typed, calibrated answer in about 300 ms, for about $0.00003 a call. It never generates text. It answers **closed** questions over text you point it at:

- **noul:** the probability, from 0 to 1, that a statement is true.
- **choice:** one of the options you name, with the full distribution.
- **score:** a position on levels you describe, counted from 0.

## When to use it

Use it when the answer is a label, a yes/no or a level, and the model only has to read text you can point it at.

- **Screen many items.** Filter or rank files, search hits, log lines, failures or issues by a rule you can say in a sentence. Examples: "which of these files touch billing", or "which of these errors are timeouts".
- **Judge one long piece of text, or give a verdict that gates an action.** Use it when the text is too long to be worth reading, such as a CI log or a big diff. Also use it when a calibrated, recorded verdict matters more than your own impression, such as "is this command destructive" before running it. For example: does this log show a real failure or a flaky one?
- **Check criteria against evidence.** Put one yes/no per criterion into a single call over the evidence (a diff plus the test output, a log, a PR description). For example: "is the task actually done", "did this change add tests".
- **Pick among candidates.** A choice whose options are the candidates, asked over the text that describes the need. For example: which of these files should I edit? Which of these approaches fits the constraint?

Don't use it:

- for generating text, counting, arithmetic, dates, exact string matching, or anything that has to be exact (write code for those);
- for questions that need several documents reasoned together;
- when there are only a handful of items that fit easily in context. Read them.

## How to ask

1. **Write the question before you run anything.** Use `references/question-craft.md` for anything beyond a plain yes/no, and `references/primitives.md` to choose the type.
2. **Decide the threshold before you look at the answers.** See `references/thresholds.md`.
3. **Run it.** `references/recipes.md` has a complete command for each use case. The shapes:

```sh
# one piece of text, one call
decide ask --text '<text>' --question 'name:noul:<statement>' --format brief

# many items, one call each, filtered in the engine
decide many --glob 'src/**/*.ts' --question 'name:noul:<statement>' --keep 'name>=0.7' --format brief

# a richer question set, inline YAML
decide ask --file build.log --format brief --questions '
name:
  type: noul
  instructions: <statement>
  criteria:
    true: <what counts as true>
    false: <what counts as false>
'
```

- **Sources:** `--glob`, `--file path[:L1-L2]`, `--diff <range>`, `--jsonl`, `--text`, `--stdin`.
- **Splitting a source into items:** `--split file|hunk|row|lines:N`.
- **Filtering and ranking** (`many` only): `--keep`, `--sort`, `--limit`.
- **Saved question sets:** `decide spec list --format brief` lists them, and `--spec <name>` uses one. Add a source only when the user names one; the spec's own default source is part of its design.

## Reading the answers

- **The first line** of `brief` output summarises the run: what was kept, undecided and dropped; whether the answers were `live` or a `replay`; and the measured cost. Report it as printed.
- **Undecided** items came back too flat to call either way. **Read them yourself, or show them to the user.** Never count them as kept or dropped.
- **A noul of 0.5** means "can't tell". The model is decisive, so values of 1.0 and 0.0 are common, and they aren't a sign of error.
- **Score levels start at 0.** The score is a weighted mean, so it can fall between levels.
- **An answer that looks wrong usually means the question is badly posed.** Rewrite the question and ask again, rather than overriding the answer in your head.

If the same question will come up again, suggest saving it as a spec with the `design` skill.

## Rules

- **Run `decide` as its own command.** Don't pipe into it, and don't chain it after other commands. Some sandboxes give network access only to commands that start with `decide`. Save the content to a file first and pass `--file`, as the recipes do.
- **Don't invent flags.** `decide schema ask` and `decide schema many` list the real ones, and `decide help` summarises them.
- **Before a large fan-out,** run `decide many … --dry-run` to see the projected cost.
  - A run above the spend guard exits 4, with the projection. Show the user the projection and let them decide. Don't add `--confirm` yourself.
- **On a non-zero exit,** report the one-line error and stop. Retry once at most.
  - Exit 3 means the repo has no egress consent. Tell the user they can run the `setup` skill. **Never run `decide config egress allow` yourself.**
  - Exit 6 means there's no key and no recorded answer. Say that live decisions need a key.
