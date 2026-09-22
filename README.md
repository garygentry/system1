# decisions

Tools that let coding agents hand closed judgements to a **decision model** instead of reading everything themselves:

- which of these 300 grep hits are real;
- which test failures are flaky;
- is this command safe;
- is "done" actually done.

A decision model answers with a typed, calibrated probability in about 300 ms for about $0.00003, and its output is free. The first supported model is [Jev](https://openrouter.ai/typesafe/jev-1.13) on OpenRouter.

> **Status: pre-release (M0).** The packaging proof works in Claude Code, Codex and Pi. Decision commands arrive in M1–M5; see [`plans/ROADMAP.md`](plans/ROADMAP.md).

## How it works

A skill tells your agent *when* a decision model fits and *how* to call it. The agent runs the `decide` CLI, which reads and splits the content itself, so the agent never pastes large inputs. The CLI returns only the results the agent will act on. The same CLI serves hooks, CI and scripts.

## Install (development builds)

| Harness | Install |
|---|---|
| Claude Code | `/plugin marketplace add garygentry/decisions`, then `/plugin install decisions@decisions` |
| Codex | `codex plugin marketplace add garygentry/decisions`, then `codex plugin add decisions@decisions`; put `decide` on PATH; allow its network access (see `AGENTS.md`) |
| Pi | `pi install git:github.com/garygentry/decisions`; put `decide` on PATH |

Check your setup with `decide ping --format brief`, or ask your agent to use the **ping** skill.

## Development

See [`AGENTS.md`](AGENTS.md). In short: `pnpm install && pnpm check`.

## License

MIT
