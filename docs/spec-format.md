# Spec file format

A **spec** is a question set saved as a file, with the policy that reads its answers and examples
that test it. This page describes every field. For the steps to write one and test it, see
[specs.md](specs.md). For how to word the questions, see the `ask` skill's
[question-craft.md](../plugins/system1/skills/ask/references/question-craft.md) and
[thresholds.md](../plugins/system1/skills/ask/references/thresholds.md). A test
(`tools/docs.test.ts`) checks that every top-level field in the code is named on this page.

## Where specs are found

`decide` looks up a spec by name in these directories, in order, and the first match wins:

1. `<repo>/.system1/specs/`
2. `$XDG_CONFIG_HOME/system1/specs/` (`~/.config/system1/specs/`)
3. `SYSTEM1_SPECS_PATH`, when it is set

In each directory it tries `<name>.yaml`, then `<name>.yml`, then `<name>.json`. `decide spec list`
marks a name defined in more than one directory as `shadowed`.

A reference that contains `/`, or ends in `.yaml`, `.yml` or `.json`, is a path instead, relative
to the current directory.

**The name is the file stem.** It must start with a lowercase letter or digit, and use only
lowercase letters, digits, `.`, `_` and `-`. The name is also the spec's fixture namespace
(`.system1/fixtures/<name>/`), so renaming the file leaves its recorded answers behind.

## Top-level fields

