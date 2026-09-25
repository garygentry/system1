# `system1` — Roadmap

**Status:** living document. Revision 4 (2026-09-24): after the readiness milestones (M7–M8), three feature milestones (M9–M11: `scout`, `guard`/`done-check`, `adopt`+`compare`) come before design partners ([0019](decisions/0019-scout-guard-adopt-before-partners.md)). Revision 3 (2026-09-23) made the line past 0.1.0 a readiness plan, not a feature plan. The envisioning brief is archived and is not built from.

## Context

**System 1** is a set of tools for coding agents. With them, an agent can send a *closed* question (pick one, rate this, yes/no) to a **decision model** instead of reading everything itself or asking a chat LLM. A decision model returns typed probabilities in about 300 ms for about $0.00003 per call.

The only supported model is Jev (`typesafe/jev-1.13`, on OpenRouter's `/api/alpha/decisions`). Others with the same calling convention are possible — the profile layer is data — but none is supported today, and that single-vendor risk is stated plainly rather than hedged (M8).

### Where we are

**Updated 2026-09-25 (0.4.0).** M9 is done: `scout` finds decision-model opportunities in code and agent configuration, and 0.4.0 ships it. M10 (`guard` and `done-check`) is next. Design partners moved to M12 ([0019](decisions/0019-scout-guard-adopt-before-partners.md)), and nobody but the author has used System 1 yet. `docs/evaluation.md` summarises every measurement.

**0.4.0, released and verified 2026-09-25** (tag `v0.4.0` on `45ebd4c`). The plan and its results are in [`milestones/M9-M11-scout-guard-adopt.md`](milestones/M9-M11-scout-guard-adopt.md).

- **What it adds (#10–#14):**
  - the `scout` skill with two signal tables that are replay-tested in CI;
  - `decide opportunities` (the backlog), `decide spec lint`, `--exclude` and `--keep-any`;
  - in `many`, an oversize item is skipped with the split to re-run it;
  - scrubbing of service tokens and environment-style credentials;
  - a retry on the provider's HTTP 529.
- **Evidence:**
  - scout ran unattended over two repos its questions weren't written against. It recorded 5 opportunities for $0.024 and $0.035 of decision calls, and the one miss became a new signal;
  - smoke passed 12/12;
  - `eval:routing all --repeat 3` was ok in every category, with scout never loading on its own.
- **Gates:** `pnpm check` (578 tests), `release:check` 12/12, `bench:startup` at most +78 ms (the route hook +16 ms, which settles the 0.3.2 "watch").
- **Published artifacts, fresh profiles:** Claude (plugin only), Codex and Pi each installed 0.4.0 and ran a live `decide many`: 3 kept of 5, for $0.000076, $0.000070 and $0.000085 measured.
- **Found while releasing:**
  - The registry served the packages about 40 s after publishing, and `release:publish` reported that lag as a failure. It now waits up to 3 minutes.
  - A key taken from the credentials file with its YAML quotes gave a provider 401, "Missing Authentication header". Follow-up: `decide` should strip or flag a quoted `OPENROUTER_API_KEY`.


**0.3.2, released and verified 2026-09-24** (tag `v0.3.2` on `ab29a02`). It came out of walking setup and a first run end to end in Claude Code.

- **What it fixes (#5):**
  - Consent can be granted from Claude Code's `!` prompt, which has no TTY, with `--confirm` typed by the user. Agent-read messages never carry that form.
  - Dry runs count the ~300 input tokens the provider adds to every call. A 300-ticket run had projected $0.0026 against $0.0055 measured.
- **Alongside it:** `pnpm dev:link` loads the plugin from a checkout (#4), and a hands-on tutorial lab pinned to this tag (#6).
- **Gates:** `pnpm check` (510 tests), `release:check` 12/12, smoke 9/9, and one `eval:routing all` run at 100% in every category on all three harnesses.
- **Published artifacts, fresh profiles:**
  - Claude, Codex and Pi each ran a live `decide many` from a prompt that doesn't name the skill: 3 kept of 5, at $0.000075, $0.000070 and $0.000082 measured.
  - The Claude hook stayed silent until the first `decide` call and hinted after it. That first call fetched the CLI through npx in 3.7 s.
- **Watch:** `bench:startup` read `route --hook` at +178 ms over bare node, over the 150 ms target. 0.3.1 measured the same on the same machine that day (272 ms against 278 ms end to end), with bare `node -e 0` itself at 92–150 ms, so it is not a regression. Re-measure on a quiet machine.

*As written at 0.1.0:* 0.1.0 is on npm and installs in all three harnesses. The engine and the CLI surface are in good shape. What is missing is not features — it is **evidence, onboarding and outside users**. Nobody outside this machine has used it, and the load-bearing word in the pitch ("calibrated") is one we repeat from the provider rather than one we have measured. The milestones below are ordered to fix that, in that order.

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
| 0006 | ~~Native Pi extension for the tools~~. Pi uses the CLI plus skills like the other harnesses. A Pi extension is deferred until hooks need it; M10's hooks ship without one, so it is deferred past M13 (0019) | **superseded by 0013** |
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
| 0017 | Fan-out goes through `decide many`, not harness subagents. No skill dispatches a subagent | accepted |
| 0018 | A Claude-only `UserPromptSubmit` hook (`decide route`, configurable `route:`) hints the `ask` skill; the shared `ask` description is scoped precisely | accepted |
| 0019 | `scout`, `guard`/`done-check` and `adopt`+`compare` ship as M9–M11 (0.4.0–0.6.0) before design partners (now M12) | accepted |
| 0021 | `decide` is a product in its own right: one repo, two layers (the tool; the agent plugin with core skills and use-case packs). A global CLI install is the default in every harness | accepted |

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

> **Historical sketch (M0–M3).** Parts of this section never shipped or changed: there is no `decide fixtures` or `decide hook <pack>` command, no plugin `specs/` directory, no agents, and the Codex manifest is `.codex-plugin/plugin.json`. The architecture as built is in [`docs/architecture/`](../docs/architecture/README.md); the CLI contract is [0015](decisions/0015-cli-contract-v1.md).

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
| **M6** | Release 0.1.0 | **done 2026-09-22**, see `milestones/M6-release.md`. `@garygentry/system1`, `-core` and `-pi` published at 0.1.0 and tagged `v0.1.0`; `main` pushed to GitHub; five `gpt-6-astra` review passes ran on the release candidate and their fixes landed first. Renamed to System 1 ([0016](decisions/0016-name-system1.md)). Installs verified from the published artifacts in all three harnesses. The last box, a live decision *through the `ask` skill* in each harness, was blocked by a provider usage limit and closed in M7 (2026-09-23) |
| **M7** | Evidence: measure what we claim | **done 2026-09-23**, see `milestones/M7-evidence.md`. 478 pairs labelled blind (by one labeller, disclosed); checkable curve published in `docs/calibration.md` (Brier 0.028, ECE 0.054); threshold guidance derived from it; judgement questions reported as unmeasured. M6's last box closed: a live `ask` in each harness. The routing retry held Codex/Pi at 8/8 but not Claude, so it was reverted (gap 1) |
| **M8** | **Onboarding: the first hour works** | **done** 2026-09-23, **0.2.0 published**, see `milestones/M8-onboarding.md`. Six replay-tested cookbook recipes, `docs/` checked against the code by a test, six first-run stalls fixed across three harnesses, CI on Ubuntu and macOS (which found a real symlinked-path bug). A cookbook of tested question sets; `docs/`; a first-run and error-message pass; macOS verified and a CI matrix; the supported-model statement |
| **M9** | **`scout` → 0.4.0** | **done 2026-09-25, 0.4.0 released and verified**; see `milestones/M9-M11-scout-guard-adopt.md` ([0019](decisions/0019-scout-guard-adopt-before-partners.md)). Screen a codebase or agent configuration for decisions worth handing over; typed backlog via `decide opportunities`; offline `decide spec lint` |
| **M10** | **`guard` + `done-check` → 0.5.0** | **next**, same plan. Opt-in Stop hook, one verdict per acceptance criterion, block once then allow; addresses Known gap #1 for repos that opt in with a criteria file |
| **M11** | **`adopt` + `compare` → 0.6.0** | planned, same plan. TS/Python policy modules through the engine with fallback; shadow run against the current mechanism and an `emulated` baseline |
| M12 | **Design partners: 3–5 real users** (was M9) | outline, after M11 ([0019](decisions/0019-scout-guard-adopt-before-partners.md)). Recruit, watch them reach a first useful decision unaided, collect what breaks and what surprises, one fix round. The gate on any wider release. **M7 gate (D5): cleared 2026-09-23.** The user judged the checkable curve not bad, so calibration does not block this milestone |
| M13 | **Release** (was M10) | outline. Hygiene informed by M12 (CHANGELOG, CONTRIBUTING, SECURITY, issue templates), a stability and deprecation policy, the version decision, the public statement |
| — | *Post-release features:* `calibrate`, `sweep`, `pairs`, the `command-guard` and `loop-check` packs | Cut from the road to release (2026-09-23). `scout`, `adopt`, `compare` and `guard`/`done-check` were brought back as M9–M11 on 2026-09-24 ([0019](decisions/0019-scout-guard-adopt-before-partners.md)) |
| — | *Deferred:* MCP adapter over `core/tools` | Revisit if the sandbox/network friction or a shell-less host justifies it |

## Known gaps

Live limitations of the shipped product. Each says what is wrong, why it is not yet fixed, and what would fix it.

### 1. Claude does not hand off a review of its own work (routing, `ask`)

**Narrowed by the routing hook (0018), 2026-09-23; shipped just below the bar in 0.3.0, fixed for plugin-only installs in 0.3.1.** See the last entry below for the numbers. The history follows.

**The gap.** On the M6 routing evals Claude scores **6/8** on `ask` positives against a ≥ 7/8 bar. Codex and Pi score 8/8. Negatives are 8/8 everywhere.

**The shape of it.** Both misses are the same case: a **criteria check over a ~22-line diff Claude had just written** ("is the task in TASK.md done", and a pre-commit rules check). It hands off every batch task and both pick-from-many cases. It declines only when asked to re-check its own small diff. So this is not a model failing to understand the skill; it is a model declining to delegate grading its own work.

**Why it is still open.** Five rounds of description tuning. Round 5 led with "before you report a task done, check it with this skill rather than grading your own work": Claude went to 7/8, but Codex and Pi `ask` **negatives fell 8/8 → 5/8** — they began triggering on "write a function", "rename this function", "add a .gitignore entry". Over-triggering is the worse failure, because it spends money and sends code for tasks that need no judgement. The wording was reverted and 6/8 accepted for the release. Full data: `milestones/M6-release.md` § Routing evals.

**What would actually fix it.** Probably not a description. A description can only influence a model that is choosing, and this is a model choosing not to. The surface that does not depend on that choice is a **hook** — a Stop hook that fires regardless ("is done actually done"), which is what the deferred `guard` packs are for. This gap is now the first concrete justification for them. *(2026-09-24: the `done-check` pack is planned as M10, [0019](decisions/0019-scout-guard-adopt-before-partners.md).)*

**Do not re-litigate the wording without new evidence.** If it is retried, the guard rail that broke last time is the acceptance condition: **Codex and Pi negatives stay 8/8, or the change reverts.**

**Retried once in M7 (2026-09-23), and closed as a wording problem.** A fresh baseline gave 6/8 with different misses. A user-request trigger for criteria checks, moved into the first sentence, kept Codex and Pi at 8/8 each way but moved Claude to 5/8, so it was reverted. Claude's misses move between prompts from run to run. No more description rounds: this waits for the hook.

**Measured as noise, 2026-09-23 (post-0.2.0).** Six Claude runs on the unchanged description scored 6, 6, 6, 6, 5 and **7**/8 on `ask` positives (M6, the M7 baseline, the 0.2.0 run, and three new baselines), with negatives 8/8 every time. The pre-commit rules check missed in 4 of the 6, the TASK.md check in 3, and the 300-commit triage in 3; cleanup-plan and reviews missed once each. So Claude sits at about 6/8 ± 1 per run, and one run cannot tell a one-prompt change from noise: baseline 3 cleared the bar with no change at all. Every earlier description round was judged on a single run. The eval now takes `--repeat N` (`tools/evals/run.ts`), which judges the mean over N runs (at most N missed positives in total, every negative held in every run) and prints each prompt's hit rate. **Any further wording change is judged on `--repeat 3` or more**, for Claude and for the Codex/Pi guard rail alike.

**The hook, and a precise description (2026-09-23, [0018](decisions/0018-claude-routing-hook.md)).** Claude Code now runs `decide route --hook` on every prompt. That is local pattern matching, which sends nothing. When the prompt pairs a judging intent with something to judge, the hook adds a direct hint to load `system1:ask`. The trigger set went through two rounds: v1 was written against `routing.yaml`, and v2 was tuned on `routing-holdout.yaml` after v1 hinted only 3/12 of those blind prompts. Separately, blind near-miss negatives showed that the 0.2.0 description, which had stretched to reach Claude's own-diff checks, made **Codex and Pi over-trigger and actually run `decide`** on "run npm test", "commit this" and "summarise the diff". So the description was rescoped to one verdict per rule, and it now names what is not a handoff (75decd4). Codex and Pi were measured on ×3 runs and Claude on ×5; "pos" and "neg" are the total hits over all runs.

| Set | Claude, no hook | Claude + hook (final) | Codex, old → new desc | Pi, old → new desc |
|---|---|---|---|---|
| `routing.yaml` (tuning) | pos 28/40, neg 40/40 | pos **40/40**, neg 40/40 | pos 24/24, neg 24/24 | pos 24/24, neg 24/24 |
| `routing-holdout.yaml` (blind for v1; tuned on for v2) | not run | pos **53/60**, neg 60/60 | neg 24/36 → **36/36** (pos 36/36) | neg 22/36 → **36/36** (pos 36/36) |
| `routing-holdout-2.yaml` (blind judge) | pos 53/80, neg 80/80 | pos **73/80**, neg 80/80 | neg 32/48 → **48/48** (pos 48/48) | neg 36/48 → **48/48** (pos 48/48) |

**What this settles.** Claude no longer triggers on anything it shouldn't, on any set, and neither do Codex and Pi. On the blind judge set, Claude's positive hit rate went from 66% to 91%.

**What stays open.** Claude is **2 misses over the ≤ 5-miss bar on both held-out sets**. The user chose to ship it this way. The remaining misses:
- One prompt gets no hint ("My reviewer is strict about two things…", 0/5 on holdout-2). No pattern was added for it, because that would be tuning on the judge set.
- The other misses are prompts the hook did hint that Claude sometimes ignores. On holdout-1: the cleanup-plan line-by-line check 2/5, "about to open a PR… does test-output.log show" 2/5, and labelling commits 4/5. On holdout-2: "Tick off each item in TASK.md" 4/5 and the changelog triage 4/5.

**Disclosed peek.** The hint's wording was made direct after reading one holdout-2 miss ("Tick off each item…", hinted but ignored). Holdout-2 is therefore spent as a blind set.

**Released and verified (2026-09-23).** 0.3.0 was published and tagged. Codex and Pi then ran a live `ask` from the published artifacts (3 kept of 5, about $0.00008 each). Verifying Claude found a bug the evals could not see, because they run the checkout bundle: with only the plugin installed, which is the documented Claude install, the hook had no CLI to run. It never lets the shim download, so it stayed silent. **0.3.1** fixes this: the shim now runs its pinned version from npx's cache. The fix was verified on a fresh profile with the marketplace plugin and no global `decide`. The hook stayed silent until the first `decide` call and hinted after it. Given a prompt that doesn't name the skill ("Go through every file under src/ and flag the ones that make outbound network requests"), Claude then loaded `ask` and made a live `decide many` call ($0.000073 measured).

**Next lever, if this is reopened.** Judge any change on a new blind `routing-holdout-3.yaml`. Don't fit more regexes to the old sets. The step 0018 names is an opt-in hook that asks `decide` to classify the prompt itself. The Stop-hook `guard` pack remains the fix for Claude grading its own work unprompted, which a prompt hook cannot see.

### 2. ~~No live decision through the `ask` skill has been run per harness~~

**Closed in M7 (2026-09-23).** Claude, Codex and Pi each ran one live `ask` from the published 0.1.0 artifacts on a clean profile. Each chose `decide many`, kept the same 2 of 7 files, and cost about $0.0004 measured. See `milestones/M7-evidence.md` § Results.

### 3. "Calibrated" is measured only for checkable propositions

**Mostly closed in M7 (2026-09-23).** The checkable curve is measured and published in `docs/calibration.md` (Brier 0.028, ECE 0.054, two repos, one author), and the README cites it. Three things remain open. The labels come from one AI labeller: the human agreement pass was deferred, and the tooling for it is kept (`tools/calibration-agreement.ts`). The subjective questions produced degenerate single-labeller labels, so they are reported as unmeasured rather than as a curve. And the claim rests on two TypeScript repos by one author. A better-posed judgement set, and data from other people's code, are the ways to widen it. Design partners (M12) are the natural source of the second.

### 4. One model, one vendor

`typesafe/jev-1.13` on OpenRouter is the only profile. If it is withdrawn, live calls stop and `decide` replays recorded answers only. Accepted rather than hedged (2026-09-23); the README states it ("One model, one provider", M8). A second profile waits until a second suitable model exists.

### 5. macOS is unverified

**Narrowed in M8 (2026-09-23).** CI runs `pnpm check` on Ubuntu and macOS, on Node 22 and 24, plus the packed CLI on both. The first macOS run found and fixed a symlinked-path bug. What remains: the harnesses themselves are unverified on macOS (smoke is local and Linux-only, and needs GNU `timeout`). M12's partners on Macs are that check.

### Why this order

Each milestone removes the risk that would make the next one wasted work. Measuring calibration (M7) before writing docs (M8) means the docs can state a number instead of a disclaimer. Getting the first hour right (M8) before inviting partners means their feedback is about the product, not about a broken install. Partners (M12) before release hygiene (M13) means the CHANGELOG and the policy describe what people actually hit. [0019](decisions/0019-scout-guard-adopt-before-partners.md) puts scout, guard and adopt (M9–M11) ahead of partners, by the user's choice: partners then try the whole chain.

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
