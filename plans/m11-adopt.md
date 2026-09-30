# Plan: M11 — `adopt` + `compare`, runtime consent, the `emulated` baseline

- **Status:** in progress (2026-09-30). PR 1 (this plan and [0020](decisions/0020-runtime-consent-for-adopted-code.md)) is next to merge.
- **Spec:** [`milestones/M9-M11-scout-guard-adopt.md`](milestones/M9-M11-scout-guard-adopt.md) §M11. This file is the implementation plan; the spec wins where they differ, except for the decisions below and the corrections in "Where the spec meets the code".

## Where the spec meets the code

A survey of the engine (2026-09-30) found these, and the plan follows them rather than the spec's wording:

1. **§5's `decide many --file <jsonl> --split row` can't carry a capture.**
   - `--file` is a text source, so each line would go out as a raw string.
   - `--jsonl` sends the whole parsed row, so the current mechanism's `output` and `usage` would sit in front of Jev and the emulated model.
   - Row ids are `<path>:row<N>`, not the captured `id`.
   - `many` returns only kept and undecided rows.
   - §2 also has `many` refuse emulated. So `compare` reads the capture itself (D3) and never goes through `many`.
2. **There is no state-level `prepare()`.** `prepare()` takes path and text sources only, and excludes are path-based. §3's entry point is new work (D4).
3. **A read-only disk breaks a paid call.** `SpendLedger.append` has no catch, so on EROFS the call succeeds and then throws a plain `Error` (exit 1). Fixture writes in record mode do the same. Fixed in PR 2.
4. **With no `.git` or `.system1/`, `findRepoRoot` silently falls back to `cwd`.** The runtime never walks up (D1).
5. **`ModelProfile.transport` is read nowhere.** `deciderFor` always builds the decisions transport, and any `profiles:` entry can already be selected through `SYSTEM1_MODEL`. Transport dispatch is new, and the refusal of emulated keys on the transport kind, not on the id (D2).
6. **`createDecider` is public and unguarded** (`index.ts`). The runtime gets its own entry point, and templates may import only that (D5).
7. **Core `ChoiceAnswer`/`ScoreAnswer` require `probabilities` and `confidence`.** An emulated single value is not an `Answer` and never becomes one (D2).
8. **`adopted` exists as a status,** but setting it means re-adding the whole candidate. `decide opportunities set-status` is added (PR 9).
9. **`policy.thresholds` is read only by lint.** Templates read the spec's thresholds themselves.

## Decisions (2026-09-30)

The maintainer ruled on 1, 2, 6 and 8. The others are the agent's proposals, and stand unless changed.

