# `system1` — Roadmap

**Status:** living document. Revision 2 (2026-09-22): the CLI is the only execution surface, and MCP is deferred ([0013](decisions/0013-cli-first-mcp-deferred.md)).

## Context

`decisions` is a set of tools for coding agents. With them, an agent can send a *closed* question (pick one, rate this, yes/no) to a **decision model** instead of reading everything itself or asking a chat LLM. A decision model returns typed, calibrated probabilities in about 300 ms for about $0.00003 per call.

The first model is Jev (`typesafe/jev-1.13`, on OpenRouter's `/api/alpha/decisions`). More models with the same calling convention are expected.

- **Background:**
  - `plans/charter.md`, the envisioning brief, which has not been ratified.
  - `plans/repo-structure-guidance/`, research on repos that serve several agents.
  - `/home/gary/workspace/jev-poc`, the working proof of concept that holds the code we reuse.
- **Targets:**
  - First-class: Claude Code, Codex and Pi.
  - Best effort: other hosts that support Agent Skills.

## Ratified decisions

Full records are in `plans/decisions/NNNN-*.md`. A superseded record is kept and marked as such.

| # | Decision | Status |
|---|---|---|
| 0001 | Engine in TypeScript on Node ≥ 22, ESM | accepted |
| 0002 | Distributed as an npm package with a pinned version. The **`decide` CLI** is what agents run | accepted (amended by 0013) |
| 0003 | Model layer is one transport plus model profiles that are only data. A new model with the same wire shape is a profile entry. `emulated` is a second transport in phase 3 | accepted |
| 0004 | v1 is charter phase 1 on all three first-class harnesses | accepted |
| 0005 | Monorepo: `packages/*` plus one authored plugin root at `plugins/system1/`. Per-harness manifests are generated | accepted |
| 0006 | ~~Native Pi extension for the tools~~. Pi uses the CLI plus skills like the other harnesses. A Pi extension is deferred until hooks need it (M10) | **superseded by 0013** |
| 0007 | Cursor, Copilot and other Agent Skills hosts are best effort | accepted |
| 0008 | GitHub `garygentry/system1`, npm `@garygentry` | accepted |
| 0009 | Egress consent is given once per repo. Excludes and scrubbing are always on. Hooks are opted into per pack | accepted |
| 0010 | With no key the tool only replays. A fixture miss is a typed error. Every result carries `source` | accepted |
| 0011 | Spend guard: anything above 200 calls or $0.05 returns a projection and needs `--confirm` | accepted |
| 0012 | Plans are tracked in `ROADMAP.md`, `milestones/Mn-*.md` and `decisions/NNNN-*.md` | accepted |
| **0013** | **The CLI is the only execution surface, driven by skills and agents. MCP is deferred** and may come back later as a thin adapter over the same `core/tools` | **accepted** |
| 0015 | CLI contract v1: the envelope, exit codes, `keep`/`sort` syntax, undecided before thresholds, and the consent guard on `egress allow` | accepted |
| **0016** | **The project is named System 1 (`system1`)**: GitHub, npm, plugin, `.system1/` and `SYSTEM1_*`. The command stays `decide`. Amends 0008 | **accepted** |
| 0014 | There is no live `command` source. Command output is piped into `--stdin`. The engine only ever spawns `git`, through `execFile` | accepted |

These are carried over from the charter unchanged:
- the vocabulary (state, question set, primitives, policy, shape, undecided);
- the principles in §3;
- YAML specs in `.system1/specs/`, looked up in the repo, then the user level, then the specs bundled with the plugin;
- the phase order.

## Why CLI rather than MCP (summary of 0013)

For this product, CLI plus skills is at least as capable as MCP, and usually cheaper:

- **State goes by reference.** The agent passes a spec name and a source (glob, diff, file), not large payloads. The CLI arguments stay short, and shell quoting stops being a real problem. Structured input still has `--input file.json` or `--input -` (stdin heredoc).
- **Context cost.** MCP tool schemas sit in every session's context whether or not they are used. A skill loads only its name and description until it is needed.
- **One engine and one contract.** Hooks, CI, scripts, `adopt`-generated code and the agent all call the same `decide`. An MCP server would be a second surface to version, test and keep in step.
- **Portability.** Every first-class harness has a shell. Pi's own guidance is "No MCP. Build CLI tools with READMEs (see Skills)". The Agent Skills standard is built around skills that run bundled or installed CLIs.
- **Output control.** Projection (`--keep/--sort/--limit/--fields`) and compact output formats apply equally. Both MCP results and Bash output are truncated by the host, so projection matters either way.

**What MCP would genuinely add, and how we cover it:**

| MCP advantage | Mitigation in the CLI design |
|---|---|
| Typed, schema-validated arguments | Schemas are defined once in TypeBox and validated inside the CLI. Errors come back as a typed JSON envelope. `decide schema <cmd>` prints the JSON Schema |
| A long-lived process (session spend meter, warm connections) | Spend is kept in a ledger, `.system1/usage.jsonl` (keyed by session id when the harness provides one). Cold start comes from a real install (the plugin `bin/` shim or a global install), not `npx` on every call. Aim: under 150 ms startup |
| **Runs outside the agent's sandbox.** MCP servers can reach the network when the shell can't. Codex `workspace-write` has network off by default, and Claude's sandbox needs a domain allowlist | **This is the one real gap.** Setup documents and checks the per-harness fix: an allowlisted `openrouter.ai` domain in Claude's sandbox; an approval/exec-policy rule or `network_access` for `decide` in Codex. M0 verifies it. It is the leading reason to add MCP back later |
| Hosts with no shell (claude.ai, desktop chat) | Out of scope. Coding agents only |
| Progress notifications and cancellation on long fan-outs | Progress goes to stderr, which is shown to the agent. SIGINT is honoured. The spend guard keeps fan-outs bounded |
| Per-tool permission grants | Command-pattern grants such as `Bash(decide *)` in Claude, and prefix rules in Codex. Setup can write these |

## Architecture

```
       plugin content (authored once): skills/{ask,design,setup} · specs/ · hooks (later)
                                    │  skills tell the agent to run `decide …`
          ┌─────────────────────────┼──────────────────────────┐
     Claude Code                  Codex                        Pi        (+ Agent Skills hosts)
          └─────────────────────────┼──────────────────────────┘
                                    ▼
                      `decide` CLI  (@garygentry/system1)   ◄── hooks · CI · scripts
                                    │
                      @garygentry/system1-core (library)
   tools/commands (harness-agnostic defs, TypeBox) · model profiles · transport · fixtures
   spend ledger/budget · sources + splitters · projection · spec loader · egress · config
```

**Rules:**
- Skills never call HTTP. They teach *when* and *how* to run `decide`.
- The CLI is a thin adapter over `core/tools`, so an MCP server or a Pi extension can be added later as a second thin adapter without changing the engine.

### CLI contract (ratified in M3; see [0015](decisions/0015-cli-contract-v1.md), which supersedes this sketch)

- **Commands:**
  - `decide ask` (single)
  - `decide many` (fanout)
  - `decide usage`
  - `decide config` (includes egress consent)
  - `decide spec {list,show,validate}`
  - `decide schema <cmd>`
  - `decide fixtures {record,replay}`
  - later: `sweep`, `pairs`, `hook <pack>`, `calibrate`
- **Input:**
  - `--spec <name>`, or inline `--question name:type:"…"` for quick asks, or `--input file|-`.
  - Sources: `--glob`, `--file path[:L1-L2]`, `--jsonl`, `--diff <range>`, `--text`, `--stdin`.
  - Splitters: `--split file|hunk|lines:N[/overlap]|row`.
- **Output:** a versioned, compact JSON envelope by default: `{v, source, model, usage, projected?, results|survivors, counts:{total,kept,undecided}, errors}`. There is also `--format jsonl|table|brief`.
  - `brief` is the agent-facing default inside skills: one line per survivor, with undecided items listed separately.
- **Exit codes:**
  - 0: ok
  - 2: usage/validation
  - 3: egress refused
  - 4: budget guard (the projection is printed)
  - 5: provider error
  - 6: replay miss
- **Flags:**
  - `--dry-run`, `--confirm`, `--record`, `--replay`, `--model`, `--concurrency`
  - Projection: `--keep`, `--sort`, `--limit`, `--fields`

### Harness matrix

| Component | Claude Code | Codex | Pi | Agent Skills hosts |
|---|---|---|---|---|
| Manifest | `.claude-plugin/plugin.json` (gen) | root `plugin.json` (Agent Plugins 1.0, `extensions."com.openai"`) (gen) | `packages/pi/package.json` `pi` key (skills only) | root `plugin.json` (gen) |
| Skills | `plugins/system1/skills/` (shared) | same, plus `agents/openai.yaml` sidecar for invocation policy | copied into the Pi package at pack time | same |
| `decide` on PATH | plugin `bin/decide` shim running the pinned install | `setup` installs globally, verified | same | same |
| Network from shell | sandbox domain allowlist, if sandboxing is on | exec-policy / approval rule, or `network_access` (verify in M0) | no sandbox | host-dependent |
| User-only skills | `disable-model-invocation: true` | `openai.yaml` `allow_implicit_invocation: false` | verify in M0 | — |
| Marketplace / install | root `.claude-plugin/marketplace.json` | root `.agents/plugins/marketplace.json` | `pi install npm:@garygentry/system1-pi` (or `git:`) | `npx skills add` |
| Agents (phase 2+) | `agents/*.md` (gen) | `.toml` (gen; whether a plugin can ship them is unverified) | subagent extension markdown (optional) | — |
| Hooks (phase 5) | `hooks/hooks.json` → `decide hook <pack>` | `com.openai.hooks` → same | Pi extension via `pi.on(...)` → core (deferred) | — |

Note on the Pi package: it now only carries the skills, and later the hooks extension. If `pi install git:` of the repo works with the root `package.json` `pi` key, a separate npm package may not be needed (M0).

## Repo layout (target after M0)

```
system1/
  AGENTS.md  CLAUDE.md(@AGENTS.md)  README.md  LICENSE
  catalog.yaml                   # names, version, descriptions, scope: source of truth for generation
  package.json  pnpm-workspace.yaml  tsconfig.base.json  biome.json  vitest.workspace.ts
  packages/
    core/  src/{model,transport,fixtures,run,sources,split,project,spec,egress,config,tools}/
    cli/   src/{main.ts, commands/*, format/*}          # bin: decide
    pi/    package.json (pi key → skills; extension later)
  plugins/system1/
    skills/{ask,design,setup}/SKILL.md (+ references/, agents/openai.yaml)
    specs/                       # generic specs
    bin/decide                   # generated shim (Claude PATH)
    plugin.json  .claude-plugin/plugin.json          # generated
    src/agents/  hooks/          # later phases
  .claude-plugin/marketplace.json  .agents/plugins/marketplace.json   # generated
  tools/{generate.ts, validate.ts, smoke/*.sh}
  plans/{charter.md, ROADMAP.md, decisions/, milestones/, repo-structure-guidance/}
  .github/workflows/ci.yml
```

No `mcp.json` or `.mcp.json` is generated in v1.

## Core design notes (refined per milestone)

- **Porting from jev-poc:**
  - `shared/jev.ts` → `core/model`. Price and floor move into the Jev profile.
  - `server/transport.ts` → `core/transport`. Config becomes explicit, and the header becomes `X-Title: system1`.
  - `server/concurrency.ts` → `core/run/pool`.
  - `server/spend.ts` → `core/run/spend`, rebuilt as an instance with a persisted ledger.
  - `server/fixtures.ts` → `core/fixtures`, content-addressed as `.system1/fixtures/<spec|adhoc>/<sha256>.json`, with no synthetic fallback.
  - `shared/baseline.ts` and `shared/assessment.ts` are kept for phase 3.
  - `src/demos/*/{demo,policy}.ts` feed the generic specs and the `design` references.
- **Sources (v1):**
  - inline text, stdin, file plus range, glob, JSONL, `git diff`;
  - a live `command` source is less risky in a CLI than in MCP (the agent's shell already runs it), so `cmd | decide many --stdin` covers it.
- **Splitters (v1):** file, hunk, line-window, row. A function splitter is phase 2.
- **Projection:**
  - `--keep` uses the shorthand `relevant.noul>=0.7` (ANDed when repeated);
  - `--sort`, `--limit`, `--fields`;
  - undecided items are always counted and listed separately.
- **Egress:** consent is recorded in `.system1/config.yaml`. The tool applies gitignore-style excludes plus defaults (`.env*`, `*.pem` and similar), and scrubs secrets with regexes. A state over the limit is refused, never truncated.
- **Config layering:** defaults → `~/.config/system1/config.yaml` → `.system1/config.yaml` → env (`OPENROUTER_API_KEY`, `SYSTEM1_ENDPOINT`, `SYSTEM1_MODEL`, `SYSTEM1_REPLAY`). The key can also live in `~/.config/system1/credentials` (mode 600), so the agent never has to handle it.

## Milestones (each about one session; the detailed doc is written at the start of that session)

| M | Title | Acceptance |
|---|---|---|
| **M0** | Bootstrap + packaging proof | **done 2026-09-22**, see `milestones/M0-bootstrap.md` |
| **M1** | Core: model, profiles, transport, fixtures, spend ledger | **done 2026-09-22**, see `milestones/M1-core-model-transport.md` |
| **M2** | Core: config, sources, splitters, egress, budget guard | **done 2026-09-22**, see `milestones/M2-sources-egress-budget.md` |
| **M3** | Tool definitions + spec format + CLI contract | **done 2026-09-22**, see `milestones/M3-tools-spec-cli.md` |
| **M4** | CLI hardening + harness wiring | **done 2026-09-22**, see `milestones/M4-cli-harness.md` |
| **M5** | Skills: ad-hoc asking, saved specs, setup | **done 2026-09-22**, see `milestones/M5-skills-specs.md`. `ask` (with the craft references), `design` (save and repair repo specs), `setup` (user-only, consent-gated). `--questions` and `spec check`. Routing evals meet the bar in Claude, Codex and Pi. No bundled specs |
| **M6** | Release 0.1.0 | **in progress**, see `milestones/M6-release.md`. Publish the CLI, core and a Pi package; push to GitHub; a comprehensive review by Codex `gpt-6-astra` on the release candidate before publishing; then install and one live decision per harness |
| M7 | Phase 2: `scout` + `opportunity-scout` + `question-critic`; agent generator | outline |
| M8 | Phase 3: `adopt`, `compare`, `shadow-evaluator`, `emulated` | outline |
| M9 | Phase 4: `calibrate`, `sweep`, `pairs` | outline |
| M10 | Phase 5: `guard` packs (Claude/Codex hooks → `decide hook`; Pi extension) | outline |
| — | *Deferred:* MCP adapter over `core/tools` | Revisit if the sandbox/network friction or a shell-less host justifies it |

**M0 acceptance:**
- **Setup:** git init, pnpm workspace, TS NodeNext, vitest, biome, `AGENTS.md`/`CLAUDE.md`, `catalog.yaml`.
- **Generator:** `tools/generate.ts` emits every manifest, both marketplaces and the `bin` shim. CI checks for drift.
- **Packaging proof:** a placeholder `ping` skill tells the agent to run `decide ping`, which does a network round trip to the endpoint's health/model listing. It must run from a headless session in:
  - Claude (`--plugin-dir`; `claude plugin validate --strict`);
  - Codex (local marketplace; `codex exec`), which proves the sandbox/network path;
  - Pi (`pi install` of a local path).
- It also records how Pi and Codex mark a skill as user-only.

## Open questions

1. ~~The `--keep` filter language~~ **Answered in M3:** the shorthand only, with the full tool input available as JSON through `--input` (0015).
2. ~~How to handle Codex sandbox network~~ **Answered in M0:** a narrow `prefix_rule(pattern=["decide"], decision="allow")` works under the default sandbox. **Answered in M4:** a plugin cannot ship it (none of 190 cached Codex plugins use anything but `skills`, `apps` and `mcpServers`). `decide doctor` prints the exact line and path. `setup` writes it to `$CODEX_HOME/rules/system1.rules` with consent (M5).
3. Can Codex plugins ship subagents (M7)? ~~How does Pi mark a skill user-only~~ **Answered in M0:** Pi honours `disable-model-invocation`.
4. ~~Which generic specs go into v1 (M5)?~~ **Answered in M5:** none. Ad-hoc questions are the main path, and specs are saved in the user's repo through `design`. Revisit once real use shows questions that recur across repos.
5. ~~Should `system1-core` be published separately or bundled into the CLI (M6)?~~ **Answered in M6:** published separately, alongside the CLI (whose bundle still inlines it) and a Pi package.
6. ~~Is a separate Pi npm package needed?~~ **Answered in M6:** yes, a slim `@garygentry/system1-pi` is published, so `pi install npm:…` pulls no devDependencies. Whether `pi install git:` of the pushed repo also works is checked during M6.
7. ~~**New in M0:** neither Codex nor Pi puts plugin `bin/` on PATH. How does a user get `decide` there?~~ **Answered in M4:** `npm i -g @garygentry/system1@<version>`. `decide doctor` detects the gap and prints that command, and the shim falls back to a global install before `npx`. `setup` may run the install with consent (M5). Publishing is M6.

## Verification

- `pnpm typecheck && pnpm test` runs offline against fixtures.
- `pnpm generate && git diff --exit-code`.
- `claude plugin validate plugins/system1 --strict`, plus an Agent Plugins schema check of `plugin.json`.
- `tools/smoke/{claude,codex,pi}.sh` run headless and assert that the agent ran `decide` through the skill (replay mode) and got a parsed result.
- A live suite runs only when `OPENROUTER_API_KEY` is set, records fixtures and reports measured cost.
