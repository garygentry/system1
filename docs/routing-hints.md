# Tune or turn off routing hints

The Claude Code plugin runs `decide route` on every prompt. When a prompt asks for closed
judgements, the agent gets a one-line hint to use the `ask` skill. This page changes when that
happens. Codex and Pi have no hook, so nothing here affects them. Why the hook exists, and what
each built-in trigger looks for, is in [concepts.md](concepts.md#routing-hints).

Everything below goes under `route:` in `~/.config/system1/config.yaml` (for you, in every repo)
or `<repo>/.system1/config.yaml` (for one repo). [configuration.md](configuration.md) lists every
key.

## See what a prompt would do

```sh
decide route --text "Is it done? Check the diff against TASK.md"
```

The result lists the triggers that fired (`triggers`, each with its `name`, whether it is
`builtin` or from `config`, and the text that matched), an `ignore` pattern that vetoed them
(`ignoredBy`), the hint the agent would get (`message`), and the config files it read (`files`).
With `--format brief` it prints only the hint, or nothing, which is exactly what the hook adds.

It runs locally and sends nothing. Use it to test every change you make on this page.

## Turn hints off

For good, in either config file:

```yaml
route:
  enabled: false
```

The hook stays installed but never hints. For one shell or session, set `SYSTEM1_ROUTE=off`
before you start Claude Code. `0`, `false` and `no` work too, and it wins over both files.

## Disable a built-in trigger

Name it under `disable`:

```yaml
route:
  disable: [pick-from-many]
```

The built-ins are `batch-judgement`, `pick-from-many`, `criteria-check`, `done-check` and
`gate-check`. An unknown name is a `config-error`. To drop all of them and keep only your own
triggers, set `builtin: false`. That also drops the built-in veto for prompts that say not to use
System 1 or `decide`.

## Add your own trigger or ignore pattern

```yaml
route:
  triggers:
    - name: pr-review
      pattern: '\breview (this|the) PR against\b'
  ignore:
    - '^/'
  message: "Use the system1:ask skill for this ({triggers})."
```

- **`triggers`** each need a `name` and a `pattern`: a JavaScript regular expression, matched
  case-insensitively. Yours run after the built-ins.
- **`ignore`** patterns veto the hint: a prompt that matches any of them gets none.
- **`message`** replaces the hint. `{triggers}` expands to the names that fired.

Use single quotes in YAML for patterns, so a backslash stays a backslash.

How the two files combine:

- `enabled`, `builtin` and `message`: the repo file wins over your user file.
- `disable`, `triggers` and `ignore`: both files add up, yours first.
- `SYSTEM1_ROUTE=off` wins over both.

## When the hook stays silent

The hook prints a hint only when `decide route` succeeds, and it always exits 0, so it never
blocks a prompt. It stays silent when:

- **A pattern is bad.** A regular expression that doesn't compile, or an unknown name under
  `disable`, is a `config-error`. `decide doctor` shows it under the `route` check, and
  `decide route --text "…"` names the pattern and what is wrong with it.
- **There is no `decide` on the machine yet.** The hook never downloads anything mid-prompt. It
  runs a global install (`npm i -g @garygentry/system1`), or the copy of the plugin's pinned
  version that `npx` fetched the first time you ran `decide` through the plugin. The **setup**
  skill makes that first call, so hints start once setup has run.
- **Hints are off**, through `route.enabled` or `SYSTEM1_ROUTE`. `decide doctor` says so.
- **An `ignore` pattern matched.** `decide route --text "…"` shows which one, in `ignoredBy`.

`decide doctor --format brief` shows the triggers that are on:

```text
  ok   route: routing hints on: batch-judgement, pick-from-many, criteria-check, done-check, gate-check, pr-review
```

See also [troubleshooting.md](troubleshooting.md#doctor-route).
