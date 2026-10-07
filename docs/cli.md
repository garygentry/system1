# CLI reference

`decide` is the only way System 1 runs: skills, hooks, CI and scripts all call it. This page is
checked against the code by a test (`tools/docs.test.ts`): every command and flag below exists,
and the exit-code table matches the one `decide` uses. The full contract is decision record
[0015](../plans/decisions/0015-cli-contract-v1.md).

```
decide <command> [options] [--format json|jsonl|brief]
```

- **`--format`**: `json` (the default) prints one JSON envelope. `brief` is text meant for
  reading, and it's what the skills use. `jsonl` (`many` only) prints one line per result, then a
  summary line.
- **`--help`** (`-h`), or `decide help`: the command summary.

## Commands

| Command | Does |
|---|---|
| `decide ask` | One item, one question set, one call |
| `decide many` | One question set over many items, filtered in the engine to what matters |
| `decide spec` | `list`, `show <name>`, `validate [name\|path]`, `lint [name\|path]`, `check <name\|path>` |
| `decide opportunities` | The scout backlog: `add --file`, `list`, `set-status`, `check`. Local; sends nothing |
| `decide compare` | Jev against a baseline (the current mechanism, or an emulated chat model) over a capture, as measured signals |
| `decide usage` | Measured spend from the ledger |
| `decide config` | Show the resolved config; `config egress allow\|deny\|status` for consent, `allow-profile\|deny-profile` for an emulated baseline |
| `decide guard` | Opt-in hook checks: `list`, `status`, `enable <pack>`, `disable <pack>`. The user enables a pack |
| `decide hook` | A guard pack on a harness hook event. Run by the plugin's hooks, not by hand |
| `decide runtime` | One decision for an adopted Python module, which spawns it. Not for agents or by hand |
| `decide route` | Does a prompt call for the ask skill? Local pattern matching; sends nothing |
| `decide schema` | Print the JSON Schema of a tool's input: `ask`, `many`, `usage`, `spec-check`, `spec-lint`, `compare`, `opportunities-add`, `opportunities-list`, `opportunities-check`, `opportunities-set-status`, `route`, `hook`, `runtime` |
| `decide ping` | Check the endpoint is reachable. No key needed, no spend |
| `decide doctor` | Check `decide` works from this shell, with the fix for each problem |
| `decide version` | Print the version |

### `ask` and `many`

**Questions** (give one):

| Flag | |
|---|---|
| `--spec <name\|path>` | a saved spec's questions, source, keep and namespace |
| `--question name:noul:<text>` | an inline statement; repeatable |
| `--question name:choice:<text>:key=desc\|key=desc\|none=None of these` | an inline choice |
| `--question name:score:<text>:level 0\|level 1\|level 2` | an inline score, lowest level first |
| `--questions <file\|-\|inline>` | a question set as YAML or JSON; inline when it spans lines or starts with `{` |
| `--input <file\|->` | the whole tool input as JSON (`decide schema ask`); flags override it |

Inline instruction text can't contain `:`. For anything richer, use `--questions`.

**Sources** (repeatable, combinable):

| Flag | |
|---|---|
| `--glob <pattern>` | files; `.gitignore` honoured in a git repo |
| `--file <path[:START-END]>` | a file, or a 1-based inclusive line range |
| `--jsonl <path>` | one item per line |
| `--diff <range>` | a git diff of a range, e.g. `main...HEAD` |
| `--staged` | the staged changes; on its own, or with `--diff <range>` |
| `--text <text>` | the text itself |
| `--stdin` | piped input |
| `--allow-outside` | read files that resolve outside the repo (withheld otherwise) |
| `--exclude <glob>` | repeatable: leave out paths that match, e.g. `'**/*.test.ts'`. Relative to where you run it, like `--glob`, except a pattern starting with `**/`, which matches anywhere; an absolute path inside the repo works, one outside it or a `!` negation is refused. A symlink is matched by its target too. Glob matches are dropped before they're read. Reported as `filtered`; a path the egress rules would withhold anyway is still reported as `excluded` |

