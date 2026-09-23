# Concepts

What `decide` does, in the terms its output and flags use.

## Closed judgements

A decision model answers **closed** questions about text you point it at. It never writes text.
It reads the item and the question, and returns one of three typed answers:

| Type | The answer is… | You get back |
|---|---|---|
| `noul` | whether one statement is true | `noul`: the probability, 0 to 1, that it holds |
| `choice` | one of a fixed set of options you name | `choice` (the winner), `probabilities` over every option, `confidence` |
| `score` | a position on levels you describe, counted from 0 | `score` (the probability-weighted mean level), `probabilities` per level, `confidence` |

Write a `noul` as a statement ("The function makes a network request without a timeout"), not a
question. Give a `choice` a way out (`none` or `unclear`), or the model has to pick the least
wrong option. Describe `score` levels as concrete situations, lowest first. The `ask` skill's
`references/question-craft.md` has the full rules. Most bad answers come from a badly posed
question, not from the model.

Don't use it for counting, arithmetic, dates, exact matching, or anything that needs several
documents reasoned together. Use code for those.

## Thresholds, and undecided

The model returns probabilities, and you decide what they mean. `--keep 'no_timeout>=0.3'` keeps
items at or above 0.3, and repeated `--keep` flags are ANDed. **Choose the threshold from what a
mistake costs, before you look at the answers.**

- **Screening,** where a miss costs more than a false keep: `≥ 0.3`.
- **Balanced:** `≥ 0.5`.
- **Acting unattended:** `≥ 0.7`.

For yes/no questions that reading the text settles, those three come from our measurement: see
[calibration.md](calibration.md) for the precision and recall behind each. For subjective
questions, and for `choice` and `score`, calibration hasn't been measured. Treat the numbers as
rankings, and check a threshold on your own examples with `decide spec check`.

**Undecided is its own outcome.** A `noul` within 0.075 of 0.5, or a `choice` or `score` whose
confidence is 0.15 or less, is too flat to act on. `decide` lists undecided items apart from the
rest and never applies a threshold to them: they are neither kept nor dropped. Read them yourself,
ask a sharper question about just those items, or show them to the user.

When an answer gates something risky, use it only to **add** caution: "if `destructive ≥ 0.3`,
ask first", never "if `safe ≥ 0.9`, skip the review".

## Live and replay

- **Live:** the question goes to the model now. It needs a key and the repo's consent, and it
  costs about $0.00003 per 700-token item. Measured costs come from the provider's usage report.
- **Record** (`--record`, or `decide spec check --live`): live, and the answer is also saved in
  `.system1/fixtures/<namespace>/`. A spec's namespace is its name; one-off questions use `adhoc`.
- **Replay:** the answer comes from a saved fixture, keyed by the exact text and questions. It
  needs no key, no consent and no network, and costs nothing. It's what `decide` does when no key
  is set, and what `--replay` or `SYSTEM1_REPLAY=1` forces.

Every answer says which it was (`source: live` or `replay`). **A replay miss is an error
(`replay-miss`, exit 6), never an invented answer.** Rewording a question changes the key, so the
old fixtures stop matching.

A fixture holds the exact text that was sent. Read it before you commit or share it, the way you
would a test fixture. One-off answers and the spend ledger are per-machine, so `.system1/fixtures/adhoc/`
and `.system1/usage.jsonl` belong in `.gitignore`.

## Sources and splits

`decide` reads the content itself, so nothing large is pasted into the conversation.

| Source | Reads |
|---|---|
| `--glob '<pattern>'` | matching files; `.gitignore` is honoured inside a git repo |
| `--file <path[:START-END]>` | one file, or a 1-based inclusive line range of it |
| `--diff <range>` (`--staged`) | a git diff |
| `--jsonl <path>` | one structured item per line |
| `--text '<text>'` | the text itself |
| `--stdin` | piped input |

A **split** turns sources into items, one call each:

| `--split` | One item per |
|---|---|
| `file` (the default) | file |
| `hunk` | diff hunk |
| `row` | line (or JSONL row) |
| `lines:N[/overlap]` | window of N lines |
| `join` | everything together: one state, e.g. a diff plus a test log |

`ask` judges exactly one item; `many` fans out over many and filters in the engine
(`--keep`, `--sort`, `--limit`), so only what matters comes back.

## Specs

A **spec** is a question set saved in `.system1/specs/<name>.yaml`, with its thresholds (each
with a `why`), an optional default source, and examples with expected answers. Run it with
`decide many --spec <name>`, and test it offline with `decide spec check <name>` against its
committed fixtures. The `design` skill writes and repairs them. The [cookbook](cookbook.md) has
tested ones to copy.

