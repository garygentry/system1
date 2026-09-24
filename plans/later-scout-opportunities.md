> [!NOTE]
> **Superseded 2026-09-24** by [`milestones/M9-M11-scout-guard-adopt.md`](milestones/M9-M11-scout-guard-adopt.md) §M9, which carries this plan's scope and D1–D4 forward, with one change: the lint is a separate `decide spec lint` that `spec check` runs first (D4 had it inside `spec check`). The title's "M7" is the numbering at the time of writing; this work is now M9. Kept as the detailed reference that section points to.

# M7 — `scout`: find the decisions worth handing over

**Status:** planned (2026-09-23). The decisions below came from interviewing the user.
**Goal:** Point System 1 at a codebase or at a set of skills and get back a ranked, validated backlog of places where an LLM call, a hand-written heuristic or an agent fan-out is doing a decision model's job — each with evidence, a draft question set and a projected saving labelled as projected.

## First principles

- **Scout is its own best demo.** Finding opportunities *is* screening many items against the same closed question. If scout read every file itself, or spawned an agent per partition, it would be the anti-pattern it exists to find. It screens with `decide many` ([0017](decisions/0017-fan-out-through-the-cli-not-subagents.md)).
- **Recall first, precision second.** A missed opportunity is invisible; a false positive costs one read. Signal questions screen *in* generously, and the agent reads the survivors and writes them up. The model narrows the field; it does not file the report.
- **Scout never measures anything.** Savings are arithmetic over volume and list prices, so every one is labelled projected. Measuring is `compare`'s job in M8 (charter §7.5).
- **The backlog is an artifact, not a conversation.** `adopt` in M8 consumes it, so it is typed, validated and on disk — not prose in a transcript.

## Decisions (interview, 2026-09-23)

| # | Question | Decision |
|---|---|---|
| D1 | How does scout fan out over a large target? | **Through `decide many`, not subagents.** Scout partitions the target and screens each partition against the signal tables in one call per partition. No harness subagents anywhere; `opportunity-scout` and the agent generator drop out of M7. Ratified as [0017](decisions/0017-fan-out-through-the-cli-not-subagents.md). |
| D2 | Which target modes ship? | **Both, one pipeline.** Mode A (a codebase) and Mode B (skills, plugins, hooks, agent configs) share partition → screen → rank → write; only the signal table and the anti-signal filter differ. |
| D3 | Where does the backlog live? | **The CLI owns it.** A typed `opportunities` tool in `packages/core/src/tools/`, surfaced as `decide opportunities add|list|check`, writing a validated `.system1/opportunities.json`. The skill decides what counts as an opportunity; the CLI validates and persists. |
| D4 | What happens to `question-critic`? | **A reference plus a static lint.** The failure-mode catalogue becomes a craft reference in `design`, and the mechanical checks become an offline lint pass in `decide spec check`. No agent. |

## Scope

### 1. CLI: `decide opportunities` (D3)

A new tool in `packages/core/src/tools/opportunities.ts` — TypeBox input schema plus handler, like every other tool — with three subcommands mapped in the CLI:

- `add --file <path|->` — validate one or more candidates and merge them into `.system1/opportunities.json`. Ids are stable and content-derived, so re-running a sweep updates an entry instead of duplicating it.
- `list [--keep <expr>] [--sort] [--limit] [--fields]` — the same projection vocabulary as `many`, so the agent pulls back only the rows it will act on.
- `check` — validate the file on disk and report what is malformed. Offline, no key, no egress.

**The record.** Per charter §7.3: location (file, line range), mode (A or B), the current mechanism, the proposed shape (`single`, `fanout`, `cascade`, `pairwise`), evidence (the excerpt that triggered it), a *draft* question set, the projected saving with its inputs shown, risk, and the next step. Plus `source`: which sweep produced it and whether the screening answers were `live` or `replay`.

**Projected savings are arithmetic, and the arithmetic is visible.** The record carries `volume`, `current_cost_per_item`, `decision_cost_per_item` and the resulting figure, each labelled projected, so a reader can disagree with the estimate rather than having to trust it.

### 2. CLI: a static lint in `decide spec check` (D4)

`spec check` today runs a spec against its recorded examples, which needs a model, consent and either a key or fixtures. The lint is a **separate, offline pass that runs first** and reports on its own:

- a question with no no-match / none-of-these option;
- score levels that are abstract (`severity: low|medium|high`) rather than anchored in observable text;
- a question that needs counting, arithmetic, dates or images;
- two failure modes merged into one question;
- criteria text that a literal reader will take in an unintended way;
- questions over different states mixed into one set;
- a threshold with no justification recorded.

It runs with no key and no consent, so it is also a regression test a user can put in CI over their own specs. The last two are partly judgement and may end up advisory rather than failing — settle that while building, and record which are errors and which are warnings.

