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
  costs about $0.00004 per 700-token item, counting the ~300 tokens the provider adds to every
  call. Measured costs come from the provider's usage report.
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

`decide` reads the content itself: files by glob or path, a git diff, JSONL rows, text or piped
input. So nothing large is pasted into the conversation, and every item passes the same egress
checks on its way out (see [what gets sent](#what-gets-sent)). A **split** turns those sources into
items, one call each: a file, a diff hunk, a row, a window of lines, or everything joined into one
state. `ask` judges exactly one item. `many` fans out over many and filters in the engine, so only
what matters comes back. [cli.md](cli.md#ask-and-many) has the flags.

## Specs

A **spec** is a question set saved in `.system1/specs/<name>.yaml`, with its thresholds (each with
a `why`), an optional default source, and examples with expected answers. It turns a question that
worked into a file the team reviews like code: the thresholds live in the file rather than in
anyone's head, and the committed fixtures make `decide spec check <name>` an offline regression
test. The `design` skill writes and repairs specs for an agent, and the [cookbook](cookbook.md)
has tested ones to copy.

[specs.md](specs.md) shows how to write, record and test one, and [spec-format.md](spec-format.md)
lists every field.

## What gets sent

Only when the repo has consented, and only after these checks, in order:

1. **Excludes.** Files that look like secrets are never read into a request: `.env*`, `*.pem`,
   `*.key`, SSH keys, `.npmrc`, `.netrc`, cloud credentials, `*.tfstate`, `secrets/**` and more.
   Add patterns with `egress.exclude` in config. A symlink is matched by where it points, too.
2. **The repo boundary.** Content that resolves outside the repo is withheld, unless you pass
   `--allow-outside` for a file you wrote yourself, such as a log tail in `/tmp`.
3. **Scrubbing.** Secret-shaped strings (API keys, service tokens with a known prefix, private keys,
   credentials in URLs, and credential-looking values under names like `DATADOG_APPKEY`, as in an
   MCP server's `env` block) are redacted from everything sent, including the questions. The output
   says how many were removed.
4. **Size.** An item too large for the model is never truncated: a decision made on half an input
   is a wrong decision. `ask` refuses it (`state-too-large`). `many` skips it, reports it as
   `too-large` with the split to re-run it, and goes on with the rest.

Withheld items are listed in the output with the reason, never silently dropped.

## Spend

One call costs little, but an agent can start a fan-out over thousands of items in one command.
So a live run projected over the **spend guard** (200 calls or $0.05 by default) stops with exit 4
before any call is made, and shows the projection. Only `--confirm` lets it go ahead, and that's
the user's call to make, not the agent's: the person paying sees the figure first. Projected costs
are always labelled as projected, and measured ones come from the provider's usage report.
[spend.md](spend.md) covers projecting, narrowing and reviewing a run.

## Configuration

Settings come in layers: built-in defaults, then your user config, then the repo's
`.system1/config.yaml`, then environment variables, with later ones winning. Consent is the
exception: it is read **only** from the repo's file, so a grant in one repo never covers another.
`decide config` shows what resolved, and where from. It never shows the key.
[configuration.md](configuration.md) lists every key.

## Routing hints

A skill loads only when the agent chooses to load it. Claude, in particular, tends to grade a
small diff it just wrote rather than hand the check off, and no rewording of the skill's
description changed that without making Codex and Pi load it when they shouldn't. So the Claude
Code plugin ships one hook instead: on every prompt, `decide route` matches the prompt against a
few patterns. When one fires, the agent gets a one-line hint to use the `ask` skill. Codex and Pi
don't get the hook; it changes nothing they see.

The hint is added to what the agent reads. Nothing is sent to the model, and the prompt never
leaves your machine, so consent doesn't come into it. A wrong hint costs a skill load, not a
decision: the agent still chooses whether to call `decide`, and any call still needs consent.

Each built-in trigger needs two things together: an intent to judge, and something to judge.
`batch-judgement` pairs a judging verb or "which of these" with a data file or a batch ("triage
every CI failure", "go through tickets.jsonl and flag any where…"). `pick-from-many` pairs "best
fit" or "which one" with a long list. `criteria-check` pairs "against", "meets" or "pass or fail"
with rules, criteria or a checklist. `done-check` pairs "is it done?", "ready to merge?" or "can I
ship this" with a diff, a PR or a test log. `gate-check` pairs "before I commit" with rules or
"is it safe". Either half alone is common in ordinary requests; together they are rare. A prompt
that says not to use System 1 or `decide` gets no hint.

The hook never gets in your way. It always exits 0, so it can't block a prompt, and it never
downloads anything mid-prompt: it runs a `decide` already on the machine, and stays silent
otherwise. Decision record [0018](../plans/decisions/0018-claude-routing-hook.md) has the full
reasoning. To see what a prompt would do, add your own triggers, or switch hints off, see
[routing-hints.md](routing-hints.md).

## The model

The only supported model today is [Jev](https://openrouter.ai/typesafe/jev-1.13)
(`typesafe/jev-1.13`) on OpenRouter. The README says
[what happens if it goes away](../README.md#known-limits).
