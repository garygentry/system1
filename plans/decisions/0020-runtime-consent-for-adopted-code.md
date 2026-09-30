# 0020. Runtime consent and runtime environment for adopted code

- **Status:** accepted 2026-09-30 (maintainer, at the start of M11: the marked line is the only grant; the default cap is $1.00 a day)
- **Date:** 2026-09-30
- **Amends:** [0009](0009-egress-consent-once-per-repo.md) for code that runs outside a harness. **Plan:** [`../m11-adopt.md`](../m11-adopt.md) D1, D5–D7. **Spec:** [`../milestones/M9-M11-scout-guard-adopt.md`](../milestones/M9-M11-scout-guard-adopt.md) §M11.1.

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
   - **`adopt` never writes `"on"`.** Each generated module ships a test that fails when its marked line is on, which a user who switches it on updates on purpose. `tools/validate.ts` scans the templates for `EGRESS = "on"`, `egressConsent: true` and `--egress on`.
   - **Consent is never read from an environment variable,** here or anywhere.
2. **A runtime entry point that templates use, and nothing else.** `@garygentry/system1-core/runtime` exports `createPolicyRuntime`, `prepareState` and the reason codes. Every call goes through `prepareState` (scrub and size) and then the decider. Templates never import `createDecider`. The subpath's exports are pinned by a test and committed under semver: a breaking change needs a minor bump and a decision record. `adopt` pins an exact version.
3. **The environment is explicit.**
   - `createPolicyRuntime({ root?, egress, maxUsdPerDay, model?, fixtures? })`. It never walks up the tree to find a root.
   - `root` names the directory for the spend ledger and fixtures.
   - When `root` is absent, missing or unwritable, spend is counted in memory for the process, and every result says `ledger: "memory"`. A failed write is never an error after a paid call.
4. **A production spend cap:** `maxUsdPerDay`, per process, measured from the provider's reported cost.
   - [0011](0011-default-spend-guard-a-request-above-200-calls-or-0.md)'s per-request and per-session caps don't map onto a long-running app.
   - `adopt` writes the cap into each module explicitly, with a default of **$1.00**: about 30,000 decisions a day at current prices.
   - At the cap, the module falls back with `budget` until the UTC day turns.
5. **Every result that isn't a model answer is a fallback with a reason code** the app can log or count. So "silently never called" is visible. The codes:
   - `egress-off`: the marked line is off;
   - `undecided`: below the spec's thresholds or undecided;
   - `provider-error`: HTTP, network or malformed response;
   - `refused`: the state is too large, or scrubbing refused it;
   - `budget`: the daily cap was reached;
   - `timeout`: past the module's latency limit;
   - `no-key`: no API key in the runtime;
   - `engine-unavailable`: Python only, when `decide` is missing or the wrong version.
6. **Python reaches the engine through `decide runtime`.**
   - The module spawns `decide runtime <spec> --root <dir> --egress on|off`, with the state as JSON on stdin and one result as JSON on stdout.
   - `--egress` comes only from the module's marked line. The validator forbids `--egress on` in skills and templates, as it forbids `--i-consent`.
   - The module checks `decide version` once at startup, and falls back with `engine-unavailable` on a mismatch.
7. **The API key** comes from the environment (`OPENROUTER_API_KEY`), like everywhere else. A key alone never grants egress.

## Rationale

- **The diff is the one place a person looks.** A marked line in code under review is a consent act the user can see, find with a search and revert. A config flag in a deployed image is easy to ship by accident and hard to audit.
- **One key, not two.** Also requiring `egress.consent` in a runtime config file would add a file every deployment must ship, and no protection: an agent can write that file as easily as the line.
- **Fallback is the existing path.** The module wraps a mechanism that already works. The honest failure mode is to keep using it, and to say why.

## What we give up

- **An agent can write the grant.** A user who approves a diff without reading it can ship egress on. The generated test, the validator and doctor's report of modules found with egress on (M11 §9) make this visible, not impossible.
- **The in-memory ledger resets on restart,** so a crash-looping process can exceed the daily cap. Give the runtime a writable `root` to have the cap survive restarts.

## Revisit when

- A design partner deploys an adopted module, and the review-the-diff control proves too weak in practice.
- M13 writes the full API and stability policy, which subsumes decision 2's promise.
