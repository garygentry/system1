# System 1

**`decide`** is a command-line tool that sends a **closed judgement** (yes/no, pick one, rate this)
to a decision model and gets back a typed probability, in about 300 ms for a fraction of a cent.
The **System 1 plugin** teaches Claude Code, Codex and Pi when to reach for it instead of reading
everything themselves.

- which of these 300 grep hits actually break the rule;
- which CI failures are flaky, real or infrastructure;
- is this command destructive;
- is "done" actually done.

> **Status: 0.4.0, pre-1.0.** It installs and works in all three harnesses, and the claims below
> are measured, but so far only its author has used it. Expect the details to change before 1.0.
> [Where it stands](#where-it-stands) has the evidence.

## How it works

```text
  question set  +  items (files, a diff, log lines, rows, piped text)
        │
        ▼
  decide ─ reads and splits the items itself; nothing large goes through the agent's context
        │  leaves out secret-shaped files, scrubs secret-shaped strings, refuses oversize items
        ▼
  decision model (Jev, via OpenRouter) ─ one call per item, a probability for every answer
        │
        ▼
  thresholds ─ kept · undecided (too close to call) · dropped
        │
        ▼
  a short result: what to act on, what to read yourself, what it cost, live or replayed
```

A question has a name, a type and an instruction. Inline, that's `--question name:type:text`:

| Type | Asks | Answer |
|---|---|---|
| `noul` | Is this statement true of the item? | a probability, 0 to 1 |
| `choice` | Which of these keys fits? | a probability for each key |
| `score` | Which level on this scale? | a probability for each level |

An answer too flat to call is **undecided**. It is listed apart and never counted as kept or
dropped. [Concepts](docs/concepts.md) covers types, thresholds, sources and splits.

## Try it

From a terminal, no agent needed. You need Node 22 or newer and an [OpenRouter](https://openrouter.ai)
API key.

**1. Install the CLI and check it.**

```sh
npm i -g @garygentry/system1
decide doctor --format brief
```

`doctor` names each thing that's missing, with the fix. At this point it says
`SETUP NEEDED (key, consent)`.

**2. Give it your key.** Either export it, or put it in a file only you can read:

```sh
export OPENROUTER_API_KEY=sk-or-…
# or, once, for every shell:
mkdir -p ~/.config/system1
printf 'openrouter_api_key: %s\n' 'sk-or-…' > ~/.config/system1/credentials
chmod 600 ~/.config/system1/credentials
```

`decide` never prints the key and never reads your project's `.env`.

**3. Let this repo send content.** Once per repo, at its root:

```sh
decide config egress allow
```

That lets `decide` send the items it judges to the model, and nothing else. Secret-shaped files and
strings are still kept back ([what gets sent](#what-gets-sent-and-when)). Consent is recorded in
`.system1/config.yaml`. Only you grant it: an agent that runs this command is refused.

**4. Ask one question.**

```sh
decide ask --text 'rm -rf "$BUILD_DIR/"*' \
  --question 'destructive:noul:The command deletes or overwrites data.' \
  --keep 'destructive>=0.8' --format brief
```

```text
decide ask: text · live typesafe/jev-1.13-20260917 · 411 ms · $0.000012 measured
  destructive=0.98
verdict: kept
```

The same question about `ls -la "$BUILD_DIR"` gives `destructive=0.01`. Drop `--format brief` and
you get one JSON envelope (`{"v":1,"ok":true,"command":"ask","result":{…}}`) for scripts.

**5. Ask it of many items.** Point `decide` at files and keep only what matters:

```sh
decide many --glob 'packages/core/src/**/*.ts' \
  --question 'no_timeout:noul:The code makes a network request with no timeout or abort signal.' \
  --keep 'no_timeout>=0.5' --format brief
```

A real run over this repo, on 2026-09-22:

```text
decide many: 3 kept of 57 · 2 undecided · 52 dropped · live typesafe/jev-1.13 · $0.003521 measured · 2.6 s
kept:
  packages/core/src/decide.live.test.ts  no_timeout=0.75
  packages/core/src/ping.test.ts  no_timeout=0.71
  packages/core/src/tools/doctor.ts  no_timeout=0.66
undecided (too flat to judge; read these yourself):
  packages/core/src/decide.test.ts  no_timeout=0.43 UNDECIDED
  packages/core/src/tools/doctor.test.ts  no_timeout=0.53 UNDECIDED
redacted: 17 secret(s) in 5 item(s) before sending
```

`--keep` is the threshold, and `--format brief` is the readable form. The last line is the scrubber
reporting what it removed before anything was sent. Other sources are `--file`, `--diff <range>`,
`--staged`, `--jsonl` and `--stdin` ([CLI reference](docs/cli.md)).

Without a key, `decide` only replays answers recorded earlier, which is how the test suites here
run. `decide ping` checks the model is reachable, for free. [Getting started](docs/getting-started.md)
walks through all of this in more detail.

## Add it to your agent

The plugin teaches the agent when a judgement is closed enough to hand over, and how to phrase it
for `decide`. Install the CLI first (step 1 above), then the plugin:

| Harness | Plugin | Network |
|---|---|---|
| **Claude Code** | `/plugin marketplace add garygentry/system1`, then `/plugin install system1@system1` | allow `openrouter.ai` if the sandbox is on |
| **Codex** | `codex plugin marketplace add garygentry/system1`, then `codex plugin add system1@system1` | add `prefix_rule(pattern = ["decide"], decision = "allow")` to `$CODEX_HOME/rules/system1.rules` |
| **Pi** | `pi install npm:@garygentry/system1-pi` | no sandbox |

Then run the **setup** skill (`/system1:setup` in Claude Code, `$system1:setup` in Codex,
`/skill:setup` in Pi). It runs `decide doctor` and walks you through each fix, asking before it
changes anything.

In Claude Code, the plugin also brings its own `decide` launcher, so the agent works even without
the global install. But that `decide` is on Claude's PATH only: your terminal, CI and scripts need
`npm i -g @garygentry/system1`. Without it, grant consent from the Claude Code prompt with
`! decide config egress allow --confirm`.

### What's in the plugin

**Core skills** teach the agent to use `decide`:

| Skill | For |
|---|---|
| `ask` | The everyday call: screen many items, judge a long log or diff, check criteria against evidence, pick among candidates. Loads on its own when a task fits |
| `design` | Save a question that proved useful as a spec in your repo, with examples, and repair one that misbehaves |
| `setup` | Get from installed to live-ready, and diagnose what's missing. Runs only when you ask |

In Claude Code, a prompt hook also hints the `ask` skill when a prompt asks for a closed judgement.
It is local pattern matching and sends nothing ([routing hints](docs/routing-hints.md)).

**Packs** are workflows built on `decide` that run only when you ask for them:

| Pack | For | |
|---|---|---|
| `scout` | Find the places in your code and agent configuration where a decision model would pay off, and record them as a backlog | 0.4.0 ([scout](docs/scout.md)) |
| `guard` + `done-check` | An opt-in stop-time check of acceptance criteria against the diff | planned, 0.5.0 |
| `adopt` + `compare` | Turn a found opportunity into code with a fallback, and measure it against what it replaces | planned, 0.6.0 |

## Use it in your own project

Everything a repo needs lives in its `.system1/` directory, and none of it depends on the plugin.

- **Consent:** `.system1/config.yaml`, from `decide config egress allow`. Committing it shares the
  consent with everyone who clones the repo, so decide that as a team.
- **Specs:** a question that proved useful, saved as `.system1/specs/<name>.yaml` with its
  threshold and examples. Run it with `decide many --spec <name>`.
- **Fixtures:** recorded answers in `.system1/fixtures/<spec>/`. `decide spec check <name>` replays
  them offline, with no key and no network, so a spec can be tested in CI like any other code.

A spec, trimmed from the [cookbook](docs/cookbook.md)'s `destructive-command`:

```yaml
description: Gate a shell command before an agent runs it.
questions:
  destructive:
    type: noul
    instructions: Running this shell command deletes, overwrites or irreversibly changes data, version-control history or infrastructure that is not a disposable build artifact.
keep: ["destructive>=0.3"]
policy:
  thresholds:
    destructive:
      value: 0.3
      why: Only escalates to asking the user. A missed destructive command costs more than a needless question.
examples:
  - id: force-push
    state: git push --force origin main
    expect: { destructive: true }
  - id: near-miss-plain-push
    state: git push origin feature/login
    expect: { destructive: false }
```

For scripts, hooks and CI, every command prints one JSON envelope and has a stable exit code
(0 ok, 1 bug, 2 usage, 3 egress refused, 4 budget guard, 5 provider, 6 replay miss, 7 a check
that did not pass).
Branch on the exit code and `error.code`, never on the message.
[CI and scripts](docs/ci-and-scripts.md) has the patterns, and [specs](docs/specs.md) shows how to
write, record and check a spec.

## What gets sent, and when

Running `decide` live sends the text being judged (file contents, diff hunks, piped output) to the
model through OpenRouter, and only in a repo that has consented. Secret-shaped files are excluded,
secret-shaped strings are scrubbed, content outside the repo is withheld, and oversized content is
refused rather than truncated. Every answer says whether it is `live` or `replay`, a replay miss
is an error rather than an invented answer, and costs say whether they are measured or projected.
[Concepts](docs/concepts.md#what-gets-sent) has the details.

## Cost

The model is [Jev](https://openrouter.ai/typesafe/jev-1.13) (`typesafe/jev-1.13`) on OpenRouter.
It never writes text, and its output tokens are free, so cost scales with what you send: about
$0.00004 for a 700-token item, counting the ~300 tokens the provider adds to every call. The run
above cost about $0.00006 an item. A run above 200 calls or $0.05 stops at a projection until you
add `--confirm` ([spend](docs/spend.md)).

## Where it stands

[Evaluation](docs/evaluation.md) has every number with its method and caveats.

| Area | State |
|---|---|
| CLI and engine | Built and tested offline in CI on Ubuntu and macOS, Node 22 and 24 |
| Answer calibration | Close on yes/no questions that reading the text settles: Brier 0.028, calibration error 0.054, on two TypeScript repos with one AI labeller ([calibration](docs/calibration.md)) |
| Calibration elsewhere | **Not measured** for subjective questions, `choice`, `score`, other languages and other people's code. Treat those probabilities as rankings |
| Harnesses | Live decisions verified from the published packages in Claude Code, Codex and Pi, each release |
| The agent uses it when it should | Codex and Pi: every positive, no false triggers. Claude with the routing hook: 91% of positives on a blind set, no false triggers |
| Outside users | **None yet** |

## Known limits

- **One model, one provider.** Jev is the only model we know of that returns typed, calibrated
  answers to closed questions. If it were withdrawn or changed its API, live decisions would fail
  with a provider error. `decide` would not quietly switch to a general-purpose model, because the
  thresholds depend on calibration that a different model wouldn't share. Replay keeps working,
  so saved specs still run as offline tests.
- **Claude grades its own small diffs.** Asked to check a change it just wrote against criteria,
  Claude sometimes does it by reading instead of handing it off, even with the hint. The planned
  fix is the `done-check` hook ([details](docs/evaluation.md#routing-does-the-agent-reach-for-it)).
- **Not for everything.** Counting, arithmetic, dates, exact matching and anything that needs
  several documents reasoned together are jobs for code, not a decision model.
- **Pre-1.0.** The CLI's JSON envelope is versioned ([decision 0015](plans/decisions/0015-cli-contract-v1.md)),
  but there is no stability or deprecation policy yet, and `@garygentry/system1-core` has no
  documented API.

## Where it's going

Next is **M10**, `guard` + `done-check` (0.5.0), then **M11**, `adopt` + `compare` (0.6.0). After
those, 3–5 design partners try the whole chain on their own code (M12). The full plan and its
reasoning are in [`plans/ROADMAP.md`](plans/ROADMAP.md).

## Documentation

| Using `decide` | |
|---|---|
| [Getting started](docs/getting-started.md) | install, key, consent and a first decision |
| [Specs](docs/specs.md) | save a question as a spec, adopt a cookbook recipe, test it offline |
| [Cookbook](docs/cookbook.md) | tested specs to copy into your repo |
| [CI and scripts](docs/ci-and-scripts.md) | run `decide` without an agent |
| [Spend](docs/spend.md) | keep a large run within budget |
| [Troubleshooting](docs/troubleshooting.md) | every `doctor` check and error code, with the fix |

| Using the plugin | |
|---|---|
| [Tutorial: zero to first decisions](docs/tutorial.md) | a 20-minute hands-on lab in Claude Code: install, set up, then route 300 tickets and gate a risky script |
| [Scout](docs/scout.md) | find where a decision model would pay off in your code or agent config |
| [Routing hints](docs/routing-hints.md) | tune or turn off the Claude Code hint |

| Reference and evidence | |
|---|---|
| [CLI reference](docs/cli.md) | every command and flag, the output envelope and the exit codes |
| [Output](docs/output.md), [Configuration](docs/configuration.md), [Spec format](docs/spec-format.md) | the rest of the reference |
| [Concepts](docs/concepts.md) | question types, thresholds and undecided, live and replay, what gets sent |
| [Calibration](docs/calibration.md) | what the probabilities mean, and which threshold to use |
| [Evaluation](docs/evaluation.md) | everything we measured, including what didn't work |

## Packages

The repo ships two layers ([decision 0021](plans/decisions/0021-decide-is-the-product-one-repo-two-layers.md)):
the `decide` tool, and the plugin that teaches agents to use it. They are released together, at
one version.

| Layer | Package | What |
|---|---|---|
| Tool | [`@garygentry/system1`](https://www.npmjs.com/package/@garygentry/system1) | the `decide` CLI |
| Tool | [`@garygentry/system1-core`](https://www.npmjs.com/package/@garygentry/system1-core) | the engine the CLI runs on; published, but not yet a documented or stable API |
| Plugin | `plugins/system1/` | the skills and hook, installed through the Claude Code and Codex marketplaces |
| Plugin | [`@garygentry/system1-pi`](https://www.npmjs.com/package/@garygentry/system1-pi) | the same skills, packaged for Pi |

## Development

`pnpm install && pnpm check`. [`AGENTS.md`](AGENTS.md) has the layout, the rules (generated files,
egress, consent) and the commands. Also: [architecture](docs/architecture/README.md),
[running the plugin from a checkout](docs/contributing/local-plugin.md),
[cutting a release](docs/contributing/release.md), and [`plans/`](plans/) for the roadmap,
milestones and decision records.

## License

MIT
