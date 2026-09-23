> [!WARNING]
> **Superseded. Archived 2026-09-23. Do not build from this document.**
>
> This was an envisioning brief, written 2026-09-21 to bootstrap an empty
> directory into a design. It was never ratified. The product was then designed
> for real, and diverged from it in ways that matter: the project is **System 1**,
> not `decisions` ([0016](../decisions/0016-name-system1.md)); the **CLI is the only
> execution surface** and there is no MCP server ([0013](../decisions/0013-cli-first-mcp-deferred.md));
> **nothing dispatches subagents** ([0017](../decisions/0017-fan-out-through-the-cli-not-subagents.md));
> and the milestone line past 0.1.0 is a readiness plan, not this document's phases.
>
> Current truth lives in [`plans/ROADMAP.md`](../ROADMAP.md) and
> [`plans/decisions/`](../decisions/). This file is kept only because fourteen
> decision records cite its section numbers.

# `decisions` — a Claude Code plugin for decision models

**Status:** design brief. Covers the plugin's shape and surface, not its implementation.
**Written:** 2026-09-21, from a read-through of `jev-poc` (20 demos, 7 shapes, recorded fixtures).
**For:** the session that builds the plugin package. This document is self-contained. Where it points into `jev-poc`, that code is there to be reused.

---

## 1. The bet, in one paragraph

A coding agent spends most of its tokens **reading things in order to make small decisions**:

- which of 300 grep hits are real;
- which test failures are flaky;
- which files matter to this goal;
- whether this command is safe;
- whether "done" is actually done.

Each of these is a closed question over some text. A chat model answers it with prose that has to be parsed. It costs input *and* expensive output tokens, and it takes seconds. A **decision model** answers the same question with a typed, calibrated probability. It runs in about 300 ms for about $0.00003, and its output is free. Jev (`typesafe/jev-1.13`) is the first such model. The plugin's job is to make the agent reach for one whenever a decision is closed, and to keep the thresholds in code where they can be tested. It also finds the places in existing code and skills where an LLM call or a hand-written heuristic is doing a decision model's job.

## 2. Naming

**Plugin name: `decisions`.** The model class is a **decision model**. That is the term OpenRouter already uses (modality `text->decisions`, endpoint `/api/alpha/decisions`), and it is vendor-neutral. The alternatives were rejected:

| Candidate | Why not |
|---|---|
| `jev` | Names one model. Others with the same shape are emerging. |
| `sysone` / `system-one` | TypeSafe's framing. Reads as branding, and is opaque to anyone else. |
| `judge` | Collides with "LLM-as-judge", which is the thing we are partly replacing. |
| `verdict` | Implies binary. Score and choice are not verdicts. |
| `classify` | Too narrow. Gating, ranking and checking are not classification. |

Namespaced surfaces then read naturally: `/decisions:ask`, `/decisions:scout`, `/decisions:adopt`.

**Vocabulary the plugin commits to.** It is taken from `jev-poc` and should be used consistently in every skill:

- **state**: the text or JSON being judged. One state per request.
- **question set**: named questions, all answered against one state in one request.
- **primitives**: `choice` (one of N, with a distribution and a confidence), `score` (a position on a 0-indexed rubric, as a weighted mean), `noul` (probability 0–1).
- **policy**: the code that turns answers into actions. It holds the thresholds. It never lives in the model.
- **shape**: how input turns into calls. The seven shapes are `single`, `fanout`, `pairwise`, `rounds`, `windowed`, `cascade` and `offline`.
- **undecided**: a flat distribution (confidence ≤ floor). It is its own outcome and is never acted on.
- **provider**: a backend that serves the primitives. `jev` is the default. `emulated` runs a chat model with a JSON schema.

## 3. Design principles

These are load-bearing. Each one comes from something `jev-poc` learned by running the model.

