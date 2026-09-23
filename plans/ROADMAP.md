# `system1` — Roadmap

**Status:** living document. Revision 3 (2026-09-23): 0.1.0 is published, and the line past it is a **readiness plan, not a feature plan**. The envisioning brief is archived and is not built from.

## Context

**System 1** is a set of tools for coding agents. With them, an agent can send a *closed* question (pick one, rate this, yes/no) to a **decision model** instead of reading everything itself or asking a chat LLM. A decision model returns typed probabilities in about 300 ms for about $0.00003 per call.

The only supported model is Jev (`typesafe/jev-1.13`, on OpenRouter's `/api/alpha/decisions`). Others with the same calling convention are possible — the profile layer is data — but none is supported today, and that single-vendor risk is stated plainly rather than hedged (M8).

### Where we are

0.1.0 is on npm and installs in all three harnesses. The engine and the CLI surface are in good shape. What is missing is not features — it is **evidence, onboarding and outside users**. Nobody outside this machine has used it, and the load-bearing word in the pitch ("calibrated") is one we repeat from the provider rather than one we have measured. The milestones below are ordered to fix that, in that order.

- **Background:**
  - `plans/archive/charter.md` — the 2026-09-21 envisioning brief. **Superseded and archived**; kept only because decision records cite its sections. Do not build from it.
  - `plans/repo-structure-guidance/`, research on repos that serve several agents.
  - `/home/gary/workspace/jev-poc`, the working proof of concept; now mainly a corpus for labelling and cookbook examples.
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

Carried over from the archived brief and still in force:
- the vocabulary (state, question set, primitives, policy, shape, undecided);
- its §3 principles;
- YAML specs in `.system1/specs/`, looked up in the repo and then at the user level.

No longer in force:
- **its phase order**, replaced 2026-09-23 by the readiness milestones below;
- **specs bundled with the plugin** — none are, and none will be until real use shows questions that recur across repos (M5, D1).

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
  plans/{ROADMAP.md, decisions/, milestones/, repo-structure-guidance/}
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
| **M6** | Release 0.1.0 | **done 2026-09-22**, see `milestones/M6-release.md`. `@garygentry/system1`, `-core` and `-pi` published at 0.1.0 and tagged `v0.1.0`; `main` pushed to GitHub; five `gpt-6-astra` review passes ran on the release candidate and their fixes landed first. Renamed to System 1 ([0016](decisions/0016-name-system1.md)). Installs verified from the published artifacts in all three harnesses. **One box left open:** the live decision *through the `ask` skill* per harness, blocked on a provider usage limit |
| **M7** | **Evidence: measure what we claim** | **next**, see `milestones/M7-evidence.md`. A labelled set, a measured reliability curve published with its scope, threshold guidance grounded in it, and the two boxes M6 left open |
| M8 | **Onboarding: the first hour works** | outline. A cookbook of tested question sets; `docs/`; a first-run and error-message pass; macOS verified and a CI matrix; the supported-model statement |
| M9 | **Design partners: 3–5 real users** | outline. Recruit, watch them reach a first useful decision unaided, collect what breaks and what surprises, one fix round. The gate on any wider release. **M7 gate (D5): cleared 2026-09-23.** The user judged the checkable curve not bad, so calibration does not block this milestone |
| M10 | **Release** | outline. Hygiene informed by M9 (CHANGELOG, CONTRIBUTING, SECURITY, issue templates), a stability and deprecation policy, the version decision, the public statement |
| — | *Post-release features:* `scout`, `adopt`, `compare`, `calibrate`, `sweep`, `pairs`, `guard` packs | Cut from the road to release (2026-09-23). None makes the core more trustworthy, and building them for a workflow no outsider has adopted is the wrong problem first. `scout` is planned in detail already: `plans/later-scout-opportunities.md` |
| — | *Deferred:* MCP adapter over `core/tools` | Revisit if the sandbox/network friction or a shell-less host justifies it |

## Known gaps

Live limitations of the shipped product. Each says what is wrong, why it is not yet fixed, and what would fix it.

### 1. Claude does not hand off a review of its own work (routing, `ask`)

**The gap.** On the M6 routing evals Claude scores **6/8** on `ask` positives against a ≥ 7/8 bar. Codex and Pi score 8/8. Negatives are 8/8 everywhere.

**The shape of it.** Both misses are the same case: a **criteria check over a ~22-line diff Claude had just written** ("is the task in TASK.md done", and a pre-commit rules check). It hands off every batch task and both pick-from-many cases. It declines only when asked to re-check its own small diff. So this is not a model failing to understand the skill; it is a model declining to delegate grading its own work.

**Why it is still open.** Five rounds of description tuning. Round 5 led with "before you report a task done, check it with this skill rather than grading your own work": Claude went to 7/8, but Codex and Pi `ask` **negatives fell 8/8 → 5/8** — they began triggering on "write a function", "rename this function", "add a .gitignore entry". Over-triggering is the worse failure, because it spends money and sends code for tasks that need no judgement. The wording was reverted and 6/8 accepted for the release. Full data: `milestones/M6-release.md` § Routing evals.

**What would actually fix it.** Probably not a description. A description can only influence a model that is choosing, and this is a model choosing not to. The surface that does not depend on that choice is a **hook** — a Stop hook that fires regardless ("is done actually done"), which is what the deferred `guard` packs are for. This gap is now the first concrete justification for them.

**Do not re-litigate the wording without new evidence.** If it is retried, the guard rail that broke last time is the acceptance condition: **Codex and Pi negatives stay 8/8, or the change reverts.**

### 2. No live decision through the `ask` skill has been run per harness

M6's one unticked acceptance box. Installs are verified from the published artifacts in all three harnesses, `pnpm smoke` proves the skill → CLI path in replay, and a live `decide many` proves the CLI's live path. What is unproven is the two together, in a real Codex and Pi session; the provider was over its usage limit on release night. Closes in M7.

### 3. "Calibrated" is measured only for checkable propositions

**Mostly closed in M7 (2026-09-23).** The checkable curve is measured and published in `docs/calibration.md` (Brier 0.028, ECE 0.054, two repos, one author), and the README cites it. Three things remain open. The labels come from one AI labeller: the human agreement pass was deferred, and the tooling for it is kept (`tools/calibration-agreement.ts`). The subjective questions produced degenerate single-labeller labels, so they are reported as unmeasured rather than as a curve. And the claim rests on two TypeScript repos by one author. A better-posed judgement set, and data from other people's code, are the ways to widen it. Design partners (M9) are the natural source of the second.

### 4. One model, one vendor

`typesafe/jev-1.13` on OpenRouter is the only profile. If it is withdrawn, live calls stop and `decide` replays recorded answers only. Accepted rather than hedged (2026-09-23); M8 states it in the README. A second profile waits until a second suitable model exists.

### 5. macOS is unverified

CI runs Ubuntu only, on one Node version. The smoke scripts need GNU `timeout`, carried over from M4. Most design partners will be on macOS, so this closes in M8, before M9.

### Why this order

Each milestone removes the risk that would make the next one wasted work. Measuring calibration (M7) before writing docs (M8) means the docs can state a number instead of a disclaimer. Getting the first hour right (M8) before inviting partners (M9) means their feedback is about the product, not about a broken install. Partners (M9) before release hygiene (M10) means the CHANGELOG and the policy describe what people actually hit.

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
3. ~~Can Codex plugins ship subagents (M7)?~~ **Moot for now:** [0017](decisions/0017-fan-out-through-the-cli-not-subagents.md) ships no subagents at all — fan-out goes through `decide many`, which every harness can run. The question returns only if a sweep needs judgement the signal tables cannot express. ~~How does Pi mark a skill user-only~~ **Answered in M0:** Pi honours `disable-model-invocation`.
4. ~~Which generic specs go into v1 (M5)?~~ **Answered in M5:** none. Ad-hoc questions are the main path, and specs are saved in the user's repo through `design`. Revisit once real use shows questions that recur across repos.
5. ~~Should `system1-core` be published separately or bundled into the CLI (M6)?~~ **Answered in M6:** published separately, alongside the CLI (whose bundle still inlines it) and a Pi package.
6. ~~Is a separate Pi npm package needed?~~ **Answered in M6:** yes, a slim `@garygentry/system1-pi` is published, so `pi install npm:…` pulls no devDependencies. **Closed in M6:** installing from the pushed GitHub repo works in all three harnesses too, so the Pi package is the documented path rather than the only one.
7. ~~**New in M0:** neither Codex nor Pi puts plugin `bin/` on PATH. How does a user get `decide` there?~~ **Answered in M4:** `npm i -g @garygentry/system1@<version>`. `decide doctor` detects the gap and prints that command, and the shim falls back to a global install before `npx`. `setup` may run the install with consent (M5). Publishing is M6.

## Verification

- `pnpm typecheck && pnpm test` runs offline against fixtures.
- `pnpm generate && git diff --exit-code`.
- `claude plugin validate plugins/system1 --strict`, plus an Agent Plugins schema check of `plugin.json`.
- `tools/smoke/{claude,codex,pi}.sh` run headless and assert that the agent ran `decide` through the skill (replay mode) and got a parsed result.
- A live suite runs only when `OPENROUTER_API_KEY` is set, records fixtures and reports measured cost.