**Split:** `--split file|hunk|row|join|lines:N[/overlap]`. The default is `file`. `join` makes
all sources one item.

**Projection** (`many`; `ask` uses `--keep` and `--keep-any` for its `verdict`):

| Flag | |
|---|---|
| `--keep '<question>[.<field>]<op><value>'` | repeatable, ANDed. Operators: `>= > <= < = !=` and `in a,b`. Fields: the natural value, `confidence`, `probabilities.<key>` |
| `--keep-any '<question>[.<field>]<op><value>'` | repeatable: kept when **any** of these matches, as well as every `--keep`. A flat answer makes an item undecided only if it could change the outcome |
| `--sort <question>[.<field>][:asc\|desc]` | descending by default |
| `--limit <N>` | at most N kept items |
| `--fields <a,b>` | only these questions in each result |

Undecided items are listed apart and never thresholded.

**Run:**

| Flag | |
|---|---|
| `--dry-run` | project calls and cost; send nothing |
| `--confirm` | go ahead past the spend guard (the user's decision) |
| `--live` | require a live call (fails with `no-key` if there's no key) |
| `--record` | live, and save each answer as a fixture |
| `--replay` | answers only from fixtures |
| `--model <id>` | a model other than the default |
| `--concurrency <N>` | simultaneous calls in a fan-out |

### `spec`

```sh
decide spec list
decide spec show <name>
decide spec validate [name|path]
decide spec lint [name|path] [--strict]
decide spec check <name|path> [--live | --replay] [--confirm] [--model <id>] [--strict]
```

`spec check` runs a spec's examples and compares each with its `expect`. Replay is the default.
`--live` records fresh answers, after the same consent and spend checks as `many`. A mismatch is
a finding, not an error: the exit code is 0 and `passed` is false. `--strict` makes that exit 7
instead, so a CI step can gate on the exit code; the output is the same. Any example with no
recorded answer is exit 6.

`spec lint` checks question sets for failure modes you can see in their text, offline: no key,
no consent, nothing sent. With no name it lints every spec in reach. Each finding has a
`severity`, the `check` that raised it, a `message` and a `fix`:

| Check | Severity | Flags |
|---|---|---|
| `no-way-out` | warning | a `choice` with no `none`/`other`/`unclear` option |
| `abstract-levels` | warning | `score` levels of one or two words (`low`, `medium`, `high`) rather than situations |
| `unsupported-task` | warning | counting or arithmetic ("longer than 300 lines"), date arithmetic ("within the last 30 days"), reading images, or an exact fact to read or run ("all tests pass"), which a decision model can't do |
| `merged-question` | warning | two claims in one instruction: two statements, `and/or`, or `either … or`. Framing sentences ("Consider only …", "Answer true if …") don't count |
| `unjustified-threshold` | warning | a numeric `keep` cut (`>=`, `>`, `<=`, `<`) with no `policy.thresholds` entry saying why |
| `unknown-threshold` | error | a `policy.thresholds` entry naming no question in the spec |

The heuristics warn, because a well-posed question can trip one; only a certain problem is an
error. Findings are a result: exit 0 and `passed: true` with warnings only. The lint *fails*, exit
7, on an error or a spec that doesn't parse (named or not), and with `--strict` on any warning
too. With no specs in reach it passes, and says `0 spec(s)`. A named spec that doesn't exist is
`invalid-request`, exit 2. Two failure
modes can't be seen in the text alone and are left to the `design` skill: criteria a literal
reader takes the wrong way, and questions written for different items mixed into one set.

`spec check` runs the lint first and reports its findings as `lint`. They don't change `passed`
or what `spec check --strict` gates on, so an existing CI step behaves as before.

### `opportunities`

```sh
decide opportunities add --file <candidates.json>
decide opportunities set-status <id> <new|stale|adopted|rejected> [--reason <text>]
decide opportunities list [--keep '<field><op><value>']… [--sort <field>[:asc|desc]] [--limit N] [--fields a,b]
decide opportunities check
```

The backlog the `scout` skill writes, in `.system1/opportunities.json`. The skill decides what
counts as an opportunity; `decide` validates, merges and stores it. Nothing is sent anywhere.

- **`add`** reads a JSON array of candidates, or `{"candidates": [...]}`, from a file (`decide
  schema opportunities-add` has the shape). The id comes from the mode and the evidence text, so
  re-running a sweep updates an entry instead of duplicating it, and a moved file keeps its id. A
  `new` entry from the same sweep (`source.sweep`) at a path the add covers, whose evidence wasn't
  seen again, becomes `stale`; a stale entry seen again is `new` again; nothing is deleted. A
  `rejected` candidate needs a `statusReason`, and a status stays as it is when a re-sweep doesn't
  give one. Concurrent adds take turns on a lock file (`opportunities.json.lock`), so none is
  lost; a lock left by a crashed run is taken over after 30 s.
- **Savings are projected.** Each entry carries the inputs (`volume` per `per`, the current and
  the decision cost per item) and `decide` computes `savingUsd` from them, so a reader can
  disagree with an input rather than trust a figure.
- **`list`** filters and sorts on record fields with the `--keep` syntax: `status=new`,
  `risk in medium,high`, `projected>=0.01`, `location.path=src/a.ts`. A bare `risk`,
  `projected`, `location` or `source` means its `level`, `savingUsd`, `path` or `sweep`. The
  default sort is `projected:desc`, which only ranks `benefit=cost` entries meaningfully: filter
  by `benefit` first. Field and sub-field names are checked, so a typo is an error
  even on an empty backlog.
- **`set-status`** sets one entry's status, for example `adopted` once `adopt` has wired it in.
  `rejected` needs `--reason`. A new status replaces the old reason. An unknown id is
  `invalid-request`, never an add.
- **`check`** validates the file. A malformed backlog is `invalid-request`, exit 2, listing every
  problem, and `add` and `list` refuse it the same way. `decide` never repairs or overwrites it.

### `compare`

```sh
decide compare <spec> [--baseline current|emulated|emulated:<model>] [--live|--record|--replay]
               [--limit N] [--dry-run] [--confirm] [--model <id>]
```

Measures Jev against a baseline over the same states, captured from real inputs by the shadow
harness that `adopt` generates, and writes `.system1/compare/<spec>/report.json`. The whole
chain, and how to read the report, is in [adopt and compare](adopt.md).

- **The capture** is `.system1/compare/<spec>/captured.jsonl`, one JSON line per input:
  `{id, state, current, output?, usage?, latencyMs?}`. `current` is the mechanism in place's
  answer, already mapped into the spec's answer space (`{"<question>": <value>}`: an option key,
  an integer level, or a probability). Only `state` is sent, scrubbed and size-checked; `current`,
  `output` and `usage` stay on the machine. A bad line is left out and reported with its number.
- **`--baseline current`** (the default) compares against the captured `current` answers: no
  baseline call is made, and its cost and latency are what the harness recorded. A missing `usage`
  is unknown, never zero. **`--baseline emulated`** asks a chat model (Claude Haiku 4.5, or
  `emulated:<model>`) instead. That sends the states to a second vendor, so the repo must allow it
  first (`decide config egress allow-profile`), or it is `profile-not-allowed` before any call.
- **Live calls** need repo consent, and the spend guard covers both sides' calls together, so
  `--dry-run` projects both and `--confirm` passes the guard. `--record` keeps the answers as
  fixtures in `.system1/compare/<spec>/fixtures/`, beside the capture and apart from the spec's
  own, so a later run replays them with no key. They hold the captured states: `.system1/compare/`
  stays out of git. Both sides' spend is ledgered with the tag
  `compare`.
- **Signals:** cost per call and latency for each side, Jev's decisiveness and undecided share,
  the baseline's parse rate (answers that fit the answer space strictly), and agreement by question
  and by type. Two answers agree on the same option, the same rounded level, or the same side of
  0.5. An undecided Jev answer is counted apart, not as a disagreement.
- **Labels:** with `.system1/labels/<spec>.jsonl` (`{id, labels: {"<question>": <value>}}`, any
  subset of questions), the report adds accuracy for each side, with the number of answers it rests
  on. It names the side ahead only over the labelled answers both sides gave, so a side can't win
  by declining the hard rows. **Without labels it names no winner**: agreement shows where the two
  differ, not which is right.
- **`--limit N`** compares the first N valid rows; invalid lines are still counted over the whole
  file.

### `usage`

```sh
decide usage [--session <id|current>] [--since <date>]
```

Sums the ledger (`.system1/usage.jsonl`): calls, live and replayed, measured cost and tokens.
`--session current` means this harness session.

### `config`

```sh
decide config [show]
decide config egress status
decide config egress allow [--by <who>] [--confirm]
decide config egress deny
decide config egress allow-profile <id> [--by <who>] [--i-consent]
decide config egress deny-profile <id>
```

`show` prints every resolved setting, the profiles the config files add, the routing config, and
`warnings`: keys and values the files hold that loading ignored. `allow` needs an interactive
terminal (typing it there is the decision; there's no further prompt), or `--confirm`, which is
how a user grants it where there's no terminal, such as Claude Code's `!` prompt.
**Consent is the user's.** Agents must not pass `--confirm` for the user. `--by` records who
granted it; without it, the record says `decide config` or `decide config --confirm`.

`allow-profile <id>` lets `decide compare` send this repo's content to an emulated baseline such
as `emulated:anthropic/claude-haiku-4.5`, a chat model on a second vendor. It records
`{id, at, by}` in `egress.allowProfiles`, as consent records its grant: `--by` says who allowed
it, and without it the record says `decide config` or `decide config --i-consent`. Allowing it again
records the new grant. Like `guard enable`, it needs an interactive terminal, or `--i-consent`
where there's none; `--confirm` doesn't count. Agents must not run it. `deny-profile <id>` removes
the entry and needs neither. `status` and `show` report both consent and the allowed profiles.

### `guard`

```sh
decide guard [list|status]
decide guard enable <pack> [--by <who>] [--i-consent]
decide guard disable <pack> [--by <who>]
```

Guard packs are hook checks that send content to the provider at a harness event. The only pack
is `done-check`. `list` and `status` show each pack as `active` (enabled, with egress consent),
enabled but dormant (no consent), or `dormant`.
**Enabling a pack is the user's decision**, like egress consent:
- `enable` refuses with exit 3 unless this repo already has egress consent.
- It needs an interactive terminal, or `--i-consent` where there's no terminal, such as Claude
  Code's `!` prompt; without either it also exits 3. `--confirm` doesn't count, because agents
  pass it to approve spend.
- Agents must not pass `--i-consent` for the user, and skills never do.
- `disable` needs neither, since it only stops egress.
- `--by` records who changed it; without it, the record says how.

Settings are in [configuration.md § Guard packs](configuration.md#guard-packs); how to use
`done-check` is in [guard](guard.md).

### `route`

```sh
decide route --text "<prompt>"     # or --stdin (the prompt as text)
decide route --hook                # stdin is a hook event: {"prompt": …, "cwd": …}
```

Matches a prompt against the routing triggers and says which fired (`triggers`), whether an
`ignore` pattern vetoed them (`ignoredBy`), and the hint an agent would get (`message`). It runs
regular expressions locally and never sends the prompt anywhere. With `--format brief` it prints
only the hint, or nothing: that is what the Claude Code plugin's `UserPromptSubmit` hook adds to
the agent's context. Use `--text` to test your own `route:` config. See
[routing-hints.md](routing-hints.md).

### `hook`

```sh
decide hook <pack> [--harness claude|codex] < event.json
```

The plugin's hooks run this at `SessionStart` and `Stop`. It reads the harness's event on stdin
and prints the harness's hook JSON, not the envelope:
- `{}` allows;
- `{"decision":"block","reason":…}` blocks once;
- `{"systemMessage":…}` shows you a line.

It **always exits 0**, because Claude Code treats exit 2 as a blocking error. A pack that isn't
enabled with consent in this repo prints `{}` and sends nothing. An enabled pack that can't check
(no network, a timeout, the spend cap) allows the stop and says why. `--harness` names the
session (`claude:<id>` or `codex:<id>`) in the guard state and in the ledger, unless
`SYSTEM1_SESSION` is set; without it, a Codex `turn_id` in the event means Codex. `decide schema hook` prints the event's schema.

### `runtime`

```sh
decide runtime --module <path> --root <dir> --max-usd-per-day <usd> [--model <id>] [--replay] [--timeout-ms N] < request.json
decide runtime --protocol
```

What an adopted Python module spawns for each decision; agents and skills never run it. It reads
the request on stdin and prints one policy result, not the envelope, and **always exits 0**.
Egress is on only when the module's one marked `EGRESS` line says `"on"`; there is no flag for
it. A live call needs a writable `--root`. It loads no config. The details are in
[runtime.md](runtime.md#from-python-decide-runtime).

### `schema`, `ping`, `doctor`, `version`

- `decide schema <tool>` prints that tool's input schema; with no tool, the error lists them.
- `decide ping` exits 0 when the model's endpoint answers, and 5 when it doesn't. It probes the
  `model` and `endpoint` from config and environment, like every other command. If a config file
  fails to load, it probes from the environment alone and says so in `configError`. An endpoint
  that isn't a URL is `config-error`, exit 2.
- `decide doctor` always exits 0: a failed check is a finding, reported in the result
  (`healthy`, `live`) and in the headline. See [troubleshooting.md](troubleshooting.md).

## Output

Every command prints one envelope in `json`:

```json
{"v": 1, "ok": true,  "command": "many", "result": { … }}
{"v": 1, "ok": false, "command": "many", "error": {"code": "budget-exceeded", "message": "…", "details": { … }}}
```

`v` changes only on a breaking change. Adding fields isn't breaking. `error.code` is stable, so
branch on it, not on the message.

## Exit codes

| Exit | Meaning | Error codes |
|---|---|---|
| 0 | ok, including a `many` run where only some items failed (listed in `failed`) | — |
| 1 | a bug in `decide` | `error` |
| 2 | usage, config or source problem (in `many`, an oversize item is skipped rather than `state-too-large`) | `invalid-request`, `state-too-large`, `unknown-model`, `profile-not-allowed`, `config-error`, `source-error`, `no-key` |
| 3 | egress refused | `egress-refused` |
| 4 | spend guard; the projection is in `details` | `budget-exceeded` |
| 5 | provider failure | `provider-unreachable`, `provider-http`, `malformed-response` |
| 6 | replay miss | `replay-miss` |
| 7 | a check ran and did not pass: `spec check --strict` (an example missed) or `spec lint` (an error, an invalid spec, or with `--strict` a warning). Not an error: `ok` is true | — |

When every item in a `many` run fails with the same code, the run fails with that code.
[troubleshooting.md](troubleshooting.md) gives the cause and fix for each one.

## Environment

| Variable | |
|---|---|
| `OPENROUTER_API_KEY` | the API key (or `~/.config/system1/credentials`) |
| `SYSTEM1_MODEL` | default model id |
| `SYSTEM1_ENDPOINT` | provider endpoint |
| `SYSTEM1_REPLAY` | `1` forces replay |
| `SYSTEM1_SESSION` | session id for the ledger, if the harness doesn't provide one |
| `SYSTEM1_ROUTE` | `off` turns routing hints off, whatever the config says |