1. **State by reference, not by value.** This is the single most important surface decision. Suppose the agent pastes 500 functions into a tool call. It has then paid *output* tokens, the expensive kind, to save input tokens. So every call-generating tool must accept **sources**: globs, file plus line ranges, a JSONL file, `git diff`, captured command output, URLs. It must also accept **splitters**: per-file, per-function, per-hunk, per-row, sliding window. The tool reads and splits the content itself.
2. **Return only what the agent will act on.** The agent's context is the scarce resource. Fan-out tools take a `keep` / `sort` / `limit` / `fields` projection and return survivors plus a count, not 500 rows.
3. **Policy in code, never in the model.** Thresholds live beside the question set in a file that can be versioned and tested. The model returns probabilities, and code decides.
4. **Undecided is a first-class outcome.** Every surface renders "cannot tell" distinctly and routes it to the agent or a human. It is never rounded to the top option.
5. **Blame the question first.** A strange answer usually means a badly posed question. The design guidance and the critic agent exist for this loop: capture, read the distribution, rewrite, re-ask.
6. **Honest numbers.** Label projected cost as projected and measured cost as measured. Never call a model "correct" without labels. Agreement with a baseline is not accuracy.
7. **Know the anti-signals.** Decision models cannot generate text, count, do arithmetic, compare numbers, reason about dates or read images. State is capped at 32k tokens on Jev. Every skill that proposes a decision model must check for these first.
8. **Egress is visible.** Calls send code and text to a third party. The plugin must make that explicit at setup, allow path excludes, and never enable an automatic hook without consent.

## 4. The surface at a glance

```
decisions/
  skills/
    ask/          model + user   Make a decision call now, in this session
    design/       model + user   Author or repair a question set + policy
    scout/        user           Find opportunities in a codebase or a set of skills
    adopt/        user           Convert one opportunity into a working decision + tests
    compare/      user           Shadow-run against the current mechanism; measured report
    calibrate/    user           Fit thresholds from recorded answers + labels (offline)
    guard/        user           Opt in to decision-backed hooks
    setup/        user           Provider, key, egress policy, spend status
  agents/
    opportunity-scout            Read-only; sweeps one partition for opportunities
    question-critic              Reviews a question set against known failure modes
    shadow-evaluator             Runs a comparison and reduces it to measured signals
  mcp/  decisions server         decide · decide_many · sweep · pairs · usage
  bin/  decide                   Same engine as a CLI, for hooks, scripts and CI
  hooks/                         Shipped dormant; activated only through /decisions:guard
```

The **engine** (provider adapters, source readers and splitters, the fan-out cap, fixture record/replay, the spend meter) sits under both the MCP server and the CLI. Skills never call HTTP themselves.

## 5. The execution surface: MCP server plus CLI

### 5.1 Why both

- **MCP tools** are how the agent itself calls a decision model mid-session. They are schema-validated and have no shell quoting problems.
- **The `decide` CLI** is how *non-agent* code calls one: hooks (which run commands), CI, scripts, and the fixtures `adopt` generates. It is the same engine and the same question-spec files.

### 5.2 MCP tools

Each tool maps onto one of the shapes. The **offline** and **cascade** shapes are handled by skills, not tools.

| Tool | Shape | Purpose |
|---|---|---|
| `decide` | single | One state (inline or by reference) and a question set. Returns typed answers, usage, and an `undecided` flag per answer. |
| `decide_many` | fanout | N states from a source and splitter, one shared question set, fanned out under a server-side cap. Supports `keep`, `sort`, `limit` and `fields`, and returns survivors, counts and total usage. |
| `sweep` | windowed | One long input split into overlapping windows. Aggregates the per-window answers (any / max / first-hit with its location). |
| `pairs` | pairwise | "Same X or not?" over blocked pairs. Returns clusters. Used for dedup and grouping. |
| `usage` | — | Session spend, call count, provider and mode (live or replay). |

Parameters common to all tools:

- `questions`, inline or `spec: "<name>"` pointing at a saved question spec (§6);
- `provider`;
- `record` (write fixtures);
- `dry_run`, which returns projected calls and cost without calling. It is required above a configurable budget, reusing `jev-poc`'s cost guard.

Results must always say where an answer came from (`live` / `replay` / `emulated`). This carries over `jev-poc`'s `AnswerSource`.

### 5.3 Providers

The core abstraction is a *decision provider* that serves `choice`, `score` and `noul`, and declares its capabilities:

- `calibrated: true | false`
- `max_state_tokens`
- `cost_model`

Planned providers:

- **`jev`**: OpenRouter's decisions endpoint. The URL is overridable because it is still on an alpha path.
- **`emulated`**: a chat model with a derived JSON schema. `jev-poc/shared/baseline.ts` already does this derivation. It is used for no-key operation, and as the baseline in `compare`. It is marked `calibrated: false` and returns single values, never invented distributions.
- **Future vendors**: added as adapters. Nothing above the engine changes.

