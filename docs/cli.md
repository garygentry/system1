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
| `decide spec` | `list`, `show <name>`, `validate [name\|path]`, `check <name\|path>` |
| `decide usage` | Measured spend from the ledger |
| `decide config` | Show the resolved config; `config egress allow\|deny\|status` for consent |
| `decide route` | Does a prompt call for the ask skill? Local pattern matching; sends nothing |
| `decide schema` | Print the JSON Schema of a tool's input: `ask`, `many`, `usage`, `spec-check`, `route` |
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

**Split:** `--split file|hunk|row|join|lines:N[/overlap]`. The default is `file`. `join` makes
all sources one item.

**Projection** (`many`; `ask` uses `--keep` for its `verdict`):

| Flag | |
|---|---|
| `--keep '<question>[.<field>]<op><value>'` | repeatable, ANDed. Operators: `>= > <= < = !=` and `in a,b`. Fields: the natural value, `confidence`, `probabilities.<key>` |
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
decide spec check <name|path> [--live | --replay] [--confirm] [--model <id>] [--strict]
```

`spec check` runs a spec's examples and compares each with its `expect`. Replay is the default.
`--live` records fresh answers, after the same consent and spend checks as `many`. A mismatch is
a finding, not an error: the exit code is 0 and `passed` is false. `--strict` makes that exit 7
instead, so a CI step can gate on the exit code; the output is the same. Any example with no
recorded answer is exit 6.

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
```

`show` prints every resolved setting, the profiles the config files add, the routing config, and
`warnings`: keys and values the files hold that loading ignored. `allow` needs an interactive
terminal, or `--confirm`. **Consent is the user's.** Agents must not
pass `--confirm` for the user. `--by` records who granted it.

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

### `schema`, `ping`, `doctor`, `version`

- `decide schema <ask|many|usage|spec-check|route>` prints that tool's input schema.
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
| 2 | usage, config or source problem | `invalid-request`, `state-too-large`, `unknown-model`, `config-error`, `source-error`, `no-key` |
| 3 | egress refused | `egress-refused` |
| 4 | spend guard; the projection is in `details` | `budget-exceeded` |
| 5 | provider failure | `provider-unreachable`, `provider-http`, `malformed-response` |
| 6 | replay miss | `replay-miss` |
| 7 | `spec check --strict` only: an example did not pass. Not an error: `ok` is true | — |

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
