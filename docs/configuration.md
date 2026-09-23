# Configuration

Every setting `decide` reads: the config keys, their defaults, which layers can set them, the
credentials file, the environment variables, and the per-repo `.system1/` directory. A test
(`tools/docs.test.ts`) checks that every config key in the code is named on this page. For why
the layers work this way, see [concepts.md § Configuration](concepts.md#configuration).

## Files and layering

| Layer | Where | Can set |
|---|---|---|
| Defaults | built in | everything |
| User | `$XDG_CONFIG_HOME/system1/config.yaml` (`~/.config/system1/config.yaml` when `XDG_CONFIG_HOME` is unset) | every key except `egress.consent` |
| Repo | `<repo>/.system1/config.yaml` | every key |
| Environment | the shell | `model`, `endpoint` and `route.enabled` only (see [Environment variables](#environment-variables)) |

Later layers win. How two layers combine depends on the key:

- **Single values** (`model`, `endpoint`, `concurrency`, `timeoutMs`, `budget.*`,
  `route.enabled`, `route.builtin`, `route.message`): the repo file wins over the user file, and
  the environment wins over both.
- **Lists** (`egress.exclude`, `profiles`, `route.disable`, `route.triggers`, `route.ignore`):
  both files add up, user entries first.
- **`egress.consent`** is read **only** from the repo file. A grant in the user file is ignored,
  so consent never silently covers every repo.

The **repo** is the nearest directory, from where `decide` runs, that holds `.system1/` or
`.git`. If there is none, it is the current directory.

Both files are YAML mappings. An empty file is fine. A file that isn't valid YAML, or isn't a
mapping, is a `config-error` (exit 2) that names the file. Unknown top-level keys are ignored.
Unknown keys under `route:` are a `config-error`.

A single value of the wrong type (for example `concurrency: "4"`) is skipped without an error,
and the next layer or the default applies. So is a negative `budget.*` value. Run `decide config`
to see what resolved.

## Keys

| Key | Default | Type | Meaning |
|---|---|---|---|
| `model` | `typesafe/jev-1.13` | text | The model id. It must match a [profile](#profiles). `--model` overrides it for one command |
| `endpoint` | `https://openrouter.ai/api/alpha/decisions` | URL | The provider's decisions endpoint |
| `concurrency` | `8` | number | The most calls `many` runs at once. `--concurrency` can lower it for one run, never raise it |
| `timeoutMs` | `5000` | number | Timeout for **one attempt** of a call, in milliseconds. A call makes up to 3 attempts, with backoff, so one call can take longer than this |
| `budget.maxCalls` | `200` | number ≥ 0 | The spend guard: a request projected over this many calls needs `--confirm` |
| `budget.maxUsd` | `0.05` | number ≥ 0 | The spend guard: a request projected over this many US dollars needs `--confirm` |
| `egress.consent` | `{granted: false}` | mapping | Whether this repo agreed to send content to the provider. Repo file only |
| `egress.exclude` | `[]` | list of globs | Paths never to send, on top of the built-in excludes |
| `profiles` | `[]` | list | Extra model profiles, after the built-in ones |
| `route.*` | see [Routing hints](#routing-hints) | mapping | The Claude Code routing hook |

A repo config that sets several of these:

```yaml
# <repo>/.system1/config.yaml
concurrency: 4
timeoutMs: 8000
budget:
  maxCalls: 500
  maxUsd: 0.10
egress:
  consent: { granted: true, at: "2026-09-22T10:00:00.000Z", by: "decide config" }
  exclude:
    - "fixtures/**"
    - "**/*.log"
```

### `egress.consent`

`{granted: true|false, at?, by?}`. `at` is an ISO timestamp and `by` is free text. Anything else
is a `config-error`. Don't write it by hand: `decide config egress allow` and `deny` set it and
keep the rest of the file, comments included. **Consent is the user's.** See
[getting-started.md § Consent, per repo](getting-started.md#4-consent-per-repo).

### `egress.exclude`

Glob patterns, matched against each item's repo-relative path (and, for a symlink, the path it
points to). Dotfiles match. They add to the 22 built-in excludes (`.env*`, `*.pem`, `*.key`, SSH
keys, `.npmrc`, `.netrc`, `*.tfstate`, `secrets/**` and others); config can't remove a built-in
one. A value that isn't a list of strings is a `config-error`. The output reports each withheld
path with the pattern that matched.

### `profiles`

A profile describes a model to the engine. The built-in one is `typesafe/jev-1.13`. Each entry
added in config needs four fields:

| Field | Type | Meaning |
|---|---|---|
| `id` | text | The model id sent to the provider, and the value `model` refers to |
| `maxStateTokens` | number | The largest item accepted. Larger ones are refused (`state-too-large`), never truncated |
| `usdPerInputToken` | number | Listed price, used only for **projected** cost |
| `undecidedFloor` | number | Confidence at or below which an answer counts as undecided. Jev's is 0.15 |

Optional fields, with the default a config profile gets:

| Field | Default | Meaning |
|---|---|---|
| `maxChoices` | `255` | The most options one `choice` question may have. A whole number, at least 2 |
| `displayName` | the `id` | A name for display |
| `transport` | `openrouter-decisions` | How the model is reached. It's the only one there is |
| `usdPerOutputToken` | `0` | Listed output price |
| `priceAsOf` | `unknown` | When the listed price was read |
| `calibrated` | `true` | Whether the model's probabilities are calibrated |

A missing required field, or a bad `maxChoices`, is a `config-error`. The other optional fields
aren't checked.

A model id resolves to the first profile whose `id` matches, built-ins first. So a config
profile with the same `id` as a built-in one has no effect. A dated build such as
`typesafe/jev-1.13-20260917` resolves to its family's profile, and the dated id is what gets
sent. An id with no profile is `unknown-model` (exit 2).

## Routing hints

Settings for the Claude Code routing hook, under `route:` in either file. For the steps to tune
it, see [routing-hints.md](routing-hints.md). For why it exists, see
[concepts.md § Routing hints](concepts.md#routing-hints).

| Key | Default | Type | Combines | Meaning |
|---|---|---|---|---|
| `route.enabled` | `true` | boolean | repo wins | `false`: the hook stays installed but never hints |
| `route.builtin` | `true` | boolean | repo wins | `false`: only the triggers from config apply. The built-in ignore pattern goes too |
| `route.disable` | `[]` | list of names | add up | Built-in triggers to switch off: `batch-judgement`, `pick-from-many`, `criteria-check`, `done-check`, `gate-check` |
| `route.triggers` | `[]` | list of `{name, pattern}` | add up | Extra triggers, after the built-ins |
| `route.ignore` | `[]` | list of patterns | add up | A prompt matching any of these gets no hint |
| `route.message` | the built-in hint | text | repo wins | Replaces the hint. `{triggers}` expands to the names that fired |

Patterns are JavaScript regular expressions, matched case-insensitively. The built-in ignore
pattern skips prompts that say not to use System 1 or `decide`. `SYSTEM1_ROUTE=off` sets
`enabled` to false whatever the files say.

These are `config-error`s: an unknown key under `route:`, a value of the wrong type, a trigger
without a `name` and a `pattern`, a pattern that doesn't compile, and a name in `disable` that
isn't a built-in trigger. Patterns are checked even when `enabled` is false. When the config is
wrong, the hook stays silent and `decide doctor` reports it as a `route` warning. Test a change
with `decide route --text "…"`.

## Credentials file

The API key can live in a file instead of the environment:

```yaml
# $XDG_CONFIG_HOME/system1/credentials  (~/.config/system1/credentials)
openrouter_api_key: <key>
```

- `openrouter_api_key` is the only key read. It's YAML, like the config files.
- On Linux and macOS, the file must give group and others no access at all (`chmod 600`).
  Otherwise every command that loads config fails with `config-error`.
- `OPENROUTER_API_KEY` in the environment wins over the file.
- There is no repo-level credentials file. The key is never printed: `decide config` and
  `decide doctor` say only whether it is present, and where it came from.

## Environment variables

| Variable | Effect |
|---|---|
| `OPENROUTER_API_KEY` | The API key. Wins over the credentials file |
| `SYSTEM1_MODEL` | Sets `model`, over both files |
| `SYSTEM1_ENDPOINT` | Sets `endpoint`, over both files |
| `SYSTEM1_REPLAY` | `1`, `true` or `yes`: answers only from fixtures, even with a key |
| `SYSTEM1_SESSION` | The session id recorded in the spend ledger. Wins over the harness's own |
| `SYSTEM1_ROUTE` | `off`, `0`, `false` or `no`: no routing hints |
| `XDG_CONFIG_HOME` | Moves the user config, the credentials file and the user specs directory |

An empty value counts as unset. `decide ping` reads only the environment: it ignores `model` and
`endpoint` in the config files. The other commands read every layer.

**Harness session ids.** Without `SYSTEM1_SESSION`, the ledger records the id of the harness
running the shell, as `<harness>:<id>`. The variables read are `CLAUDE_CODE_SESSION_ID` (Claude
Code), `CODEX_THREAD_ID` or `CODEX_SESSION_ID` (Codex) and `PI_SESSION_ID` (Pi). `AI_AGENT`,
`CLAUDECODE` and `PI_CODING_AGENT` help pick the innermost harness when one runs inside another.
Two nestings can't be told apart: Claude Code inside Codex resolves to Codex, and Codex inside Pi
resolves to Pi. Set `SYSTEM1_SESSION` for those.

Two more are for development: `SYSTEM1_SPECS_PATH` adds a third spec directory after the repo and
user ones (see [spec-format.md](spec-format.md#where-specs-are-found)), and `SYSTEM1_DEBUG`
prints the stack trace when `decide` hits a bug (exit 1).

## Per-repo state

Everything `decide` keeps for a repo lives in `<repo>/.system1/`:

| Path | Holds | Commit it? |
|---|---|---|
| `config.yaml` | Repo config and egress consent | The team's call. Committing it shares the consent with everyone who clones the repo |
| `specs/<name>.yaml` | Saved specs. See [spec-format.md](spec-format.md) | Yes |
| `fixtures/<spec>/` | Recorded answers for a spec, one `<sha256>.json` per request | Yes, after reading them: each holds the exact text that was sent |
| `fixtures/adhoc/` | Recorded answers for one-off questions | No: add it to `.gitignore` |
| `usage.jsonl` | The spend ledger: one line per call, live or replayed | No: add it to `.gitignore` |

The user config directory can hold specs too, in `$XDG_CONFIG_HOME/system1/specs/`.

## What resolved

`decide config` prints the resolved `model`, `endpoint`, `concurrency`, `budget` and `egress`
settings, whether a key is present, the session, the files that contributed and the spec
directories. It doesn't show `timeoutMs`, `profiles` or `route`. For `route`, use
`decide route --text "…"` or `decide doctor`. See [cli.md § config](cli.md#config).
