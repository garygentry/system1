# System 1

**`system1`** lets a coding agent hand a **closed judgement** (yes/no, pick one, rate this) to a
decision model, and get back a typed probability instead of reading everything itself.

- which of these 300 grep hits actually break the rule;
- which CI failures are flaky, real or infrastructure;
- is this command destructive;
- is "done" actually done.

It ships as one plugin for **Claude Code, Codex and Pi**, plus the `decide` CLI that the plugin's
skills, and your own hooks, CI and scripts, all call.

> **Status: 0.3.1, early and pre-1.0.** It installs and works in all three harnesses, and the
> claims below are measured. But so far only its author has used it. The next milestone is putting
> it in front of 3–5 outside users. Expect rough edges, and expect the details to change before
> 1.0. [Where it stands](#where-it-stands) and [where it's going](#where-its-going) say more.

## What it does

A skill teaches the agent *when* a judgement is closed enough to hand over, and *how* to ask it.
The agent runs `decide`, which reads and splits the content itself, so nothing large is pasted
into the conversation. `decide` returns only what the agent will act on: what passed the
threshold, and what was too uncertain to call.

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

Undecided items are listed apart and never counted as kept or dropped. The last line is the
scrubber reporting what it removed before anything was sent.

The model is [Jev](https://openrouter.ai/typesafe/jev-1.13) (`typesafe/jev-1.13`) on OpenRouter.
It never writes text, and its output tokens are free, so cost scales with what you send: about
$0.00004 for a 700-token item, counting the ~300 tokens the provider adds to every call. That run
cost about $0.00006 an item.

Three skills ship with it:

| Skill | For |
|---|---|
| `ask` | The everyday call: screen many items, judge a long log or diff, check criteria against evidence, pick among candidates |
| `design` | Save a question that proved useful as a spec in your repo, with examples, and repair one that misbehaves |
| `setup` | Get from installed to live-ready, and diagnose what's missing |

The [cookbook](docs/cookbook.md) has six tested specs to copy: network calls with no timeout,
swallowed errors, secrets in logs, destructive commands, CI failure triage, and a pre-"done" check.

## Where it stands

What is built, and what backs each claim. [Evaluation](docs/evaluation.md) has every number with
its method and caveats.

| Area | State | Evidence |
|---|---|---|
| CLI and engine | Built: `ask`, `many`, specs, replay, spend guard, egress checks, `doctor` | Offline test suite with a docs-against-code check, in CI on Ubuntu and macOS, Node 22 and 24 |
| Answer calibration | Close, on yes/no questions that reading the text settles: Brier 0.028, calibration error 0.054 | Blind-labelled sample from two TypeScript repos by one author, **one AI labeller** ([calibration](docs/calibration.md)) |
| Calibration elsewhere | **Unknown** for subjective questions, `choice`, `score`, other languages and other people's code | Not measured. Treat those numbers as rankings |
| Harnesses | Live decisions verified from the published packages in Claude Code, Codex and Pi | One live run per release per harness, same files kept in each |
| Agent uses it when it should | Codex and Pi: every positive, no false triggers. Claude with the routing hook: 91% of positives on a blind set, no false triggers | Repeated eval runs. Claude still misses some checks of its own work |
| First hour | A new user reaches a live decision. Six first-run stalls were found and fixed | Walked by the author in each harness, on Linux |
| macOS | CLI verified in CI. Harnesses unverified | — |
| Outside users | **None yet** | Next milestone |

The honest short version: the machinery works and is tested, and on one kind of question the
probabilities are measurably trustworthy. Beyond that kind of question, we haven't measured, and
nobody but the author has used it on their own code.

## Install

The CLI needs Node 22 or newer.

| Harness | Plugin | `decide` on PATH | Network |
|---|---|---|---|
| **Claude Code** | `/plugin marketplace add garygentry/system1`, then `/plugin install system1@system1` | comes with the plugin | allow `openrouter.ai` if the sandbox is on |
| **Codex** | `codex plugin marketplace add garygentry/system1`, then `codex plugin add system1@system1` | `npm i -g @garygentry/system1` | add `prefix_rule(pattern = ["decide"], decision = "allow")` to `$CODEX_HOME/rules/system1.rules` |
| **Pi** | `pi install npm:@garygentry/system1-pi` | `npm i -g @garygentry/system1` | no sandbox |

Scripts, hooks and CI need only the CLI: `npm i -g @garygentry/system1`.

Then, in the agent, run the **setup** skill (`/system1:setup` in Claude Code, `$system1:setup` in
Codex, `/skill:setup` in Pi), or check it yourself with `decide doctor --format brief`.

Two things are yours to do: set an [OpenRouter](https://openrouter.ai) key (`OPENROUTER_API_KEY`,
or `~/.config/system1/credentials`), and agree, once per repo, to content being sent
(`decide config egress allow`, run by you, never by the agent). Without a key, `decide` still
replays answers recorded earlier, which is how the test suites here run.
[Getting started](docs/getting-started.md) walks through all of it, and the
[tutorial](docs/tutorial.md) is a hands-on lab that does it end to end.

In Claude Code the plugin also adds a prompt hook that hints the `ask` skill when a prompt asks for
a closed judgement. It is local pattern matching and sends nothing.
[Routing hints](docs/routing-hints.md) shows how to tune it or turn it off.

## What gets sent, and when

Running `decide` live sends the text being judged (file contents, diff hunks, piped output) to the
model through OpenRouter, and only in a repo that has consented. Secret-shaped files are excluded,
secret-shaped strings are scrubbed, content outside the repo is withheld, and oversized content is
refused rather than truncated. Every answer says whether it is `live` or `replay`, a replay miss
is an error rather than an invented answer, and costs say whether they are measured or projected.
[Concepts](docs/concepts.md#what-gets-sent) has the details.

## Known limits

- **One model, one provider.** Jev is the only model we know of that returns typed, calibrated
  answers to closed questions. If it were withdrawn or changed its API, live decisions would fail
  with a provider error. `decide` would not quietly switch to a general-purpose model, because the
  thresholds depend on calibration that a different model wouldn't share. Replay keeps working,
  so saved specs still run as offline tests. The engine uses model profiles, so a second model
  can be added, and re-measured, once one exists.
- **Claude grades its own small diffs.** Asked to check a change it just wrote against criteria,
  Claude sometimes does it by reading instead of handing it off, even with the hint. A hook that
  fires when the agent stops is the planned fix ([details](docs/evaluation.md#routing-does-the-agent-reach-for-it)).
- **Not for everything.** Counting, arithmetic, dates, exact matching and anything that needs
  several documents reasoned together are jobs for code, not a decision model.
- **Pre-1.0.** The CLI's JSON envelope is versioned ([decision 0015](plans/decisions/0015-cli-contract-v1.md)),
  but there is no stability or deprecation policy yet, and `@garygentry/system1-core` has no
  documented API.

## Where it's going

The plan past 0.1.0 was about readiness (M7–M8). The next three milestones add the developer-facing surfaces, before design partners try the whole chain ([decision 0019](plans/decisions/0019-scout-guard-adopt-before-partners.md)). [`plans/ROADMAP.md`](plans/ROADMAP.md) has the
full plan and the reasoning.

| | Milestone | State |
|---|---|---|
| M0–M6 | Engine, CLI, skills, three harnesses, first release | Done (0.1.0) |
| M7 | Evidence: measure the calibration claim instead of repeating the vendor's | Done |
| M8 | Onboarding: docs, a tested cookbook, the first-hour fixes, CI on macOS | Done (0.2.0). The routing hook followed in 0.3.x |
| M9 | `scout`: find the places in your code and agent configuration where a decision model would pay off | Done (0.4.0) |
| **M10** | **`guard` + `done-check`:** an opt-in stop-time check of acceptance criteria against the diff | **Next** (0.5.0) |
| M11 | **`adopt` + `compare`:** turn a found opportunity into code with a fallback, and measure it against what it replaces | Planned (0.6.0) |
| M12 | **Design partners:** 3–5 outside users reach a first useful decision unaided, and what breaks gets fixed | After M11 |
| M13 | Release: CHANGELOG, CONTRIBUTING, SECURITY, a stability and deprecation policy, the version decision | After M12 |

**After release, not before.** These are designed but deliberately not being built until outside
users have adopted the core: `calibrate`, `sweep`, `pairs`, and the `command-guard` and
`loop-check` hook packs. An MCP server is deferred in favour
of the CLI ([decision 0013](plans/decisions/0013-cli-first-mcp-deferred.md)). The measurement gaps
above (subjective questions, `choice` and `score`, other people's code, a second labeller) are
most likely to close with design partners' data.

## Documentation

| Page | For |
|---|---|
| [Tutorial: zero to first decisions](docs/tutorial.md) | a 20-minute hands-on lab in Claude Code: install, set up, then route 300 tickets and gate a risky script |
| [Getting started](docs/getting-started.md) | install, key, consent and a first decision |
| [Specs](docs/specs.md) | save a question as a spec, adopt a cookbook recipe, test it offline |
| [Scout](docs/scout.md) | find where a decision model would pay off in your code or agent config |
| [CI and scripts](docs/ci-and-scripts.md) | run `decide` without an agent |
| [Routing hints](docs/routing-hints.md) | tune or turn off the Claude Code hint |
| [Spend](docs/spend.md) | keep a large run within budget |
| [CLI reference](docs/cli.md) | every command and flag, the output envelope and the exit codes |
| [Output](docs/output.md), [Configuration](docs/configuration.md), [Spec format](docs/spec-format.md) | the rest of the reference |
| [Cookbook](docs/cookbook.md) | tested specs to copy into your repo |
| [Troubleshooting](docs/troubleshooting.md) | every `doctor` check and error code, with the fix |
| [Concepts](docs/concepts.md) | question types, thresholds and undecided, live and replay, what gets sent |
| [Calibration](docs/calibration.md) | what the probabilities mean, and which threshold to use |
| [Evaluation](docs/evaluation.md) | everything we measured, including what didn't work |

For maintainers: [architecture](docs/architecture/README.md),
[running the plugin from a checkout](docs/contributing/local-plugin.md),
[cutting a release](docs/contributing/release.md), [`AGENTS.md`](AGENTS.md) (layout, rules, commands) and [decision records](plans/decisions/).

## Packages

| Package | What |
|---|---|
| [`@garygentry/system1`](https://www.npmjs.com/package/@garygentry/system1) | the `decide` CLI |
| [`@garygentry/system1-core`](https://www.npmjs.com/package/@garygentry/system1-core) | the engine the CLI runs on; published, but not yet a documented or stable API |
| [`@garygentry/system1-pi`](https://www.npmjs.com/package/@garygentry/system1-pi) | the skills, packaged for Pi |

## Development

`pnpm install && pnpm check`. See [`AGENTS.md`](AGENTS.md) for the rules (generated files, egress,
consent) and [`plans/`](plans/) for the roadmap, milestones and decision records.

## License

MIT
