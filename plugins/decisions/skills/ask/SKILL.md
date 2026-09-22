---
name: ask
description: Screen many files or items with a closed question (yes/no, pick one, or a score) by sending them to a fast decision model through the `decide` CLI, instead of reading them all yourself. Use when the user asks to run a decisions spec, or to find, filter or triage which files or items match a yes/no criterion.
---

# Ask the decision model

`decide` sends each item to a decision model and returns calibrated answers. It is much cheaper and faster than reading every item yourself. Only trust it for closed questions.

## With a named spec

A spec is a saved question set with its own threshold and default files. To see which specs exist:

```sh
decide spec list --format brief
```

To run one over its default files:

```sh
decide many --spec <name> --format brief
```

To point the spec at different files, add `--glob '<pattern>'`.

## Reading the output

- The first line summarises the run. It gives the counts of kept, undecided and dropped items, whether the answers came from a `live` call or a `replay`, and the measured cost.
- `kept:` lists the items that passed the spec's threshold, each with its answer.
- `undecided:` lists items the model could not call either way. Read these yourself, or tell the user about them. Never count them as kept or dropped.

Report the first line **verbatim**, then list the kept items.

## Rules

- If `decide` exits non-zero, report its one-line error and stop. Don't retry more than once. Don't try to fix consent, keys or installation yourself.
- Never run `decide config egress allow`. Granting consent is the user's decision.