| # | Question | Proposed |
|---|---|---|
| 1 | **How does adopted code get runtime consent (0020)?** *Maintainer.* | **The marked line in the generated module is the grant, and nothing else is.** `adopt` writes `const EGRESS = "off" // system1: runtime egress…`. Switching it to `"on"` is a user edit in reviewed code. The runtime needs no repo config: a deployed app may have none, and consent is never read from env. A generated test fails if adopt's own output has it on, and `tools/validate.ts` scans the templates. |
| 2 | **What is `emulated`?** *Maintainer: Haiku 4.5.* | A second transport kind, `openrouter-chat`: a chat model on OpenRouter given a strict JSON schema derived from the question set (ported from `jev-poc/shared/baseline.ts`). Model: **`anthropic/claude-haiku-4.5`**, `jev-poc`'s baseline, so earlier measurements carry over.<br>- Its profile id is `emulated:<model>`, with `calibrated: false`.<br>- It sends `provider.data_collection: "deny"`.<br>- **Parsing is strict:** a score must be an integer level, a noul must lie in 0–1 and a choice must be an offered key. Anything else is a counted parse failure; nothing is rounded or clamped (`jev-poc` does both).<br>- Its answers are a separate `BaselineAnswer` type that never enters `Answers`, `project()` or thresholds.<br>- A repo-only opt-in `egress.allow_profiles: [emulated:<model>]` is set by `decide config egress allow-profile <id> --confirm`.<br>- It is refused everywhere but `compare`, with a new error `profile-not-allowed`, exit 2. |
| 3 | **How does `compare` get its states and the current answers?** | The shadow harness (user code) runs the current mechanism, applies the generated output→answer mapping itself, and appends `{id, state, current, output?, usage?, latencyMs?}` to `.system1/compare/<spec>/captured.jsonl`.<br>- `decide compare` reads only `state` for the model calls, and joins on `id`. The engine runs no user code (0014).<br>- A missing `usage` means cost unknown, never zero. |
| 4 | **What is the state-level entry point?** | `prepareState(state, {questions, profile})`: scrub plus the size check on an in-memory string or object, returning `{state, tokens, redactions}` or a typed refusal. `prepare()` gains a `state` source kind built on it, so an object stays an object and fixture keys match. Excludes don't apply, and the docs say so. |
| 5 | **What surface does adopted TypeScript import?** | A new subpath, **`@garygentry/system1-core/runtime`**: `createPolicyRuntime`, `prepareState`, the reason codes and their types, and nothing else. The `./runtime` exports are pinned by a test. A breaking change needs a minor bump plus a decision record, and `adopt` pins an exact version. M13 extends this into the full policy. |
| 6 | **How does the runtime behave in a deployed app?** *Maintainer: $1.00 a day.* | `createPolicyRuntime({root?, egress, maxUsdPerDay, model?, fixtures?})`. It never walks up the tree.<br>- `root` names where the ledger and fixtures go. If it is absent or unwritable, spend is counted in memory and every result carries `ledger: "memory"`.<br>- **Spend cap:** `maxUsdPerDay` per process, measured, written explicitly into each generated module (default **$1.00**). At the cap it falls back with `budget`.<br>- **Every non-model result is a fallback with a reason code:** `egress-off`, `undecided`, `provider-error`, `refused` (size or scrub), `budget`, `timeout`, `no-key`, `engine-unavailable` (Python). |
| 7 | **How does Python reach the engine?** | It spawns `decide runtime <spec> --root <dir> --egress on\|off`, with the state as JSON on stdin and one result JSON on stdout. `--egress` comes only from the Python module's marked line, and `validate.ts` forbids `--egress on` in skills and templates, as it does `--i-consent`. The module runs a `decide version` check once at startup, with an `engine-unavailable` fallback. |
| 8 | **Dogfood targets?** *Maintainer: the agent proposes Python candidates.* | **TypeScript:** `packages/core/src/route/route.ts`, the regex prompt router. M9 named it "a natural first dogfood for M11's adopt"; its benefit is quality, and the ask routing sets give it labels. **Python:** to be chosen at the start of PR 10 from 2–3 candidates the agent proposes (a small public repo with an LLM call parsed to an enum or bool), and named here before any work on it. |

## Integration points

- **Consent and config:** `config/load.ts` (`KNOWN` egress keys, the repo-only `readConsent`), `config/consent.ts` (`setConsent`, the precedent for an `allowProfile` edit), `cli/src/commands/config.ts` (the TTY/`--confirm` gate).
- **Transport:** `transport/openrouter.ts` (the `Transport` interface, `RETRY_STATUSES`); dispatch in `tools/context.ts` `deciderFor`; profiles in `model/profiles.ts` and `load.ts` `profileList`.
- **Decider:** `decide.ts` (scrub, `assertStateFits`, `assertConsent`, ledger append at `:138` and `:157`).
- **Prepare:** `prepare.ts`, `sources/types.ts` (add `state`), `split/split.ts`.
- **Tools and CLI:** `tools/schemas.ts` `TOOL_SCHEMAS`, the `runX(ctx, raw)` pattern, `cli/src/main.ts` lazy switch and `HELP`, flag tables checked by `tools/docs.test.ts`, `errors.ts` plus `cli/src/exit-codes.ts` `BY_CODE` (a `Record`, so a new code must be mapped), and 0015's amendment log.
- **Doctor:** `tools/doctor.ts` `DOCTOR_CHECKS`; `gitIgnored()` for the captured-file check.
- **Opportunities:** `opportunities/backlog.ts` (`mergeCandidates`, `withBacklogLock`).
- **Specs:** `spec/spec.ts` `loadSpec`, `specDirs`; the spec name is the fixture namespace.
- **Skills and generation:** `plugins/system1/skills/<name>/` plus `agents/openai.yaml` (`allow_implicit_invocation: false`, `disable-model-invocation: true`). Discovery is by convention. Also `tools/validate.ts`, and `tools/evals/run.ts` `SKILLS` and `MINIMUMS`.
- **Setup's `.gitignore` list:** `skills/setup/SKILL.md` § Housekeeping gains `.system1/compare/*/captured.jsonl`.
- **Smoke:** `tools/smoke/{lib,claude,codex,pi}.sh`.

