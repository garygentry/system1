# Scout: find where a decision model would pay off

`scout` is a skill you run by name: `/system1:scout` in Claude Code, `$system1:scout` in Codex,
`/skill:scout` in Pi. It looks through your code, or your skills, hooks and agent configuration,
for places where a closed judgement (a label, a yes or no, a pick, a score) is made by:

- a **chat model** whose reply is parsed into an enum, a boolean or a number;
- a **keyword list or regex** that encodes a meaning-based rule ("urgent" words, intent patterns);
- a **per-item model loop**: rerankers and graders that ask once per item;
- an **agent** told to read each item and label it, subagents fanned out to classify, a prompt
  hook that answers allow or deny, a grading step with a fixed rubric, or a loop capped at N tries.

Each of these could be handed to a decision model. Scout records the ones it finds in a backlog,
`.system1/opportunities.json`, ready for the next step.

## What it does, and what it costs

1. **It filters locally first, and sends nothing for that.** It leaves out tests, fixtures,
   generated code and anything that already calls a decision model, with `--exclude`.
2. **It projects the cost first.** It runs a dry run and shows what would be sent: the number of
   items, what's left out, and the projected cost. Above the spend guard (200 items or $0.05 by
   default) it waits for your approval; below it, it says what it will cost and goes ahead unless
   you object.
3. **It screens with `decide many`**, one call per file, against a signal table shipped with the
   skill. The code table asks three signal questions and one exclusion, the agents table six
   signals. Recall comes first: a file is kept if any signal reaches 0.3. A file too big for one
   call is reported and re-screened in line windows, and one over 2 MB is reported as not screened.
4. **It reads only the files the screen kept**, and writes up the real opportunities. For each it
   records the evidence, a draft question set, what replacing it would buy (`cost`, `quality` or
   `latency`), and the inputs of a projected saving. `decide` computes the saving itself, and every
   saving is labelled projected.
5. **It reports** the top opportunities by benefit, the measured cost of the sweep, and what wasn't
   screened.

It sends the content of the files it screens to the decision model, so it needs a key and
[egress consent](getting-started.md) for the repo. It only screens content inside the repo.

A sweep of about 200 source files cost $0.013–$0.015 measured, with no prefilter (the M9
pre-check, [evaluation](evaluation.md)).

## The backlog

```sh
decide opportunities list --format brief                     # everything, by projected saving
decide opportunities list --keep benefit=quality --format brief
decide opportunities list --keep status=new --keep 'risk in low,medium'
decide opportunities check                                   # validate the file
```

An entry's id comes from its evidence text, so running scout again updates an entry instead of
duplicating it, and a moved file keeps its id. An entry scout doesn't see again at a path it
re-swept becomes `stale`. A `rejected` entry keeps its reason. The fields are in
[output.md § opportunities](output.md#opportunities), and the commands in
[cli.md § opportunities](cli.md#opportunities).

Commit the backlog if your team wants to share it, or ignore it; `decide` doesn't mind either way.

## Next

Take the best entry, save its question set as a spec with the `design` skill
([specs](specs.md)), and check it against real examples with `decide spec check`. Turning it into
code with a fallback, and measuring it against what it replaces, is what `adopt` and `compare` are
for (planned).