| Field | Required | Type | Meaning |
|---|---|---|---|
| `version` | no | whole number ≥ 1 | The spec format. Absent means 1. A newer version than the CLI knows is refused |
| `description` | yes | text | One sentence on what the spec decides and why. `decide spec list` shows it |
| `questions` | yes | mapping | The question set: name → question. See [Questions](#questions) |
| `keep` | no | list of text | The default filters for `many`, and the `verdict` for `ask`. ANDed |
| `keepAny` | no | list of text | Filters of which at least one must match, as well as every `keep`. See [`keep` and `sort`](#keep-and-sort) |
| `sort` | no | text | The default sort for `many` |
| `policy` | no | mapping | `policy.thresholds`: each threshold and the reason for it. See [Thresholds](#thresholds) |
| `source` | no | mapping | The default source and split. See [Source](#source) |
| `examples` | no | list | Test cases for `decide spec check`. See [Examples and expect](#examples-and-expect) |
| `provenance` | no | mapping | Free-form. The engine doesn't read it |
| `meta` | no | mapping | Free-form, for anything a team wants to carry. The engine doesn't read it |

Any other key is an error, so a misspelling such as `kepe:` or `source: {globs: …}` fails instead
of silently dropping the policy. The same holds inside `policy`, a threshold, `source`, an
example and a question (which has only `type`, `instructions` and `criteria`, as with
`--questions`). `provenance` and `meta` are free-form.

A spec can also be written as JSON, with the same fields.

## Questions

`questions` maps each name to one question. Every question has a `type` and non-empty
`instructions`. The `criteria` depend on the type:

| `type` | `criteria` | Rules |
|---|---|---|
| `noul` | optional `{true: <text>, false: <text>}` | Write the instructions as a statement, not a question. When given, both `true` and `false` are required |
| `choice` | `{<key>: <description>, …}` | At least two options. Include a way out, such as `none` or `unclear`. At most 255 options for Jev |
| `score` | `[<level 0>, <level 1>, …]` | At least two levels, lowest first. Levels are counted from 0 |

```yaml
questions:
  risky:
    type: noul
    instructions: This change deletes or overwrites data without a backup.
    criteria:
      true: The change removes or overwrites stored data, and nothing here keeps a copy.
      false: The change keeps all stored data, or keeps a copy before changing it.
  cause:
    type: choice
    instructions: What most likely made this CI job fail.
    criteria:
      regression: A code change broke the behaviour the test checks.
      flaky: The test fails intermittently for reasons unrelated to the change.
      infrastructure: The runner, network or a service outside the code failed.
      unclear: The log doesn't show enough to tell.
  severity:
    type: score
    instructions: How badly this bug affects users.
    criteria:
      - No user sees it.
      - Some users see it, and a workaround exists.
      - Users are blocked, with no workaround.
```

Question names in `keep`, `sort`, `policy.thresholds` and `expect` refer to these keys. The
answers each type returns are in [output.md](output.md#answers).

The same mapping, on its own or inside a spec-shaped file, is what `--questions <file>` accepts.

## `keep` and `sort`

Both use the syntax of the `--keep` and `--sort` flags: see
[cli.md § ask and many](cli.md#ask-and-many).

- `keep`: each entry is `<question>[.<field>]<op><value>`, for example `no_timeout>=0.3`,
  `cause in regression,unclear` or `cause.probabilities.flaky<0.5`. Without a field, the question's
  natural value is used: `noul`, `choice` or `score`.
- `keepAny`: the same syntax. An item is kept when **any** of these matches (and every `keep`
  does), which is how one sweep screens for several signals at once. A flat answer on a `keepAny`
  question makes the item undecided only when it could change the outcome: if another `keepAny`
  filter already matches with a decided answer, the item is kept.
- `sort`: `<question>[.<field>][:asc|desc]`, descending by default. Without a field, a `choice`
  sorts by `confidence` and the others by their natural value.

Each must name a question in the spec. A `--keep` or `--sort` flag on the command line
**replaces** the spec's value; it isn't added to it, and `--keep-any` replaces `keepAny` the same
way. `keep` and `keepAny` also decide `ask`'s `verdict`.

## Thresholds

```yaml
policy:
  thresholds:
    no_timeout:
      value: 0.3
      why: Screening. A missed call can hang production; a false keep costs a minute of reading.
```

`policy.thresholds` maps a name, by convention a question name, to `{value, why}`. `value` is a
number and `why` is required, non-empty text: the reason for the threshold, from what each kind
of mistake costs.

**The engine doesn't apply `policy.thresholds`.** It records the choice and its reason for the
next reader. The filter that runs is `keep`, so write the same value there (`no_timeout>=0.3`),
and change both together. Names under `thresholds` aren't checked against the questions.

## Source

The default source, used when the command gives none. Any source flag on the command line
replaces all of it.

| Field | Type | Meaning |
|---|---|---|
| `glob` | list of patterns | Files to read, as `--glob`. `.gitignore` is honoured in a git repo |
| `file` | text | One file, as `--file`. It takes no `:START-END` range here |
| `jsonl` | text | One item per line, as `--jsonl` |
| `diff` | text | A git diff of this range, as `--diff`. `""` means the working tree against `HEAD` |
| `split` | text | How to split into items: `file` (the default), `hunk`, `row`, `join` or `lines:N[/overlap]`. A `--split` flag replaces it |

Paths are relative to the repo root, wherever `decide` runs from. The fields can be combined,
like the flags.

```yaml
source: { glob: ["**/*.{ts,tsx,js,mjs,cjs,py}"], split: file }
```

## Examples and expect

Examples are what `decide spec check` runs. `ask` and `many` ignore them, so a bad example never
stops a spec from being used.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | A name for the example, unique within the spec |
| `state` | one of these two | The text to judge. A mapping or list is sent as its JSON text |
| `file` | one of these two | A repo file to judge: `path` or `path:START-END` (1-based, inclusive). It must be inside the repo |
| `expect` | no | Question name → expected answer. Without it, the example is `captured`: its answers are shown for reading, and nothing is checked |

`expect` takes, for each question it names:

| Question type | Expectation | Passes when |
|---|---|---|
| `noul` | `true` or `false` | the `noul` is ≥ 0.5 (`true`) or < 0.5 (`false`) |
| `choice` | an option key | the winning option is that key |
| `score` | a level, such as `2` | the `score` rounds to that level |
| `score` | `[lo, hi]` | the `score` lies in the range, inclusive |
| any | a filter, such as `">=0.7"` or `"in a,b"` | the answer meets it, as `--keep` would. It applies to the natural value; it can't name a field |
| any | `undecided` | the answer is too flat to act on |

An expected question that comes back undecided makes the example `undecided`, not `fail`, unless
`undecided` was the expectation. For the result of each example (`pass`, `fail`, `undecided`,
`captured`, `withheld`), see [output.md § spec check](output.md#spec-check).

A `file` example is judged as one item. It is `withheld`, and not sent, when the file is missing,
outside the repo, excluded by the egress rules, or too large.

```yaml
examples:
  - { id: clear-yes, state: "…", expect: { no_timeout: true } }
  - { id: clear-no, file: "src/api.ts:10-40", expect: { no_timeout: false } }
  - { id: borderline, state: "…" }
```

## What validation checks

`decide spec validate [name|path]` reports every problem at once. Loading a spec (for `ask`,
`many` or `spec show`) checks:

- the file is valid YAML (or JSON), with no unknown top-level key and `description` and
  `questions` present;
- `version` is not newer than the CLI;
- every question has a valid `type`, `instructions` and `criteria`;
- `keep`, `sort` and `source.split` parse, and name real questions;
- each threshold has a numeric `value` and a non-empty `why`;
- the file name is a valid spec name.

`spec validate` and `spec check` also check the examples: unique ids, exactly one of `state` or
`file`, and each `expect` against its question (a real option key, a level in range). `spec
validate` also checks that each example `file` exists inside the repo.

Validation checks that a spec *works*. `decide spec lint` checks that it's *well posed*: a
`choice` with no way out, adjective score levels, counting or dates, two questions in one, a
threshold with no `why`. See [cli.md § spec](cli.md#spec).

## A complete example

The `no-timeout` recipe from the [cookbook](cookbook.md), with its examples cut to three. The
full file is [cookbook/no-timeout.yaml](../cookbook/no-timeout.yaml).

```yaml
# The spec's name is its file stem: .system1/specs/no-timeout.yaml → no-timeout.
# No version: the format is 1.
description: Screen source files for outbound network requests made with no time limit, so a hung dependency can't hang the caller.

questions:
  no_timeout:                  # the question's name, used by keep, sort, thresholds and expect
    type: noul                 # a statement, answered with the probability that it holds
    instructions: This code contains a direct call to a network API (such as fetch, http.request, axios, requests, or a database, RPC or socket client method) and that call has no time limit.
    criteria:                  # optional for a noul; sharpens where true ends and false begins
      true: A network API call appears in this text, and nothing here bounds how long it may take (no timeout option, deadline, or abort signal that fires on a timer).
      false: No network API call appears in this text (a call to a function defined in another file is not a network API call, even if that function makes a request), or every network call here has a timeout, a deadline, a timed abort signal, or goes through a client configured here with a timeout.

keep: ["no_timeout>=0.3"]      # the filter that runs; matches policy.thresholds below
sort: no_timeout:desc          # most likely first

policy:
  thresholds:                  # the record of why 0.3; the engine doesn't read it
    no_timeout:
      value: 0.3
      why: Screening. A missed call can hang production; a false keep costs a minute of reading. On checkable I/O questions, docs/calibration.md measured 88% precision and 97% recall at 0.3.

# Used when `decide many --spec no-timeout` is given no source flag.
source: { glob: ["**/*.{ts,tsx,js,mjs,cjs,py}"], split: file }

meta:                          # free-form; the cookbook records where the threshold came from
  threshold_basis: calibration

examples:
  - id: fetch-no-limit         # a clear yes
    state: |
      export async function getForecast(city: string) {
        const res = await fetch(`https://api.weather.test/v1?q=${encodeURIComponent(city)}`)
        return res.json()
      }
    expect: { no_timeout: true }
  - id: near-miss-calls-a-helper   # looks like a match, isn't one
    state: |
      import { getForecast } from "./api.js"
      import { formatTemp } from "./format.js"
      const [city = "London"] = process.argv.slice(2)
      const f = await getForecast(city)
      console.log(city, formatTemp(f.tempC))
    expect: { no_timeout: false }
  - id: borderline-user-cancel-only  # no expect: captured, so its answer is shown for reading
    state: |
      export function search(q: string, cancel: AbortController) {
        return fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: cancel.signal })
      }
```
