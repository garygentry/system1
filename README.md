# System 1

**`system1`** — fast, cheap, typed judgement for coding agents.

Let a coding agent hand a **closed judgement** to a decision model instead of reading everything itself:

- which of these 300 grep hits actually match the rule;
- which CI failures are flaky, real or infrastructure;
- is this command destructive;
- is "done" actually done.

A decision model answers with a typed probability in about 300 ms, and its output tokens are free. Cost scales with what you send: about **$0.00003 for a 700-token item** at Jev's listed price, so the 57-file run below came to $0.0035 — about $0.00006 an item. The only supported model is [Jev](https://openrouter.ai/typesafe/jev-1.13) on OpenRouter ([why, and what if it goes away](#one-model-one-provider)).

The provider describes the probabilities as calibrated, and we checked that claim ourselves ([docs/calibration.md](docs/calibration.md)). On yes/no questions whose answer you can check by reading the content, the probabilities tracked observed frequencies closely: Brier 0.028 and calibration error 0.054 over a blind-labelled sample from two TypeScript repos (one AI labeller; the docs give the caveats). On subjective questions we could not measure it, so treat those numbers as rankings and set thresholds on your own data.

It works in **Claude Code, Codex and Pi**, and in any host that supports [Agent Skills](https://agentskills.dev). Hooks, CI and scripts call the same CLI.

## How it works

A skill teaches the agent *when* a judgement is closed enough to hand over and *how* to ask it. The agent runs the `decide` CLI, which reads and splits the content itself, so nothing large is pasted into the conversation. The CLI returns only what the agent will act on: what passed the threshold, and what was too uncertain to call.

```sh
# Screen every file by a rule, keep what clears the threshold
decide many --glob 'packages/core/src/**/*.ts' \
  --question 'no_timeout:noul:The code makes a network request with no timeout or abort signal.' \
  --keep 'no_timeout>=0.5' --format brief
```

A real run over this repo, on 2026-09-22:

```
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

Undecided items are listed apart and never counted as kept or dropped: read those yourself. The last line is the scrubber reporting what it removed before anything was sent.

Three skills ship with it:

| Skill | For |
|---|---|
| `ask` | The everyday call: screen many items, judge a long log or diff, check criteria against evidence, pick among candidates |
| `design` | Save a question that proved useful as a spec in your repo, with examples, and repair one that misbehaves |
| `setup` | Get from installed to live-ready, and diagnose what's missing |

For common judgements there are ready-made, tested specs in the [cookbook](docs/cookbook.md): network calls with no timeout, swallowed errors, secrets in logs, destructive commands, CI failure triage, and a pre-"done" check. Copy one into `.system1/specs/` and run it.

## Install

The CLI needs Node 22 or newer.

| Harness | Plugin | `decide` on PATH | Network |
|---|---|---|---|
| **Claude Code** | `/plugin marketplace add garygentry/system1`, then `/plugin install system1@system1` | comes with the plugin | allow `openrouter.ai` if the sandbox is on |
| **Codex** | `codex plugin marketplace add garygentry/system1`, then `codex plugin add system1@system1` | `npm i -g @garygentry/system1` | add `prefix_rule(pattern = ["decide"], decision = "allow")` to `$CODEX_HOME/rules/system1.rules` |
| **Pi** | `pi install npm:@garygentry/system1-pi` | `npm i -g @garygentry/system1` | no sandbox |

Then, in the agent, run the **setup** skill (`/system1:setup` in Claude Code, `$system1:setup` in Codex, `/skill:setup` in Pi). It checks the install, the key, consent and network access, and walks you through whatever is missing. Or check it yourself with `decide doctor --format brief`.

Two things are yours to do: set an [OpenRouter](https://openrouter.ai) key (`OPENROUTER_API_KEY`, or `~/.config/system1/credentials`), and agree, once per repo, to content being sent (`decide config egress allow`, run by you, never by the agent). [Getting started](docs/getting-started.md) walks through both. Without a key, `decide` still replays answers recorded earlier, which is how the test suites here run.

## What gets sent, and when

Running `decide` live sends the text being judged (file contents, diff hunks, piped output) to the decision model through OpenRouter, and only in a repo that has consented. Secret-shaped files are excluded, secret-shaped strings are scrubbed, content outside the repo is withheld, and oversized content is refused rather than truncated. Every answer says whether it is `live` or `replay`, a replay miss is an error rather than an invented answer, and costs say whether they are measured or projected. [Concepts](docs/concepts.md#what-gets-sent) has the details.

## Documentation

| Page | For |
|---|---|
| [Getting started](docs/getting-started.md) | install, key, consent and a first decision |
| [Concepts](docs/concepts.md) | question types, thresholds and undecided, live and replay, sources, specs, what gets sent |
| [Cookbook](docs/cookbook.md) | tested specs to copy into your repo |
| [Calibration](docs/calibration.md) | what the probabilities mean, and which threshold to use |
| [CLI reference](docs/cli.md) | every command and flag, the output envelope and the exit codes |
| [Troubleshooting](docs/troubleshooting.md) | every `doctor` check and error code, with the fix |

## One model, one provider

The only supported model is [Jev](https://openrouter.ai/typesafe/jev-1.13) (`typesafe/jev-1.13`), reached through OpenRouter. System 1 depends on a model that returns typed, calibrated answers to closed questions, and today Jev is the only such model we know of. The engine is built around model profiles, so a second model can be added once a suitable one exists, and the calibration check would be rerun for it.

If Jev were withdrawn or changed its API, live decisions would fail with a provider error, and `decide` would not quietly switch to a general-purpose model: that would give answers without the calibration the thresholds rely on. Replay would keep working, so saved specs and their recorded answers would still run as offline tests.

## Packages

| Package | What |
|---|---|
| [`@garygentry/system1`](https://www.npmjs.com/package/@garygentry/system1) | the `decide` CLI |
| [`@garygentry/system1-core`](https://www.npmjs.com/package/@garygentry/system1-core) | the engine as a library: model profiles, transport, sources, fixtures, spend |
| [`@garygentry/system1-pi`](https://www.npmjs.com/package/@garygentry/system1-pi) | the skills, packaged for Pi |

## Development

See [`AGENTS.md`](AGENTS.md). In short: `pnpm install && pnpm check`. Plans and decision records live in [`plans/`](plans/).

## License

MIT
