# Troubleshooting

Start with:

```sh
decide doctor --format brief
```

It checks the install, the key, consent and network access from the shell you run it in, which is
the agent's shell when an agent runs it. It prints a fix for each problem. The headline sums it up:

- `healthy · live ready`: live decisions work.
- `SETUP NEEDED (key, consent)`: nothing failed, but the checks named stand between this shell
  and a live decision. Replay still works.
- `PROBLEMS FOUND`: a check failed.

Most first-hour problems come back to one of three things, all found in walking the first hour
in each harness: no key, no consent, or a sandbox that blocks `decide`.

## Doctor checks

### doctor: `cli`

The `decide` that ran, its version and Node's. Always `ok`. If the version isn't the one you
installed, see `path-version`.

### doctor: `config`

A config or credentials file couldn't be read. The detail names the file and the problem, such
as invalid YAML, a bad `route:` setting, or a credentials file that others can read. Fix the file
it names. For credentials: `chmod 600 ~/.config/system1/credentials`, containing exactly one line,
`openrouter_api_key: <key>`.

It also fails when `SYSTEM1_ENDPOINT` isn't a URL. (An `endpoint` in a config file that isn't
an `http(s)` URL is ignored with a `config-keys` warning instead.)

### doctor: `config-keys`

A warning: the config files loaded, but some keys or values were ignored. Examples are an unknown
key (such as `concurency:`), a value of the wrong type or range (such as `concurrency: "4"`), or
consent granted in the user file. The default or the other file's value applied instead. The
detail lists each one with its file. Correct or remove them;
[configuration.md](configuration.md#files-and-layering) lists what is checked.

### doctor: `path`

`decide` isn't on PATH in this shell, so an agent can't run it.

- **Anywhere:** `npm i -g @garygentry/system1`. This is the recommended install in every harness,
  and the only one that also puts `decide` in your own terminal, CI and scripts.
- **Claude Code, without the global install:** the plugin's `bin/` puts `decide` on Claude's PATH.
  Install the plugin from its marketplace, or start Claude Code with
  `--plugin-dir <checkout>/plugins/system1`, or link a checkout with `pnpm dev:link`
  ([contributing/local-plugin.md](contributing/local-plugin.md)).
- **Codex and Pi** don't put plugin `bin/` on PATH, so they need the global install.

**`decide` works in Claude Code but not in your terminal.** Expected with a plugin-only install:
the plugin adds `decide` to Claude's PATH, not your shell's. Install it globally
(`npm i -g @garygentry/system1`), or run it at the Claude Code prompt with `!`.

### doctor: `path-version`

The `decide` on PATH is a different version from the one running doctor, and agents will run the
one on PATH. Reinstall with `npm i -g @garygentry/system1@<version>`, or remove the stale copy it
names. Inside the Codex sandbox, the version can't be read (child processes return no output), so
the check says it wasn't run.

### doctor: `key`

No API key, so only replay works. Set `OPENROUTER_API_KEY`, or write the credentials file the fix
line names (it follows `XDG_CONFIG_HOME`). See [getting-started.md](getting-started.md#3-the-key).
Never paste the key into the conversation.

A `warn` that says the key was wrapped in quotes means one pair of surrounding `"` or `'` was
removed before use (for example from `OPENROUTER_API_KEY='"sk-or-…"'`, or from
`openrouter_api_key: "'sk-or-…'"` in the credentials file). The key works; remove the extra quotes
where the fix line says. Versions up to 0.4.0 sent the quotes, and the provider answered 401.

### doctor: `consent`

This repo hasn't agreed to send content to the provider, so live calls are refused. If you agree,
run `decide config egress allow` yourself in a terminal at the repo root. At the Claude Code
prompt, which has no terminal, type `! decide config egress allow --confirm`.
An agent can't grant it for you. See
[getting-started.md](getting-started.md#4-consent-per-repo).

### doctor: `route`

Whether the Claude Code routing hook will hint, and with which triggers. A warning means the
`route:` config has a problem, usually a regular expression that doesn't compile or an unknown
name under `disable`. The hook stays silent until it's fixed, and your prompts are never blocked.
Test a fix with `decide route --text "…"`. See [routing-hints.md](routing-hints.md).

### doctor: `backlog`

Whether the scout backlog, `.system1/opportunities.json`, is valid. It's fine for it not to
exist. A warning means the file doesn't validate, often because it was edited by hand: an entry's
`id` no longer matches its evidence, or `savingUsd` no longer matches its inputs. `decide
opportunities check` lists every problem. Correct the file, or move it aside and re-run the
sweep; `decide` never repairs or overwrites it.

### doctor: `network`

The model's endpoint couldn't be reached from this shell. The fix depends on where you are:

- **Codex:** its sandbox gives the shell no network. Add
  `prefix_rule(pattern = ["decide"], decision = "allow")` to `$CODEX_HOME/rules/system1.rules`
  (the setup skill offers to do this), then restart Codex. The rule covers only commands that
  **start** with `decide`: `a && decide …` works, but `… | decide …` still runs offline, so pass
  content with `--file`.
- **Claude Code with the sandbox on:** allow outbound access to `openrouter.ai` in its sandbox
  settings.
- **Anywhere else:** check the proxy, firewall or DNS for `openrouter.ai`.
- **An HTTP answer** (404, 5xx) means the network works. A 404 means the endpoint doesn't know the
  model (check `SYSTEM1_MODEL` and `SYSTEM1_ENDPOINT`). A 5xx means the provider is having trouble,
  so retry later.

With `SYSTEM1_REPLAY=1`, an unreachable endpoint is only a warning.

## Errors

Every failure carries a stable `error.code` and an exit code. The message names the cause and the
next step.

### `replay-miss` · exit 6

There is no recorded answer for this request.

- **With no key**, the message starts "No API key is set": replay is the only mode, and nothing is
  recorded for a new question. Set a key (see `key` above) for a live answer.
- **With a key, in forced replay** (`--replay` or `SYSTEM1_REPLAY=1`): run it live once without
  those, or with `--record` to save the answer.
- **From `spec check`:** the spec's examples have no recorded answers, or the question was
  reworded, so the old ones no longer match. Run `decide spec check <name> --live` to record them.

### `egress-refused` · exit 3

The repo hasn't consented to sending content, or an agent tried to grant consent without a
terminal. Consent is yours: run `decide config egress allow` yourself in that repo, or
`! decide config egress allow --confirm` at the Claude Code prompt. Replay works without it.

### `no-key` · exit 2

`--live`, `--record` or `spec check --live` needs an API key, and none is set. Set one (see `key`
above), or drop the flag to replay.

### `budget-exceeded` · exit 4

The run is projected to go over the spend guard: 200 calls or $0.05 by default. `details` has the
projection. Narrow the run with a tighter glob or a coarser split, so there are fewer items to
judge. `--limit` doesn't help: it trims what comes back, after every item is judged. Or, if **you**
accept the cost, add `--confirm`. An agent should show you the projection and let you decide. To
change the guard, set `budget.maxCalls` and `budget.maxUsd` in config. See [spend.md](spend.md).

### `invalid-request` · exit 2

The request is malformed: an unknown flag, an unparseable `--question` or `--keep`, a bad spec, or
conflicting flags. The message says what's wrong. `decide schema ask` and `decide schema many`
list the real inputs, and `decide spec validate <name>` lists every problem with a spec.

### `state-too-large` · exit 2

One item is larger than the model accepts. It's refused, never truncated. Split it smaller:
`--split lines:200`, `--split hunk` for a diff, or `--file path:START-END` for the part that
matters.

### `source-error` · exit 2

A source couldn't be read: a missing file, an invalid JSONL line (the message names it), or git
failing. If it says `git check-ignore did not answer`, a sandbox is probably blocking child
processes. In Codex, add the `prefix_rule` (see `network` above), or name the files with `--file`.

### `config-error` · exit 2

A config or credentials file is invalid or insecure. The message names the file. See `config`
above.

### `unknown-model` · exit 2

The model id from `--model`, `SYSTEM1_MODEL` or `model:` in config has no profile. The default,
`typesafe/jev-1.13`, is the only supported model.

### `provider-unreachable` · exit 5

The endpoint couldn't be reached, or kept failing after retries. Run `decide doctor` and follow
its `network` fix.

### `provider-http` · exit 5

The provider answered with an error status that isn't worth retrying. A 401 means the key is
wrong or revoked (from 0.4.1, surrounding quotes are removed, and `decide doctor` says so). A 402 means the OpenRouter account is out of credit. A 404 means the model id
or endpoint is wrong. A 429 (rate limit) or 5xx is retried with backoff first, and ends up
here only if it persists, so wait and retry. The message carries the status.

### `malformed-response` · exit 5

The provider answered, but not with a valid decision for the request. Retry once. If it
persists, report it with the envelope.

### `error` · exit 1

A bug in `decide`. Please report it with the command and the envelope, at
<https://github.com/garygentry/system1/issues>.

## In an agent

- **The agent reads the files itself instead of using `decide`.** That's allowed for a handful of
  items. For more, ask for it explicitly ("use System 1"). If you've adopted a spec, the `ask`
  skill checks `decide spec list` first.
- **A pipe into `decide` fails in Codex** with a DNS or connection error: the `prefix_rule` only
  covers commands that start with `decide`. The skills save content to a file and pass `--file`.
- **The agent says it can't grant consent.** That's by design. Run the command yourself.
