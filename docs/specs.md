# Save a question as a spec and test it

A spec is a question set saved in `.system1/specs/<name>.yaml`, with its thresholds, a default
source and examples. This page is the path by hand. In an agent, the `design` skill does the same
steps for you. [concepts.md](concepts.md#specs) says what a spec is for, and
[spec-format.md](spec-format.md) lists every field.

You need a key and the repo's consent only to record answers. Adopting a recipe and checking a
spec offline need neither.

## Adopt a cookbook recipe

The [cookbook](cookbook.md) recipes come with recorded answers. Copy the spec and its fixtures
into your repo:

```sh
git clone --depth 1 https://github.com/garygentry/system1.git ~/src/system1
mkdir -p .system1/specs .system1/fixtures
cp ~/src/system1/cookbook/no-timeout.yaml .system1/specs/
cp -R ~/src/system1/cookbook/fixtures/no-timeout .system1/fixtures/
```

Create `.system1/fixtures` first. Without it, `cp -R` copies the fixture files straight into
`.system1/fixtures/` instead of into `.system1/fixtures/no-timeout/`, and every lookup misses.

If you only want the spec, fetch that one file:

```sh
curl -fsSL -o .system1/specs/no-timeout.yaml \
  https://raw.githubusercontent.com/garygentry/system1/main/cookbook/no-timeout.yaml
```

Then check it. This replays the recorded answers, with no key and no network:

```sh
decide spec check no-timeout --format brief
```

```text
decide spec check: no-timeout PASSED · 6 pass · 0 fail · 0 undecided · 1 captured · replay typesafe/jev-1.13 · $0.000000 measured
  pass  fetch-no-limit  no_timeout=0.97
  pass  python-requests-no-limit  no_timeout=0.98
  pass  fetch-timed-signal  no_timeout=0.02
  pass  client-configured-with-timeout  no_timeout=0.04
  pass  near-miss-calls-a-helper  no_timeout=0.22
  pass  near-miss-no-network  no_timeout=0.03
  CAPTURED  borderline-user-cancel-only  no_timeout=0.86
```

Without the fixtures, `decide spec check no-timeout --live` records fresh answers, at about
$0.00003 per example. Run the spec over your code with:

```sh
decide many --spec no-timeout --format brief
```

The file name is the spec's name. Once the recipe is in your repo it is yours: change the default
`source` glob to fit your layout, and add examples from your own code (see below). If you change a
threshold, change its `why` with it.

## Write a spec from a question that worked

Start from a question you have already run with `--question` or `--questions` and whose answers
you have read, and save it as `.system1/specs/unowned-todo.yaml`. The file stem is the spec's
name: lowercase letters, digits, `.`, `_` and `-`.

```yaml
description: Find TODO comments that name no owner and no ticket, so they don't get lost.
questions:
  unowned_todo:
    type: noul
    instructions: This code has a TODO or FIXME comment that names neither a person nor a ticket.
    criteria:
      true: A TODO or FIXME comment appears here, and it names no person, handle or ticket number.
      false: There is no TODO or FIXME comment here, or every one names a person or a ticket.
keep: ["unowned_todo>=0.5"]
sort: unowned_todo:desc
policy:
  thresholds:
    unowned_todo:
      value: 0.5
      why: Balanced. A wrong keep costs a glance; a wrong drop leaves one TODO unowned.
source: { glob: ["src/**/*.ts"], split: file }
```

- **`questions`** take the same shape as `--questions`. The `ask` skill's
  [question craft](../plugins/system1/skills/ask/references/question-craft.md) has the rules.
- **`keep`** and **`sort`** are the defaults for `decide many --spec`. They use the `--keep` and
  `--sort` syntax.
- **Every threshold gets a `why`.** Write it from what each kind of mistake costs, before you look
  at the scores. See [concepts.md](concepts.md#thresholds-and-undecided).
- **`source`** is optional. Flags given on the command line replace it.

A spec is looked up in the repo's `.system1/specs/`, then in `~/.config/system1/specs/`.
`decide spec list` shows what it finds and where from.

## Add examples with expected answers

Add 4 to 8 examples under `examples:`. Each has an `id`, then either `state` (the text itself) or
`file` (a repo file, `path` or `path:START-END`), and usually an `expect`:

```yaml
examples:
  - id: bare-todo
    state: |
      // TODO: handle the empty list
      export const first = (xs: number[]) => xs[0]
    expect: { unowned_todo: true }
  - id: owned-todo
    state: |
      // TODO(ana): handle the empty list, see #412
      export const first = (xs: number[]) => xs[0]
    expect: { unowned_todo: false }
  - id: no-todo
    file: src/util.ts:1-20
    expect: { unowned_todo: false }
  - id: borderline-todo-in-string
    state: |
      export const help = "Write TODO: in a comment to mark unfinished work"
```

Cover a clear yes, a clear no, and at least one near miss: something that looks like a match but
isn't. Leave `expect` off a borderline case. Its answer is captured for you to read, and it never
fails the check.

What `expect` takes:

| Question type | `expect` value | Passes when |
|---|---|---|
| `noul` | `true` or `false` | the probability is on that side of 0.5 |
| `choice` | an option key | that option wins |
| `score` | a level, or `[lo, hi]` | the weighted mean rounds to the level, or lies in the range |
| any | a filter such as `">=0.7"` or `"in a,b"` | the `--keep` filter matches |
| any | `undecided` | the answer is too flat to act on |

An example `file` must be inside the repo. A spec that is committed can't read, and send, anything
else.

## Validate, record, then check offline

1. Validate the file. It lists every problem at once, including example files that don't exist:

   ```sh
   decide spec validate unowned-todo --format brief
   ```

   With no name, it validates every spec it finds.

2. Record answers for the examples. This is live: it needs a key and the repo's consent, and goes
   through the same spend guard as `many`.

   ```sh
   decide spec check unowned-todo --live --format brief
   ```

   The answers are saved in `.system1/fixtures/<name>/`, one file per example.

3. Read the answers, not only the verdict. A `pass` on a 0.6 `noul`, or a `choice` split 0.5 and
   0.45, is a warning. Anything short of a pass also prints the full distributions.

4. Check offline. `spec check` replays by default:

   ```sh
   decide spec check unowned-todo --format brief
   ```

A mismatch is a finding, not an error. The exit code is 0, the headline says `FAILED`, and
`passed` is `false` in the JSON. The check passes only when no example fails, comes back
undecided against an `expect`, or is withheld. Any example with no recorded answer is
`replay-miss`, exit 6. To use the check as a gate, see [ci-and-scripts.md](ci-and-scripts.md).

## Commit the fixtures, and what not to commit

Commit the spec and its `.system1/fixtures/<name>/` directory together. The fixtures make
`decide spec check <name>` a regression test that anyone can run without a key.

**A fixture holds the exact text that was sent.** Committing one publishes that text to everyone
with the repo. Read the files first, as you would any test fixture, especially for examples that
point at a real `file`.

Before you commit, clear `.system1/fixtures/<name>/` and record once more, so that only the
answers for the current wording are kept. Answers for an older wording stay behind unused.

Keep these out of git. They are per-machine:

```gitignore
.system1/fixtures/adhoc/
.system1/usage.jsonl
```

`adhoc/` holds answers to one-off questions, and `usage.jsonl` is the spend ledger.
`.system1/config.yaml` holds the repo's consent. Committing it shares that consent with everyone
who clones the repo, which is a team decision; see
[ci-and-scripts.md](ci-and-scripts.md#run-live-in-ci).

## When a spec misbehaves

When an example fails, or real input gets a wrong or undecided answer:

1. Replay what is recorded, and read the distributions: `decide spec check <name> --format brief`.
2. Add the input that misbehaved as a new example.
3. Suspect the question first. Find the literal reading of your words that explains the answer,
   then rewrite the criteria, split the question, or add a way out to a `choice`. Change an
   example only if it really was mislabelled. Don't move a threshold to make examples pass.
4. Record again with `--live`, and repeat until the examples pass for the right reasons.

**Rewording a question invalidates its fixtures.** Answers are keyed by the exact text, questions
and model, so every example misses until you record again. Renaming the spec file does the same,
because the name is also the fixture namespace.

The [`design` skill](../plugins/system1/skills/design/SKILL.md) runs this loop for an agent, and
the `ask` skill's [references](../plugins/system1/skills/ask/references/) cover question craft and
thresholds.
