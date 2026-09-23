# 0017. Fan-out goes through the CLI, not through subagents

- **Status:** accepted
- **Date:** 2026-09-23
- **Amends:** charter §8 (agents), §7.3 (scout's execution). **Extends:** 0013 (CLI is the sole execution surface).

## Decision

No skill dispatches a harness subagent. Where the charter had `scout` partition a target and run one `opportunity-scout` agent per partition, `scout` instead screens the partitions with `decide many`. Where it had `design` dispatch `question-critic` before saving a spec, the critic's failure-mode catalogue becomes a craft reference in `design` plus a static lint in `decide spec check`.

`opportunity-scout`, `question-critic` and the agent generator are dropped from M7. `shadow-evaluator` (charter §8, phase 3) is not decided here; it is reconsidered on these grounds when M8 plans `compare`.

## Rationale

- **Skills must stay harness-neutral** (`AGENTS.md`). A skill that dispatches a subagent has to name a harness's tools, or branch on which harness it is in. Both are the thing that rule forbids.
- **Subagent support is not uniform and not verified.** Claude has it. Pi's is an optional extension. For Codex it is open question 3, and M4's survey found none of 190 cached Codex plugins shipping anything but `skills`, `apps` and `mcpServers`. Building the flagship phase-2 skill on a capability two of three first-class harnesses may not have is the wrong bet.
- **The fan-out already exists, and it is the product.** `decide many` takes sources and splitters, screens N items in one call, and returns only survivors. Using subagents to do that would be the exact pattern `scout` is built to find and replace — an agent fan-out whose job is classification (charter §7.3, Mode B).
- **It is cheaper and more honest.** A partition screened by `decide many` costs a fraction of a cent and reports its measured spend. N subagents cost N context windows and report nothing.

## What we give up, and how we cover it

- **Open-ended judgement per partition.** A subagent can notice something no signal table anticipated. Covered by keeping the sweep's *recall* wide — the signal questions screen candidates in, and the agent running `scout` reads the survivors and writes them up. The model narrows; the agent still judges.
- **Parallel wall-clock.** One `decide many` call is already batched and concurrent inside the engine, so this is mostly a non-issue; `--concurrency` is the knob.
- **A richer spec critique than a static lint.** The lint catches the mechanical failure modes (no no-match option, abstract score levels, merged failure modes, unjustified thresholds). The wording failures it cannot catch stay with `design`'s references and with `spec check` against real examples.

## Revisit when

- Codex ships verified plugin subagents *and* a sweep proves to need judgement the signal tables cannot express; or
- a target mode turns up where per-partition reasoning genuinely beats per-item screening.
