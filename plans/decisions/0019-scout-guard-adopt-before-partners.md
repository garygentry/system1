# 0019. Scout, guard and adopt ship before design partners

- **Status:** accepted
- **Date:** 2026-09-24
- **Amends:** ROADMAP milestone order (revision 3, 2026-09-23), which cut these features from the road to release. **Plan:** [`milestones/M9-M11-scout-guard-adopt.md`](../milestones/M9-M11-scout-guard-adopt.md).

## Decision

Three feature milestones come before design partners, each ending in a release:

- **M9 `scout` → 0.4.0.** `scout` screens a codebase or an agent configuration with `decide many` and writes a typed backlog through `decide opportunities`. It also brings the offline `decide spec lint`.
- **M10 `guard` with the `done-check` pack → 0.5.0.** This is an opt-in, dormant-by-default Stop hook that checks one verdict per acceptance criterion. It blocks once and then allows, never blocks on undecided, and fails open.
- **M11 `adopt` + `compare` → 0.6.0.** These add policy modules in TypeScript and Python that call through the System 1 engine, a shadow run against both the current mechanism and an `emulated` baseline, and a report that declares no winner without labels.

Design partners move from M9 to M12, and release hygiene from M10 to M13. `command-guard`, `loop-check`, `calibrate`, `sweep` and `pairs` stay post-release. No agent is planned: by default `shadow-evaluator` is not built, on the grounds of [0017](0017-fan-out-through-the-cli-not-subagents.md). This is the plan's default X1, not an interview decision, and can be revisited when M11 starts.

## Rationale

- **Scout is the developer-facing surface with the most leverage.** It answers "where would this pay off in *my* code", which `ask` cannot. Partners who point it at their own repo will give feedback about value, not only about install friction.
- **Guard addresses a known gap that wording could not.** Known gap #1 (Claude declines to hand off a check of its own work) was closed as a wording problem after seven rounds. A Stop hook does not depend on the model choosing to delegate. It addresses the gap only **for repos that opt in with a criteria file**; the `ask` routing numbers, the gap's measure for everyone else, don't move.
- **Adopt completes the chain.** A backlog with no path to shipped, measured code leaves the user with a report. `compare` is what turns scout's projected savings into measured ones.
- **Three releases keep each piece independently useful and gated.** Guard goes before adopt because it is small and fixes a live gap.

## What we give up, and how we cover it

- **Outside feedback on the core comes later.** The ROADMAP's own ordering argument (partners before features) is set aside by the user's choice. Covered by dogfooding each milestone on this repo, `jev-poc` and a third-party plugin, and by letting M12 start on the latest release if a milestone stalls.
- **New egress surfaces:** the Stop hook, the emulated baseline and adopted runtime code. Each goes through `prepare()` and consent. The hook packs and the emulated vendor each also need their own repo-level opt-in. Runtime consent for application code gets its own record (0020) in M11. If that record is not ready, 0.6.0 ships with runtime egress off.

## Revisit when

- M9's dogfood shows scout finds too little to be worth adopting. In that case, reconsider M11's scope before building it.
- A partner is ready before M11 closes.
