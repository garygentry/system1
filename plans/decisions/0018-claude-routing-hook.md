# 0018. A Claude-only prompt hook hints the ask skill

- **Status:** accepted (acceptance evals pending; see ROADMAP known gap 1)
- **Date:** 2026-09-23
- **Extends:** 0013 (the CLI is the sole execution surface), 0015 (CLI contract: one new command, `route`). **Addresses:** ROADMAP known gap 1.

## Decision

The Claude Code plugin ships one hook, `UserPromptSubmit`, in `plugins/system1/hooks/claude-hooks.json` (generated, and referenced from `.claude-plugin/plugin.json` rather than left at `hooks/hooks.json`, where another host could discover it). The hook runs `decide route --hook --format brief`. That matches the prompt against a small set of regular expressions (`packages/core/src/route/route.ts`) and, when one fires, prints a one-line hint to load `system1:ask`. Claude adds the hint to the prompt's context.

The skill description is unchanged, and so is everything Codex and Pi see.

Everything about the hook is user-configurable under `route:` in the usual config layers: `enabled`, `builtin`, `disable` (built-in trigger names), `triggers` (name + regex), `ignore` (veto regexes) and `message` (the hint, with `{triggers}`). `SYSTEM1_ROUTE=off` turns it off. `decide route --text "…"` shows what a prompt would do, and `decide doctor` reports a bad `route:` config.

## Rationale

- **The description cannot fix this.** Seven wording attempts (M6 rounds 1–5, the M7 retry, and 0.2.0's measurement) left Claude at about 6/8 on `ask` positives, and six runs on one wording scored 5–7/8, so single-run judging was measuring noise. Claude understands the skill; it chooses not to hand off a check of its own small diff. A hook does not depend on that choice.
- **The guard rail cannot break.** Round 5 fixed Claude by changing the shared description and broke Codex and Pi negatives (8/8 → 5/8). A Claude-only hook leaves the other harnesses byte-for-byte the same.
- **It sends nothing.** Routing is local pattern matching over the prompt. No content reaches the provider, so egress consent and `prepare()` are untouched. The hint only makes the agent load the skill; the skill's own `decide` calls still go through consent.
- **It never gets in the way.** The hook prints only when `decide` exits 0, always exits 0 itself (exit 2 from `UserPromptSubmit` would block the prompt), sets `SYSTEM1_NO_NPX` so the shim never downloads the CLI mid-prompt, and has a 10 s timeout. `route` loads config and regexes only, not the tool context, so it adds little to each prompt.
- **Through `decide`, like everything else.** The logic is a core tool with a schema (`decide schema route`); the hook is a thin shell line. Users can test their own triggers from a terminal with the same code the hook runs.

## What we give up, and how we cover it

- **Regexes are brittle to phrasing they were not written for.** Covered by a held-out prompt set (`tools/evals/routing-holdout.yaml`) written blind to the patterns and never tuned against, judged on repeated runs; by user-added triggers; and by the description still routing whatever the hook misses.
- **False hints cost a skill load, not a decision.** A wrong hint makes the agent read the skill; it still decides whether to call `decide`, and consent still gates any egress. `ignore`, `disable` and `enabled: false` are the user's controls.
- **Skills stay harness-neutral; the plugin no longer is, entirely.** This is the first harness-specific component beyond Codex's `agents/openai.yaml` policy file. It lives outside `skills/`, so the rule that skills name no harness's tools still holds.
- **Only user-initiated checks.** The hook sees the user's prompt, so it cannot catch Claude deciding by itself to grade its own work. That is the separate `guard` Stop hook, still deferred.

## Revisit when

- Codex or Pi show the same gap and support an equivalent hook; or
- the held-out results show pattern matching too brittle, in which case the next step is a hook that asks `decide` itself whether a prompt is a closed judgement. That sends every prompt to the provider, so it would need explicit opt-in.