Specs are looked up in the repo (`.system1/specs/`), then your user config
(`~/.config/system1/specs/`).

## What gets sent

Only when the repo has consented, and only after these checks, in order:

1. **Excludes.** Files that look like secrets are never read into a request: `.env*`, `*.pem`,
   `*.key`, SSH keys, `.npmrc`, `.netrc`, cloud credentials, `*.tfstate`, `secrets/**` and more.
   Add patterns with `egress.exclude` in config. A symlink is matched by where it points, too.
2. **The repo boundary.** Content that resolves outside the repo is withheld, unless you pass
   `--allow-outside` for a file you wrote yourself, such as a log tail in `/tmp`.
3. **Scrubbing.** Secret-shaped strings (API keys, tokens, private keys, credentials in URLs) are
   redacted from everything sent, including the questions. The output says how many were removed.
4. **Size.** An item too large for the model is refused (`state-too-large`), never truncated. A
   decision made on half an input is a wrong decision.

Withheld items are listed in the output with the reason, never silently dropped.

## Spend

Before a large fan-out, `--dry-run` projects the cost without making any calls. A run projected
over the **spend guard** (200 calls or $0.05 by default, set with `budget.maxCalls` and
`budget.maxUsd`) stops with exit 4 and shows the projection. Only `--confirm` lets it go ahead,
and that's the user's call to make, not the agent's.

Every live and replayed call is logged to `.system1/usage.jsonl`. `decide usage` summarises it,
by session (`--session current` is this harness session) or since a date.

## Configuration

Layers, later ones winning: built-in defaults → `$XDG_CONFIG_HOME/system1/config.yaml`
(`~/.config/system1/config.yaml`) → `<repo>/.system1/config.yaml` → environment
(`OPENROUTER_API_KEY`, `SYSTEM1_MODEL`, `SYSTEM1_ENDPOINT`, `SYSTEM1_REPLAY`, `SYSTEM1_SESSION`,
`SYSTEM1_ROUTE`).
Consent is the exception: it is read **only** from the repo's file. `decide config` shows what
resolved, and where from. It never shows the key.

## Routing hints

A skill loads only when the agent chooses to load it. Claude, in particular, tends to grade a
small diff it just wrote rather than hand the check off. So the Claude Code plugin ships one
hook: on every prompt, `decide route` matches the prompt against a few patterns. When one fires,
the agent gets a one-line hint to use the `ask` skill. The hint is added to what the agent reads;
nothing is sent to the model, and the prompt never leaves your machine. Codex and Pi don't get
the hook.

Each built-in trigger needs two things together: an intent to judge, and something to judge.
`batch-judgement` pairs a judging verb or "which of these" with a data file or a batch ("triage
every CI failure", "go through tickets.jsonl and flag any where…"). `pick-from-many` pairs "best
fit" or "which one" with a long list. `criteria-check` pairs "against", "meets" or "pass or fail"
with rules, criteria or a checklist. `done-check` pairs "is it done?", "ready to merge?" or "can I
ship this" with a diff, a PR or a test log. `gate-check` pairs "before I commit" with rules or
"is it safe". A prompt that says not to use System 1 or `decide` gets no hint.

Everything is configurable under `route:`, in either config layer:

```yaml
route:
  enabled: true            # false: the hook stays installed but never hints
  builtin: true            # false: only your triggers apply
  disable: [pick-from-many]  # switch off built-in triggers by name
  triggers:                # your own; a JavaScript regex, case-insensitive
    - name: pr-review
      pattern: '\breview (this|the) PR against\b'
  ignore:                  # a prompt matching any of these never gets a hint
    - '^/'
  message: "Use the system1:ask skill for this ({triggers})."   # replaces the hint
```

`enabled`, `builtin` and `message` from the repo file win over the user file. `disable`,
`triggers` and `ignore` from both files add up. `SYSTEM1_ROUTE=off` turns hints off for one
shell or session. To see what a prompt would do, run `decide route --text "…"`: it lists the
triggers that fired and the config files it read. A bad pattern is a `config-error`; the hook
then stays silent rather than get in your way, and `decide doctor` reports the problem.

The hook never downloads anything mid-prompt. It runs a `decide` that is already on the machine:
a global install, or the copy of the plugin's pinned version that `npx` fetched the first time you
ran `decide` through the plugin. **Setup** makes that first call, so hints start once setup has
run. Before that, the hook stays silent.

## The model

The only supported model today is [Jev](https://openrouter.ai/typesafe/jev-1.13)
(`typesafe/jev-1.13`) on OpenRouter. The README says
[what happens if it goes away](../README.md#one-model-one-provider).
