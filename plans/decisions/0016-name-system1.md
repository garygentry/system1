# 0016. The project is named System 1 (`system1`)

- **Status:** accepted
- **Date:** 2026-09-22
- **Source:** M6, before the first publish. Amends [0008](0008-github-and-npm-names.md).

## Decision

The project is **System 1**, published as `system1`:

| Surface | Name |
|---|---|
| GitHub | `garygentry/system1` |
| npm | `@garygentry/system1`, `@garygentry/system1-core`, `@garygentry/system1-pi` |
| Plugin and marketplace | `system1` (so skills are `/system1:ask`, `system1:design`, `/system1:setup`, installed as `system1@system1`) |
| Per-repo state | `.system1/` (config and consent, fixtures, the spend ledger) |
| User config | `$XDG_CONFIG_HOME/system1/` (`config.yaml`, `credentials`) |
| Environment | `SYSTEM1_REPLAY`, `SYSTEM1_MODEL`, `SYSTEM1_ENDPOINT`, `SYSTEM1_SESSION`, `SYSTEM1_CLI`, `SYSTEM1_SPECS_PATH`, `SYSTEM1_NO_NPX` |
| Provider attribution | `X-Title: system1` |

**The command stays `decide`.** It is what an agent types and what every skill, recipe and hook already uses, and it reads well beside the package name: `npm i -g @garygentry/system1` provides `decide`.

## Why

- **"Decisions" described the mechanism, not the idea.** System 1, from Kahneman's two systems, is the fast, automatic judgement that runs before deliberation. That is exactly what this delegates: the agent's slow, expensive reading of many items becomes one fast, calibrated call.
- **`decisions` was ambiguous** next to "decision model", OpenRouter's `/decisions` endpoint, and this repo's own decision records in `plans/decisions/`.
- **Nothing was published or installed anywhere**, so the rename costs one mechanical pass and no migration. After the first publish it would cost a deprecation.

## What did not change

- The `decide` command, its flags, the envelope and the exit codes ([0015](0015-cli-contract-v1.md)).
- The transport id `openrouter-decisions`, which names the provider's API, not this project.
- The skill names `ask`, `design` and `setup`, and the spec file format.

## Consequences

- Install lines become `garygentry/system1` (plugin marketplaces) and `npm i -g @garygentry/system1`.
- A repo that already has a `.decisions/` directory would have to rename it to `.system1/`. Only this repo did, and it was renamed in the same pass.
- Milestone documents M0–M5 keep the old names: they are dated records of what happened.
