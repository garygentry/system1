# Cookbook: tested question sets

Each recipe is a saved spec: the questions, the threshold and the reason for it, and examples
with recorded answers. Copy one into your repo and it works the same as a spec you wrote
yourself.

Every recipe here is checked in CI. `pnpm test` replays each one's examples offline, adopted the way
[specs.md](specs.md#adopt-a-cookbook-recipe) says, and fails if any example stops passing or a clear
case lands on the wrong side of the recipe's own threshold. The specs are in
[`cookbook/`](../cookbook/), and their recorded answers are in
[`cookbook/fixtures/`](../cookbook/fixtures/).

| Recipe | Use it to | Type | Keeps when | Threshold basis |
|---|---|---|---|---|
| [`no-timeout`](#no-timeout) | screen files for network calls with no time limit | `noul` | `≥ 0.3` | calibration |
| [`swallowed-error`](#swallowed-error) | screen files for errors caught and discarded | `noul` | `≥ 0.3` | calibration |
| [`secret-leak`](#secret-leak) | screen files for secrets written to logs, errors or URLs | `noul` | `≥ 0.3` | calibration, with a caveat |
| [`destructive-command`](#destructive-command) | gate a shell command before an agent runs it | `noul` | `≥ 0.3` (ask first) | calibration |
| [`ci-failure`](#ci-failure) | route a failed CI run | `choice` | a clear `flaky` or `infrastructure` | **unmeasured** |
| [`done-check`](#done-check) | check a diff and test log before reporting "done" | 3 × `noul` | each `≥ 0.7` | calibration |

## Adopt a recipe

Copy the spec and its fixtures into your repo's `.system1/`, then check it offline. The steps are
in [specs.md](specs.md#adopt-a-cookbook-recipe).

## Where the thresholds come from

The `noul` thresholds come from [calibration.md](calibration.md). There, on yes/no questions that
reading the text settles, keeping at `≥ 0.3` gave 88% precision and 97% recall, and keeping at
`≥ 0.7` gave 98% precision and 80% recall. Screening recipes use 0.3, because a miss costs more
than a minute of reading. `done-check` uses 0.7, because the agent acts on it without asking.

That measurement covers two TypeScript repos by one author, labelled by one AI reader. It says
nothing about `choice` or `score` questions. So `ci-failure`'s threshold is **unmeasured**, and
its recipe says so. Each recipe's `meta.threshold_basis` records which case applies, and the test
enforces it.

## Recipes

### no-timeout

Finds code that makes a network call (fetch, axios, requests, a database or RPC client) with no
timeout, deadline or timed abort signal. It judges the calls visible in each file: a file that
calls a helper defined in another file is not flagged, and the helper's own file is.

```sh
decide many --spec no-timeout --format brief                  # default: every .ts/.js/.py file
decide many --spec no-timeout --glob 'server/**/*.ts' --format brief
```

An abort signal that only fires when the user cancels is still flagged, since it doesn't bound
the wait.

### swallowed-error

Finds `catch`, `except` and `.catch` blocks that discard the error without logging, rethrowing,
wrapping or returning it.

```sh
decide many --spec swallowed-error --format brief
```

A deliberate fallback, such as `catch { return {} }` with a comment saying a missing file is
expected, is also flagged (about 0.7 in the examples). At a screening threshold that's the right
trade: read it and move on.

### secret-leak

Finds code that writes a password, API key, token, private key or session cookie into a log line,
console output, an error message or a URL. Sending a secret in a header or body is not flagged,
and neither is a masked value.

```sh
decide many --spec secret-leak --format brief
```

**Caveat:** the model can only tell a value is secret from its name or where it comes from.
Logging a whole config object came back undecided in the examples, because the text can't show
whether the object holds secrets. Read what it keeps, and read what it marks undecided.

### destructive-command

A gate for commands an agent is about to run. It flags commands that delete or overwrite source,
data, databases, cloud resources or git history, or discard uncommitted work. Deleting
regenerable output (`node_modules`, `dist`, caches) is not flagged.

```sh
decide ask --spec destructive-command --text 'git clean -fdx' --format brief
```

**This rule only escalates.** At `≥ 0.3`, the agent asks the user before running the command.
Below it, the agent's usual checks still apply. Never use a low score as a reason to skip a
check. In the examples, `docker system prune -af` came back undecided (0.53), so ask about
those too.

### ci-failure

Sorts the tail of a failed CI log into `regression`, `flaky`, `infrastructure` or `unclear`.

```sh
tail -80 ci.log > /tmp/ci-tail.txt
```

```sh
decide ask --spec ci-failure --file /tmp/ci-tail.txt --allow-outside --format brief
```

`--allow-outside` is needed because the log tail is a file you just wrote outside the repo.
The spec keeps a result only when it is a clear (`confidence ≥ 0.5`) `flaky` or `infrastructure`
call: those are the ones worth an automatic re-run. Everything else, including `unclear` and
undecided, goes to a person. **The threshold is unmeasured**: calibration hasn't been checked for
`choice` questions. The recipe errs toward sending a failure to a person, because re-running a
real regression wastes a run and delays the fix.

### done-check

Before an agent says a change is done, this checks the diff and the test output as one text,
with one verdict each for: a test exercising the change was added, the whole run passed, and no
debugging code was left.

```sh
tail -40 test-output.log > /tmp/test-tail.txt
```

```sh
decide ask --spec done-check --diff HEAD --file /tmp/test-tail.txt --allow-outside --split join --format brief
```

Pass the diff with `--diff`, not a saved file: then the egress excludes still keep secret-shaped
files out of it. Treat any verdict below 0.7, or undecided, as not met, and name it. With no
test output at all, `tests_pass` came back undecided (0.44) in the examples, so run the tests
first.

## Adding a recipe

1. Write `cookbook/<name>.yaml` following the `design` skill. Include clear yeses, clear noes, a
   near miss and at least one borderline example with no `expect`. Set `meta.threshold_basis`
   to `calibration` (noul only) or `unmeasured`.
2. Record: `tsx tools/cookbook.ts record <name>`. This is live: it needs `OPENROUTER_API_KEY` in
   the environment and this repo's egress consent.
3. Read every answer, not only the verdict. If an example fails or is undecided, fix the question,
   not the example or the threshold. A recipe that can't pass for the right reasons is dropped.
4. `pnpm test` replays it, then add it to the table above.
