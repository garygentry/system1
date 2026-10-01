# 0020. Runtime consent and runtime environment for adopted code

- **Status:** accepted 2026-09-30. The maintainer ruled that the marked line is the only grant (§1) and that the default cap is $1.00 a day (§4). §2, §3 and §5–§7 are the agent's proposals, revised after an adversarial review (§6 first had a `--egress on` flag) and accepted with the plan.
- **Date:** 2026-09-30
- **Amends:** [0009](0009-egress-consent-once-per-repo.md) and AGENTS.md's egress rule, for adopted code: its grant is a line of code, not the repo config. **Plan:** [`../m11-adopt.md`](../m11-adopt.md) D1, D5–D7. **Spec:** [`../milestones/M9-M11-scout-guard-adopt.md`](../milestones/M9-M11-scout-guard-adopt.md) §M11.1.

## Context

M11's `adopt` generates a policy module that the user's application calls in production. It sends that application's content to the decision model. Until now, consent reached the engine two ways:

- the repo's `.system1/config.yaml` (`egress.consent`), written only by `decide config egress allow` behind a TTY or `--confirm` ([0009](0009-egress-consent-once-per-repo.md));
- `createDecider({ egressConsent: true })` in `@garygentry/system1-core`, which is public and **unguarded**.

Neither fits a deployed app. The app may have no `.git`, no repo config, a read-only filesystem and no harness session. Walking up from `cwd` to find a root silently falls back to `cwd` itself.

**The threat model, stated honestly.** `adopt` is an agent that writes code and files. Nothing inside generated code can stop an agent from writing a grant, and nothing in the engine can tell a user's edit from an agent's. **The control is the user's review of the diff.** The rules below make that review easy and make an agent-written grant visible.

## Decision

1. **The grant is one marked line in the generated module.**
   - TypeScript: `const EGRESS = "off" // system1: runtime egress. Set to "on" to send this module's inputs to the decision model.`
   - Python: `EGRESS = "off"  # system1: runtime egress. …`
   - The module passes it to the runtime as `egress`. Switching it to `"on"` is a user edit in reviewed code, and it is the only grant. The runtime reads no repo config for consent.
   - **`adopt` never writes `"on"`.** Each generated module ships a test that fails when its marked line is on, which a user who switches it on updates on purpose. `tools/validate.ts` scans the templates for any grant, not one spelling: `EGRESS` set to anything but `"off"` with any quoting or spacing, `egress:` given anything but `"off"`, `egressConsent`, and an `EGRESS` read from the environment. The generated test does the same over the module as written, so code adapted to the repo's idiom is checked too.
   - **Consent is never read from an environment variable,** here or anywhere.
2. **A runtime entry point that templates use, and nothing else.** `@garygentry/system1-core/runtime` exports `createPolicyRuntime`, `prepareState` and the reason codes. Every call goes through `prepareState` (scrub and size) and then the decider. **Excludes don't apply:** they match paths, and an in-memory state has none. This departs from the spec's "scrub, size and exclude"; a module that must hold back a field leaves it out of the state it builds. Templates never import `createDecider`. The subpath's exports are pinned by a test and committed under semver: a breaking change needs a minor bump and a decision record. `adopt` pins an exact version.
3. **The environment is explicit.**
   - `createPolicyRuntime({ egress, maxUsdPerDay, root?, model?, mode?, apiKey?, timeoutMs?, … })` (the full list is in `docs/runtime.md`). It never walks up the tree to find a root. Fixtures live under `root`; `mode: "replay"` answers from them offline and writes nothing.
   - `root` names the directory for the spend ledger and fixtures.
   - When `root` isn't given, or can't be written, spend is counted in memory for the process, and every result says `ledger: "memory"`. A missing `root` directory is created. A failed write is never an error after a paid call.
4. **A production spend cap:** `maxUsdPerDay`, counted from the provider's reported cost, or the projection when it reports none. In one process it holds against concurrent calls. Across processes it holds only through a shared, writable `root`, and can be overshot by the calls in flight at once.
   - [0011](0011-default-spend-guard-a-request-above-200-calls-or-0.md)'s per-request and per-session caps don't map onto a long-running app.
   - `adopt` writes the cap into each module explicitly, with a default of **$1.00**: about 30,000 decisions a day at current prices for small states, fewer for large ones.
   - At the cap, the module falls back with `budget` until the UTC day turns. Each call reserves its projected cost before it waits, so concurrent calls in one process can't race past the cap; a call's measured cost can still pass it by the difference. A cost the provider doesn't report counts at its projection. A cap that isn't a finite number of at least 0 makes every call fall back, never uncapped.
