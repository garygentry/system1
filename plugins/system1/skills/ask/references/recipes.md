# Recipes

Each recipe is a complete command. Replace the paths and the wording, and keep the structure. Add `--format brief` to get output meant for reading; the default is JSON.

**Run `decide` as its own command.** Some sandboxes, Codex's among them, give network access only to commands that start with `decide`. There, `something | decide …` or `prep && decide …` runs without network and fails with a DNS or connection error.

So when content needs preparing, these recipes show two blocks. Run the first, then run the second as a separate command. Where piping works, `… | decide … --stdin` is equivalent.

## Screen many items

**Files matching a rule.** One call per file, filtered in the engine:

```sh
decide many --glob 'src/**/*.ts' \
  --question 'no_timeout:noul:The code makes a network request with no timeout or abort signal.' \
  --keep 'no_timeout>=0.5' --format brief
```

**Ranking by relevance to your goal.** Keep a low threshold (see `thresholds.md`), sort, and cap the list:

```sh
decide many --glob 'src/**/*.ts' \
  --question 'relevant:noul:The file contains code that parses or validates command-line flags.' \
  --keep 'relevant>=0.3' --sort relevant --limit 10 --format brief
```

**Lines of output (a log, grep hits, a list).** Use one item per line with `--split row`, or windows of lines with `--split lines:20`. Each kept row shows its text:

```sh
grep -rn 'catch' src > /tmp/hits.txt
```

```sh
decide many --file /tmp/hits.txt --split row \
  --question 'swallowed:noul:The line catches an error and discards it without logging or rethrowing.' \
  --keep 'swallowed>=0.7' --format brief
```

**The hunks of a diff:**

```sh
decide many --diff main --split hunk \
  --question 'behaviour:noul:The hunk changes runtime behaviour, not just formatting, comments or names.' \
  --keep 'behaviour>=0.5' --format brief
```

## Judge one piece of text

```sh
tail -60 test-output.log > /tmp/failure.txt
```

```sh
decide ask --file /tmp/failure.txt --format brief --questions '
failure:
  type: choice
  instructions: What kind of failure this test output shows.
  criteria:
    assertion: A test assertion failed; the code under test returned the wrong value.
    crash: The code threw an unexpected exception or crashed.
    environment: A missing service, a network error, a timeout or the machine ran out of resources.
    none: The output shows no failure.
'
```

## Check criteria against evidence

Send the diff and the test output as one state with `--split join`, and give one noul per criterion, each with explicit criteria. Pass the diff with `--diff`, not as a saved file: that way the excludes still keep secret-shaped files (`.env*`, keys) out of it.

```sh
tail -40 test-output.log > /tmp/test-tail.txt
```

```sh
decide ask --diff HEAD --file /tmp/test-tail.txt --split join --format brief --questions '
tests_added:
  type: noul
  instructions: The diff adds or changes a test that exercises the new behaviour.
  criteria:
    true: A test file in the diff drives the changed code path.
    false: No test changes, or only unrelated tests change.
tests_pass:
  type: noul
  instructions: The test output shows every test passing.
  criteria:
    true: The run ends with all tests passing and no failures reported.
    false: Any failure, error or skipped suite is reported, or there is no test output.
no_debug_left:
  type: noul
  instructions: The diff leaves no debugging code behind.
  criteria:
    true: No added console logging, print statements, commented-out code or TODO markers.
    false: The diff adds any of those.
'
```

Treat any criterion below your threshold, or undecided, as not met, and name it.

## Pick among candidates

The candidates become the options, plus a way out. The text is the need:

```sh
decide ask --text 'Add a --timeout flag that the ask and many commands both accept.' --format brief --questions '
target:
  type: choice
  instructions: Which file is the right place to add the new flag.
  criteria:
    args: packages/cli/src/args.ts, which defines and parses the flags ask and many share.
    main: packages/cli/src/main.ts, which routes commands and prints help.
    decide: packages/cli/src/commands/decide.ts, which runs ask and many.
    none: None of these is the right place.
'
```

A choice can have up to 255 options. With more candidates than that, screen them with a noul first, then pick among the survivors.

## Saved specs

```sh
decide spec list --format brief                  # what exists here
decide many --spec <name> --format brief         # run it over its own default source
decide ask --spec <name> --file path/to/one.ts   # one item
```

## Before a big run

```sh
decide many --glob '**/*.md' --question '…' --dry-run --format brief   # projected cost, no calls
```
