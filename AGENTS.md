# AGENTS.md — working on the `decisions` repo

This repo is a set of tools that let coding agents hand *closed* judgements (choose one option, give a score, answer yes/no) to a **decision model** (Jev first), and get back typed, calibrated answers. It ships one plugin that works in Claude Code, Codex and Pi. The `decide` CLI is the only execution surface. There is no MCP server; see `plans/decisions/0013-cli-first-mcp-deferred.md`.

Before starting, read `plans/ROADMAP.md`, then the current `plans/milestones/Mn-*.md`. `plans/charter.md` is background, not a spec; ratified choices live in `plans/decisions/`.

## Layout

| Path | What it is |
|---|---|
| `packages/core` | `@garygentry/decisions-core`, the engine library (model profiles, transport, sources, fixtures, spend) |
| `packages/cli` | `@garygentry/decisions`, the `decide` CLI (`bin.ts` entry, `main.ts` testable core, `commands/*`) |
| `plugins/decisions/skills/` | Agent Skills, authored once and shared by every harness |
| `plugins/decisions/{plugin.json,.claude-plugin,.codex-plugin,bin/decide}` | **Generated** |
| `.claude-plugin/`, `.agents/plugins/` | **Generated** marketplaces (Claude Code, Codex) |
| `catalog.yaml` | Source of truth for names, version, descriptions and npm scope |
| `tools/generate.ts`, `tools/validate.ts`, `tools/smoke/` | Generator, structural validator, headless harness smoke tests |

## Rules

- **Never edit generated files.** Change `catalog.yaml` or `tools/generate.ts`, then run `pnpm generate`. CI runs `pnpm generate:check`. The generator also stamps the version into every `package.json` and into `packages/core/src/version.ts`.
- **Skills stay harness-neutral.** Stick to the Agent Skills frontmatter (`name` matches the directory, plus `description`). Frontmatter that Claude and Pi honour and other hosts ignore, such as `disable-model-invocation`, is fine. Codex-only policy goes in `agents/openai.yaml`. In the body, tell the agent to run `decide …` and describe intent; don't name a harness's tools.
- **Skills never call HTTP.** Everything goes through `decide`, which is a thin adapter over `packages/core`.
- **CLI contract** ([0015](plans/decisions/0015-cli-contract-v1.md)): one JSON envelope `{v, ok, command, result|error}` per command; exit codes 0 ok, 1 bug, 2 usage, 3 egress refused, 4 budget guard, 5 provider, 6 replay miss. Tools are defined once in `packages/core/src/tools/` (TypeBox input schema + handler); the CLI only maps argv and formats. A breaking change bumps `ENVELOPE_VERSION` and needs a decision record.
- **Consent is the user's.** Never run `decide config egress allow --confirm` unless the user explicitly asked you to in this conversation.
- **Egress:** every path to the provider goes through `prepare()` (excludes → scrub → size) and a decider built with `egressConsent`. Consent lives only in `<repo>/.decisions/config.yaml`. Never add a way to send content that skips these checks.
- **Config layering:** defaults → `$XDG_CONFIG_HOME/decisions/config.yaml` → `<repo>/.decisions/config.yaml` → env (`OPENROUTER_API_KEY`, `DECISIONS_MODEL`, `DECISIONS_ENDPOINT`, `DECISIONS_REPLAY`, `DECISIONS_SESSION`). Tests that load config must pass a temp `home` so they never read the real user config.
- **Honest numbers:** label projected costs as projected. Every answer carries its `source` (`live` or `replay`). A replay miss is an error, never a synthesized answer.
- **Secrets:** never print or log `OPENROUTER_API_KEY`; report only whether it is present. The engine and CLI never read a `.env` file (a project's `.env` belongs to that project); only `vitest.live.config.ts` loads this repo's.
- **Live tests** are named `*.live.test.ts`, are excluded from `pnpm test`, and must `skipIf` there is no key.

## Commands

```sh
pnpm install
pnpm check      # build · typecheck · lint · test · generate:check · validate (CI runs this)
pnpm generate   # after editing catalog.yaml or the generator
pnpm test:live  # one real decision call (~$0.00003); loads this repo's .env, skipped without a key
pnpm smoke      # local only: drives real Claude/Codex/Pi sessions (spends their tokens)
node packages/cli/dist/bin.js ping --format brief
node --env-file=.env packages/cli/dist/bin.js many --glob 'src/**/*.ts' --question 'q:noul:…' --keep 'q>=0.7' --format brief
```

Toolchain: Node ≥ 22, pnpm 10, TypeScript (NodeNext, `tsc -b`), vitest, biome. Tests sit next to their source as `*.test.ts`, run offline, and use injected `fetch`.

## Harness notes (verified in M0, 2026-09-22)

- **Claude Code** puts plugin `bin/` on the Bash PATH, so `decide` resolves to the generated shim. Test with `claude -p --plugin-dir plugins/decisions`.
- **Codex** copies the plugin into its cache and does **not** put `bin/` on PATH, so users need `decide` installed globally. In the default sandbox the shell has no network. The narrow fix is a rules file with `prefix_rule(pattern = ["decide"], decision = "allow")`. `CODEX_HOME` must not be under `/tmp`.
- **Pi** reads skills through the root `package.json` `pi` key (`pi install <path>`). There is no sandbox and no plugin `bin/`, so `decide` also has to be on PATH. Pi honours `disable-model-invocation`.