## Work, as PRs (each green on `pnpm check`, with an adversarial review before merging)

1. **0020 and this plan.** Write the decision record from D1, D6 and D7 as proposed, then get it accepted.
2. **Engine hardening.**
   - A ledger or fixture write that fails becomes a typed, non-fatal outcome: the call's answer is kept and the failure reported. It is never a raw throw after a paid call.
   - `prepareState` and the `state` source kind (D4).
3. **`./runtime`** (D5, D6): `createPolicyRuntime`, the reason codes, the in-memory ledger, `maxUsdPerDay`, no walk-up.
   - Tests from a temp directory with no `.git`, and with a read-only root (`chmod`).
   - The export-pin test, and `docs/runtime.md` with the stability promise.
4. **Transport dispatch and `emulated`** (D2): the schema, prompt and strict parse ported with tests against `jev-poc`'s fixtures.
   - The `allow_profiles` opt-in and its CLI.
   - `profile-not-allowed` in `ask`, `many`, `hook`, `spec check` and the runtime.
   - 0015 amended.
5. **`decide compare`** (D3), as a core tool with a CLI and `decide schema compare`.
   - **Signals:** cost per call (unknown when missing), latency, decisiveness, undecided share, agreement by question type, baseline parse rate.
   - **Labels:** with `.system1/labels/<spec>.jsonl`, accuracy with its n; without labels, no winner.
   - It writes `report.json`.
6. **`decide runtime` for Python** (D7), plus `decide opportunities set-status`.
7. **Templates**, kept as skill references under `skills/adopt/references/templates/{ts,python}/`: the policy module, the mapping, the shadow harness and offline tests against recorded fixtures.
   - The validator scans them for `egressConsent: true`, `EGRESS = "on"` and `--egress on`.
   - A Codex smoke runs the generated Python tests.
8. **Skills:** `adopt` and `compare` (user-invocable).
   - Setup's `.gitignore` list.
   - Doctor checks for runtime consent in adopted modules found by marker, the emulated allow-list, and captured files not ignored.
   - Routing sets and `MINIMUMS`.
9. **Dogfood, TypeScript:** `route.ts` through adopt → capture → compare, with the numbers recorded in the spec's Results.
10. **Dogfood, Python:** choose the target (D8), then take it through the whole chain.
11. **Docs:** the chain, the policy module, runtime consent and environment, the emulated profile and its opt-in, and the report format. Update `docs/architecture/`, whose README still says 0.3.1. Then the 0.6.0 release.

**Contingency (spec):** if 0020 isn't accepted by the time PRs 4–5 land, 0.6.0 ships compare plus policy modules with runtime egress off, and runtime consent follows in a point release.

## To verify along the way

- Does OpenRouter's chat endpoint honour `provider.data_collection: "deny"` for the chosen model, and report usage and cost in the response?
- Does `strict: true` structured output hold for the chosen model, and at what parse-failure rate on the dogfood states?
- Inside the Codex sandbox, does a Python test that spawns `decide` (node) see stdout? The known quirk is node spawning node.
- Does `adopt` in a real Claude session keep the marked line off, with the generated test catching a flip?
