<!-- Prepended to every M6 review brief. -->
You are reviewing **System 1** (`system1`), a release candidate at version 0.1.0 that is about to be published to npm for the first time. Nothing is published yet, so breaking changes are still free; after publishing they cost a deprecation.

**What it is.** A set of tools that let a coding agent hand a *closed* judgement (yes/no, pick one of N, rate on a scale) to a decision model instead of reading everything itself. The model returns typed, calibrated probabilities in about 300 ms for about $0.00003 a call. It ships one plugin for Claude Code, Codex and Pi, containing three skills (`ask`, `design`, `setup`) that tell the agent to run the `decide` CLI. The CLI is the only execution surface; there is no MCP server.

**Where things are.** You are in a clone of the repo. Read `AGENTS.md` first, then `plans/ROADMAP.md`. Ratified choices are in `plans/decisions/NNNN-*.md`; what happened in each milestone is in `plans/milestones/`. The engine is `packages/core`, the CLI is `packages/cli`, the skills are `plugins/system1/skills`, and the generator, validator, smoke tests and routing evals are in `tools/`.

**Ground rules.**
- **Read-only.** Do not modify, create or delete any file in the repo, and do not commit or push. Scratch files go under `/tmp/s1-review/` only.
- **No live model calls.** There is no API key and no egress consent here, and you must not add either. Never run `decide config egress allow`. `SYSTEM1_REPLAY=1` and `--dry-run` are how you exercise the CLI. A `replay-miss` error is a normal result.
- **No secrets.** Never print, echo or copy an API key, and don't read files outside the clone looking for one.
- You may run `pnpm install && pnpm build` (already done), `pnpm test`, and the built CLI at `packages/cli/dist/bundle/decide.mjs`.
- Do not run `pnpm smoke` or `pnpm eval:routing`: they drive real agent sessions and spend tokens.

**What I want.** Be adversarial and specific. Judge the *approach*, not just the code: say where the design is wrong or fragile, not only where a line is buggy. Reproduce anything you claim, with the exact command and its real output.

**Output format.** Write your answer as Markdown, in this shape:

1. A one-paragraph verdict: is this safe and sound to publish as 0.1.0, and what is the single biggest risk?
2. `## Findings`, numbered, most severe first. For each: a severity (high/medium/low), the file and line, what is wrong and why it matters, the exact repro with observed output, and a suggested fix.
3. `## Checked and fine`: one line each for the things you verified that hold up.
4. `## If I were you`: at most five sentences of blunt advice about the approach.

Keep it under 1200 words. Prefer three well-evidenced findings over ten speculative ones. Say "I could not verify this" where that is the case.