### 3. The signal tables (D2)

Two question sets, shipped as data in the skill, in the `--questions` YAML shape M5 added:

- **Mode A, a codebase:** an LLM call whose output is parsed to an enum, bool or number; classifier / router / moderation / intent code; LLM-as-judge or reranker over many items; keyword lists or regex encoding a *semantic* rule; an LLM called in a loop over records; every request going to a frontier model with no gate in front.
- **Mode B, agent configuration:** a skill telling the agent to "read each X and decide Y"; a subagent fan-out whose job is classification; a `claude -p` or `type: "prompt"` hook answering yes/no; a workflow step grading against a fixed rubric; a max-iteration counter used as loop control.

**The anti-signal filter** discards candidates needing generation, arithmetic, dates or images, needing more than one state's worth of cross-document reasoning, or with volume too low to matter. Cheapest as its own questions in the same set, so one pass both screens in and screens out.

### 4. `scout` skill (user-invocable)

`scout [path|skills|plugins] [--depth quick|full]`. The skill body describes intent and runs `decide`; it names no harness's tools.

1. Resolve the target and pick the mode. Partition it — by file for Mode A, by skill or plugin for Mode B.
2. Screen each partition: `decide many --glob … --questions <signals> --keep … --format brief`.
3. Read the survivors (and only those), gather evidence, draft a question set per candidate, compute the projected saving.
4. `decide opportunities add --file -` with the candidates.
5. Report the ranked top N and point at `.system1/opportunities.json`.

**Undecided survivors are listed apart** and never silently dropped — the same rule the rest of the product follows.

**`--depth`:** `quick` screens with the high-signal questions and a tight threshold; `full` widens recall and adds the slower checks. Both report measured spend.

### 5. `design` gains the failure-mode reference (D4)

A new reference file under the `design` skill holding the catalogue from charter §8, written as craft guidance with an example of each failure and its repair. `design` consults it when drafting, and runs the lint before saving.

### 6. Routing evals

`scout` is user-invocable, so the eval that matters is that an explicit invocation loads it in all three harnesses, and that it does **not** steal prompts belonging to `ask` or `design`. Extend `tools/evals/` with `scout` positives and negatives, and re-run the `ask` set to confirm the new skill has not moved it.

## Out of scope

- `adopt`, `compare`, `shadow-evaluator` and the `emulated` provider (M8).
- Any subagent, and the agent generator ([0017](decisions/0017-fan-out-through-the-cli-not-subagents.md)).
- Measuring a real saving. Scout projects; `compare` measures.
- Scouting a target outside the repo without `--allow-outside`, which keeps M6's repo boundary.

## Open, to settle while building

- **Which lint checks fail and which merely warn** (§2). Anything a competent question could legitimately trip should warn.
- **Whether the two signal tables are really one set** with a mode filter, or two files. Two files if the anti-signal filters diverge.
- **How ids stay stable** when a file is edited under a candidate. Content-derived over the evidence excerpt, probably, with the location as a fallback.
- **Whether `list` needs its own projection** or can reuse `many`'s `--keep` parser outright. Prefer reuse.
- Whether a repo with no `.system1/` yet should have `opportunities add` create it, or require consent first. It writes nothing outward, so creating it is probably fine — confirm against 0009.

## Acceptance

- [ ] `decide opportunities add|list|check` ship as one typed tool, with schema, handler and tests; `--format brief` and the JSON envelope both behave per [0015](decisions/0015-cli-contract-v1.md).
- [ ] `.system1/opportunities.json` has a validator, and `check` reports a malformed file as a typed error rather than repairing it.
- [ ] `decide spec check` runs the static lint offline — no key, no consent, no egress — and its checks are documented as error or warning.
- [ ] `scout` sweeps this repo in Mode A and finds at least one real, defensible candidate, with the run's measured cost recorded here.
- [ ] `scout` sweeps a set of skills in Mode B (this repo's own plugin, plus one third-party plugin) and its candidates are read and judged honestly, including the false positives.
- [ ] Every projected saving shows its inputs and is labelled projected. No output claims a measured saving.
- [ ] Undecided survivors are reported apart from kept and dropped.
- [ ] Routing evals: `scout` loads on explicit invocation in Claude, Codex and Pi, and the `ask` set does not regress.
- [ ] `pnpm check`, `pnpm smoke` and `pnpm eval:routing all` green.
- [ ] The ROADMAP M7 row reflects [0017](decisions/0017-fan-out-through-the-cli-not-subagents.md). The charter keeps its original §8 text, as it kept §4–§5 after [0013](decisions/0013-cli-first-mcp-deferred.md); the decision record is what supersedes it.