5. **Every result that isn't a model answer is a fallback with a reason code** the app can log or count. So "silently never called" is visible. The codes:
   - `egress-off`: the marked line is off;
   - `undecided`: the model's answer is too flat to act on. The spec's thresholds are the module's to apply, and it takes the fallback when they aren't met;
   - `provider-error`: HTTP, network or malformed response;
   - `refused`: the state is too large;
   - `budget`: the daily cap was reached;
   - `timeout`: past the module's latency limit;
   - `no-key`: no API key in the runtime;
   - `engine-unavailable`: Python only, when `decide` is missing or the wrong version.
   - `internal`: anything else, such as an unknown model or a malformed question set. *Added in M11 PR 3, so that "never throws" holds without mislabelling a bug as a provider error.*
6. **Python reaches the engine through `decide runtime`.**
   - The module spawns `decide runtime --module <its own path> --root <dir>`, with `{questions, state, namespace}` as JSON on stdin and one result as JSON on stdout.
   - **There is no egress flag.** `decide runtime` reads the grant from the module file: exactly one marked `EGRESS = "on"` line turns it on, and anything else is off. An agent can't grant egress by typing a command; only a line of code does.
   - A live call needs a writable `--root`, so the cap holds across the one-process-per-call spawns.
   - It loads no repo config and reads no `SYSTEM1_*` variable. Skills never run it: the validator forbids it in skill files.
   - The module checks `decide runtime --protocol` once at startup, a number that changes only when the stdin/stdout shape does, and falls back with `engine-unavailable` on a mismatch. Upgrading a global `decide` doesn't disable adopted modules.
7. **The API key** comes from the environment (`OPENROUTER_API_KEY`), like everywhere else. A key alone never grants egress.

## Rationale

- **The diff is the one place a person looks.** A marked line in code under review is a consent act the user can see, find with a search and revert. A config flag in a deployed image is easy to ship by accident and hard to audit.
- **One key, not two.** Also requiring `egress.consent` in a runtime config file would add a file every deployment must ship, and no protection: an agent can write that file as easily as the line.
- **Fallback is the existing path.** The module wraps a mechanism that already works. The honest failure mode is to keep using it, and to say why.

## What we give up

- **An agent can write the grant.** A user who approves a diff without reading it can ship egress on. The generated test, the validator and doctor's report of modules found with egress on (M11 §9) make this visible, not impossible.
- **The grant is text in a file, and `decide runtime --module` reads any file** (found in PR 6's review, 2026-10-01). An agent could write a throwaway module that nobody reviews, holding one marked `"on"` line, and spawn `decide runtime` on it, with no repo consent checked (D7 loads no config).
  - *Amendment (maintainer, 2026-10-01):* `decide runtime` refuses a live call with `egress-off` whenever a harness session variable is set (`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `CODEX_SESSION_ID`, `PI_SESSION_ID`, `AI_AGENT`, `CLAUDECODE`). These are set in the shells Claude Code, Codex and Pi run.
  - **It deters; it doesn't prevent.** An agent can unset the variables, and other agents (Cursor, Copilot, Gemini) set none of them.
  - The rule only ever denies, so "no variable grants egress" still holds.
  - **Cost:** the adopted app can't make live calls when run from inside an agent session, Claude's `!` included. Replay still runs.
  - **What's left:** an agent holding a key can always call the provider directly, or import `createPolicyRuntime` into code of its own. The grant guards reviewed code paths, not a determined agent; the key is the user's to withhold.
- **The in-memory ledger resets on restart,** so a crash-looping process can exceed the daily cap. Give the runtime a writable `root` to have the cap survive restarts.
- **Excludes don't reach runtime states** (§2): the module decides what goes into a state.
- **The cap is approximate across processes** (§4).

## Revisit when

- A design partner deploys an adopted module, and the review-the-diff control proves too weak in practice.
- M13 writes the full API and stability policy, which subsumes decision 2's promise.
