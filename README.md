# System 1

**`system1`** — fast, cheap, typed judgement for coding agents.

Let a coding agent hand a **closed judgement** to a decision model instead of reading everything itself:

- which of these 300 grep hits actually match the rule;
- which CI failures are flaky, real or infrastructure;
- is this command destructive;
- is "done" actually done.

A decision model answers with a typed probability in about 300 ms, and its output tokens are free. Cost scales with what you send: about **$0.00003 for a 700-token item** at Jev's listed price, so the 57-file run below came to $0.0035 — about $0.00006 an item. The first supported model is [Jev](https://openrouter.ai/typesafe/jev-1.13) on OpenRouter.

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

Then, in the agent, run the **setup** skill (`/system1:setup` in Claude Code, `$system1:setup` in Codex, `/skill:setup` in Pi). It checks the install, the key, consent and network access, and walks you through whatever is missing. Or check it yourself:

```sh
decide doctor --format brief
```

### The API key

Live decisions need an OpenRouter key, as `OPENROUTER_API_KEY` or in `~/.config/system1/credentials`:

```yaml
openrouter_api_key: sk-or-…
```

`chmod 600` that file. Without a key, `decide` still replays answers recorded earlier, which is how the test suites here run.

## What gets sent, and when

Running `decide` live sends the text being judged (file contents, diff hunks, piped output) to the decision model through OpenRouter. So:

- **Consent is per repo, and yours to give.** Nothing is sent until you run `decide config egress allow` in that repo. Agents are told never to run it for you.
- **Secret-shaped files are excluded** (`.env*`, keys, credentials and more), before anything leaves.
- **Secret-shaped strings are scrubbed** from everything that is sent.
- **Oversized content is refused, never truncated**, because a decision made on half an input is a wrong decision.
- **Every answer says where it came from**, `live` or `replay`, and a replay miss is an error rather than an invented answer.
- **Costs are labelled.** Projections say projected; measured costs come from the provider, and a run says so when the provider reported none.
- **Recorded answers hold the text that was sent.** `.system1/fixtures/` is how replay works offline. Read a fixture before committing or sharing it, the way you would a test fixture.

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