## 6. The question spec: the plugin's one durable file format

Several skills produce and consume the same artifact, so it needs one format. Proposed location: `.decisions/specs/<name>.yaml`, holding:

- `questions`: the question set.
- `policy`: named thresholds, each with a one-line justification (the `jev-poc` convention: every threshold is defended in a comment).
- `examples`: seed inputs that exercise the policy's branches.
- `source`: optional default source and splitter, e.g. `glob: src/**/*.ts, split: function`.
- `provenance`: which opportunity it came from and what it displaced.

Recorded answers live at `.decisions/fixtures/<spec>/…`. Labels for calibration live at `.decisions/labels/<spec>.jsonl`. `scout` writes `.decisions/opportunities.json` so that `adopt` can refer to opportunities by id.

## 7. Skills

Invocation modes follow current Claude Code conventions. Skills with side effects (`setup`, `guard`, `adopt`) should set `disable-model-invocation` so they only run on explicit request.

### 7.1 `decisions:ask`: use a decision model now

**This is the everyday skill and the highest-value one.** It is model-invoked. Its description should trigger whenever the agent is about to read many items in order to make the same closed judgement about each, or needs a quick, cheap, typed yes/no, pick-one or rate-this.

What it teaches:

- **When to reach for it.** Delegate reading: filter grep or search hits by a rule stated in English, rank candidate files by relevance to the goal (context pruning), triage test or CI failures, bucket a list of issues, check acceptance criteria against a diff.
- **When not to.** Generation, counting, arithmetic, dates, images, cross-document reasoning, or cases where exactness is required (write code instead). If the whole corpus fits and there are fewer than about 10 items, just read it.
- **Picking the primitive** by what the answer means, not by taste. It also covers picking the shape from the batching rule (share one state versus fan out).
- **The call pattern.** Pass state by reference, project results hard, set a threshold before looking, and treat undecided items as "read these yourself".
- **Reading answers.** Distribution versus winner, `noul` 0.5 meaning uncertain, the fact that Jev is very decisive (1.0 is common), and score levels being 0-indexed.

It also works as `/decisions:ask <question> [over <source>]` for the user's ad-hoc queries.

### 7.2 `decisions:design`: author or repair a question set

It is model-invoked when writing or editing a spec, and user-invocable as `/decisions:design`. It ships reference files rather than one long body:

- `primitives.md`
- `question-craft.md`: always give a no-match option; describe score levels as concrete situations; write noul true/false criteria for anything ambiguous; Jev applies criteria literally; separate distinct failure modes (the router's "unclear goal" versus "missing material").
- `thresholds.md`: stakes-scaled gates, the undecided floor, rules that only escalate.
- `shapes.md`

Its loop is the one `jev-poc` settled on: draft, capture on the examples, **read the distributions before building anything**, revise. It dispatches `question-critic` before a spec is saved.

### 7.3 `decisions:scout`: find opportunities

User-invocable: `/decisions:scout [path|skills|plugins] [--depth quick|full]`. It has two target modes with different signals.

**Mode A: a codebase.** It looks for places where an LLM or a heuristic is doing a decision model's job.

| Signal | Example | Likely shape |
|---|---|---|
| LLM call whose output is parsed to an enum, bool or number | `json_schema` with an `enum`; "answer only yes or no"; regex on a completion | single |
| Classifier / router / moderation / sentiment / intent code | ticket routing, model routing, content policy | single, cascade |
| LLM-as-judge or reranker over many items | RAG rerank, eval graders with fixed rubrics | fanout |
| Keyword lists or regex encoding a *semantic* rule | "urgent" word lists, dedup templates | single, pairwise |
| LLM called in a loop over records | bulk labelling jobs | fanout |
| Every request sent to a frontier model | no gate in front of an expensive call | cascade |

**Mode B: skills, plugins, hooks and agent configs.** It looks for places where an *agent* is spending turns on decisions.

| Signal | Example | Replacement |
|---|---|---|
| Skill tells the agent to "read each X and decide Y" | review, triage and audit skills | `decide_many` with a spec |
| Subagent fan-outs whose job is classification | "spawn one agent per file to check…" | `decide_many` |
| `claude -p` / `type: "prompt"` hooks that answer yes/no | Stop and PreToolUse prompt hooks | a decision-backed hook |
| Workflow steps that grade against a fixed rubric | verifier or critic steps with fixed verdicts | `decide` plus policy |
| Max-iteration counters as loop control | "stop after 20 tries" | windowed loop check |

**Anti-signal filter.** It discards any candidate that needs generation, arithmetic, dates or images, needs more than one state's worth of cross-document reasoning, or has volume too low to matter.

**Ranking.** Candidates are ranked by `volume × (current cost − decision cost)`, then by latency sensitivity, closedness of the answer, and risk. **Every saving is labelled as projected.** Scout never measures anything; that is `compare`'s job.

**Output.** A ranked report plus `.decisions/opportunities.json`. For each opportunity it records the location, the current mechanism, the proposed shape, a *draft* question set, the projected saving, the risk, and the next step (`/decisions:adopt <id>`).

**Execution.** It partitions the target and dispatches parallel `opportunity-scout` agents, one per partition, then merges and de-duplicates their results.

### 7.4 `decisions:adopt`: turn one opportunity into a working decision

User-invocable: `/decisions:adopt <opportunity-id | path>`. It follows the pipeline `jev-poc` used for every demo:

1. Draft the spec with `design` and have it reviewed by `question-critic`.
2. Capture answers on the examples and on real inputs from the repo. Read the distributions. Revise.
3. Generate a **policy module** in the host language with thresholds and a trace of which branches fired, plus unit tests that run offline against recorded fixtures.
4. Wire it in behind the existing mechanism with a **fallback**: undecided or a provider error goes to the old path.
5. Hand off to `compare` for a shadow run before cutover.

It generates code in the target repo's idiom. It includes client templates for TypeScript and Python, with the wire contract taken from `jev-poc/shared/jev.ts`.

### 7.5 `decisions:compare`: shadow evaluation

User-invocable: `/decisions:compare <spec> [--baseline current|emulated:<model>]`. It generalises `jev-poc`'s assessment pipeline:

1. Record both sides over the same states.
2. Reduce them to measured signals: cost per call, latency, decisiveness, undecided share, agreement by question type, and how often the baseline's reply parsed.
3. Write a report that **declares no winner without labels**.

It is backed by `shadow-evaluator`. When labels exist, it adds accuracy and hands off to `calibrate`.

### 7.6 `decisions:calibrate`: fit the thresholds (offline shape)

User-invocable: `/decisions:calibrate <spec>`. It sweeps each policy threshold against recorded answers plus labels, and proposes the value that best separates them, reported alongside its confusion trade-off. It makes **zero model calls**. It can bootstrap labels by asking the user to label a small, deliberately ambiguous sample (the undecided and borderline items first). This is `jev-poc`'s threshold-fitter demo, turned into a tool.

### 7.7 `decisions:guard`: decision-backed hooks

User-invocable: `/decisions:guard [list|enable <pack>|disable <pack>|status]`. Plugin hooks go live on install, so they ship **dormant**: each hook script checks `.decisions/config` and exits immediately unless its pack is enabled. Each pack states its egress and latency cost when enabled.

| Pack | Hook | What it decides | From `jev-poc` |
|---|---|---|---|
| `command-guard` | PreToolUse (Bash) | Risk class of a shell command; stakes-scaled gates (allow / ask / deny) | guardrail demo |
| `done-check` | Stop | One noul per acceptance criterion against the diff and test output; blocks a false "done" and names the criterion | done-check demo |
| `loop-check` | PostToolUse | Windowed "no progress" read over recent tool calls; nudges or stops | loop-detector demo |

Failure behaviour is explicit per pack. Each pack is **fail-open** on provider error by default, except where the user chooses fail-closed. Each has a latency budget, after which it falls through. The pitch against prompt hooks: about 300 ms and a hundredth of a cent per event, so it can run on *every* event.

### 7.8 `decisions:setup`

User-invocable: `/decisions:setup`. It covers the provider and key (`OPENROUTER_API_KEY`), the endpoint override, replay mode, egress policy (path excludes, secret scrubbing, a per-hook opt-in), the budget ceiling, and a status readout (`usage`).

## 8. Agents

Agent names are deliberately distinct from skill names to avoid collisions.

| Agent | Tools | Role |
|---|---|---|
| `opportunity-scout` | read-only | Sweeps one partition (a directory, or one skill or plugin) against scout's signal tables. Returns candidates with evidence and a draft question set. Runs in parallel. |
| `question-critic` | read-only | Reviews a spec against known failure modes: no no-match option; abstract score levels; questions that need counting, dates or arithmetic; two failure modes merged into one question; criteria text that will be read literally in an unintended way; questions over different states mixed into one set; thresholds without justification. |
| `shadow-evaluator` | read + run `decide` | Runs `compare`, reduces the results to measured signals, and writes the report under the no-ground-truth rules. |

## 9. How the pieces chain

```
          /decisions:scout ──► opportunities.json
                                     │
                          /decisions:adopt <id>
                  design ─► question-critic ─► capture ─► policy + tests
                                     │
                          /decisions:compare ─► measured report
                                     │ (labels?)
                          /decisions:calibrate ─► thresholds updated
                                     │
                               cut over (fallback kept)

   In-session, at any time:  ask ──► decide / decide_many / sweep / pairs
   Always-on, opt-in:        guard ──► hooks ──► decide CLI
```

## 10. Suggested build order

Each phase ships something usable on its own.

| Phase | Content | Why |
|---|---|---|
| 1 | Engine + `jev` provider, MCP `decide` / `decide_many` with sources, splitters and projection, `decide` CLI, `setup`, `ask`, `design` (reference files) | The in-session value. Everything else builds on it. |
| 2 | `scout` + `opportunity-scout` + `question-critic`, the spec format | Produces the backlog of real opportunities |
| 3 | `adopt`, `compare` + `shadow-evaluator`, the `emulated` provider | Turns opportunities into measured migrations |
| 4 | `calibrate`, `sweep`, `pairs` | Remaining shapes, and thresholds from data |
| 5 | `guard` packs | Highest blast radius and egress sensitivity, so it comes last |

## 11. Reuse from `jev-poc`

| Need | Source |
|---|---|
| Wire contract, primitives, `isUndecided`, `UNDECIDED_FLOOR = 0.15`, `noulConfidence` | `shared/jev.ts` |
| Question set → JSON schema for the `emulated` provider and baselines | `shared/baseline.ts` |
| Measured-signal reduction (cost, decisiveness, agreement, parse rate) | `shared/assessment.ts`, `scripts/build-evidence.ts` |
| Judging-model contract for no-ground-truth reports | `docs/assessment/INSTRUCTIONS.md` |
| Bounded fan-out pool and server-side caps | `server/concurrency.ts`, `server/config.ts` |
| Retries, timeouts, strict response validation | `server/transport.ts` |
| Rounds / job planning (capture walks the same tree) | `src/demos/_kit/plan.ts` |
| Reference policies with traces and tests, one per shape | `src/demos/*/policy.ts` (e.g. `triage`, `guardrail`, `cascade`, `done-check`, `loop-detector`, `threshold-fitter`) |
| Worked question sets with lessons in comments | `src/demos/*/demo.ts` |
| The lessons list ("things learned the hard way") | `README.md` §"Notes that cost something to learn", `docs/EXPANSION-PLAN.md` §1 |

## 12. Open decisions for the build session

Each has a recommendation.

1. **MCP-first or CLI-first?** Recommended: build the engine as a library, and ship both from phase 1. The MCP server is thin over the library, and the CLI is needed for hooks anyway.
2. **Spec format: YAML or JSON?** Recommended: YAML for authoring, with comments carrying the threshold justifications. The engine accepts both.
3. **Where specs live.** Recommended: per-repo `.decisions/`. A user-level `~/.decisions/specs` holds generic specs shipped with the plugin (e.g. `relevance`, `flaky-vs-real`, `command-risk`).
4. **Ship generic specs with the plugin?** Recommended: yes, a small library of them. They make `ask` useful with zero authoring, and double as examples.
5. **Splitting code into functions.** A per-function splitter needs a parser (tree-sitter or similar). Recommended: start with file, hunk, line-window and row splitters, and add a function splitter in phase 2.
6. **Emulated provider in v1?** Recommended: phase 3, together with `compare`. Before then, having no key means replay only.
