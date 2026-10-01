# Plan: M11 — `adopt` + `compare`, runtime consent, the `emulated` baseline

- **Status:** in progress (2026-09-30). Runtime consent: [0020](decisions/0020-runtime-consent-for-adopted-code.md).
- **Order:** the runtime (PR 3) comes before emulated and compare (PRs 4–5), against the spec's stated order, because 0020 was settled first and both later PRs build on PR 2.
- **Spec:** [`milestones/M9-M11-scout-guard-adopt.md`](milestones/M9-M11-scout-guard-adopt.md) §M11. This file is the implementation plan; the spec wins where they differ, except for the decisions below and the corrections in "Where the spec meets the code".

## Where the spec meets the code

A survey of the engine (2026-09-30) found these, and the plan follows them rather than the spec's wording:

1. **§5's `decide many --file <jsonl> --split row` can't carry a capture.**
   - `--file` is a text source, so each line would go out as a raw string.
   - `--jsonl` sends the whole parsed row, so the current mechanism's `output` and `usage` would sit in front of Jev and the emulated model.
   - Row ids are `<path>:row<N>`, not the captured `id`.
   - `many` returns kept, undecided and failed rows, never dropped ones.
   - §2 also has `many` refuse emulated. So `compare` reads the capture itself (D3) and never goes through `many`.
2. **There is no state-level `prepare()`.** `prepare()` takes file, glob, JSONL, diff, text and stdin sources, and excludes are path-based. §3's entry point is new work (D4), and it can't honour excludes: the spec's "scrub, size and exclude steps" becomes scrub and size, a departure recorded in 0020.
3. **A read-only disk breaks a paid call.** `SpendLedger.append` has no catch, so on EROFS the call succeeds and then throws a plain `Error` (exit 1). In record mode the fixture write runs first, so its failure also leaves the spend unlogged. Fixed in PR 2.
4. **With no `.git` or `.system1/`, `findRepoRoot` silently falls back to `cwd`.** The runtime never walks up (D1).
5. **`ModelProfile.transport` is read nowhere.** `deciderFor` always builds the decisions transport, and any `profiles:` entry can already be selected through `SYSTEM1_MODEL`. Transport dispatch is new, and the refusal of emulated keys on the transport kind, not on the id (D2).
6. **`createDecider` is public and unguarded** (`index.ts`). The runtime gets its own entry point, and templates may import only that (D5).
7. **Core `ChoiceAnswer`/`ScoreAnswer` require `probabilities` and `confidence`.** An emulated single value is not an `Answer` and never becomes one (D2).
8. **`adopted` exists as a status,** but setting it means re-adding the whole candidate. `decide opportunities set-status` is added (PR 9).
9. **`policy.thresholds` is read only by lint.** Templates read the spec's thresholds themselves.

## Decisions (2026-09-30)

The maintainer ruled on 1, 2, 6 and 8. The others are the agent's proposals, revised after the adversarial review of 2026-09-30 (notably D7, which first had a `--egress on` flag), and accepted with this plan's merge.

| # | Question | Proposed |
|---|---|---|
| 1 | **How does adopted code get runtime consent (0020)?** *Maintainer.* | **The marked line in the generated module is the grant, and nothing else is.** `adopt` writes `const EGRESS = "off" // system1: runtime egress…`. Switching it to `"on"` is a user edit in reviewed code. The runtime needs no repo config: a deployed app may have none, and consent is never read from env. A generated test fails if adopt's own output has it on, and `tools/validate.ts` scans the templates. |
| 2 | **What is `emulated`?** *Maintainer: Haiku 4.5.* | A second transport kind, `openrouter-chat`: a chat model on OpenRouter given a strict JSON schema derived from the question set (ported from `jev-poc/shared/baseline.ts`). Model: **`anthropic/claude-haiku-4.5`**, `jev-poc`'s baseline, so earlier measurements carry over.<br>- Its profile id is `emulated:<model>`, with `calibrated: false`.<br>- It sends `provider.data_collection: "deny"`.<br>- **Parsing is strict:** a score must be an integer level, a noul must lie in 0–1 and a choice must be an offered key. Anything else is a counted parse failure; nothing is rounded or clamped (`jev-poc` does both).<br>- Its answers are a separate `BaselineAnswer` type that never enters `Answers`, `project()` or thresholds.<br>- A repo-only opt-in `egress.allowProfiles: [emulated:<model>]` is set by `decide config egress allow-profile <id>`, which needs a terminal or `--i-consent`, like `guard enable`. `--confirm` doesn't count, and the validator forbids `allow-profile` in skills.<br>- A profile with the chat transport is defined only by the built-in list or the repo file, never the user file.<br>- It is refused everywhere but `compare`, with a new error `profile-not-allowed`, exit 2. |
| 3 | **How does `compare` get its states and the current answers?** | The shadow harness (user code) runs the current mechanism, applies the generated output→answer mapping itself, and appends `{id, state, current, output?, usage?, latencyMs?}` to `.system1/compare/<spec>/captured.jsonl`.<br>- `decide compare` reads only `state` for the model calls (as `state` sources through `prepare()`), and joins on `id`. The engine runs no user code (0014).<br>- **It is an ordinary repo command:** it needs repo consent (0009) and `allowProfiles` for emulated, and 0011's guard applies to the calls of both profiles together, with `--dry-run` and `--confirm`.<br>- A missing `usage` means cost unknown, never zero.<br>- The harness itself runs the current mechanism, which may be an LLM call that spends and sends outside System 1's guards. The `adopt` skill says so, and warns that `captured.jsonl` holds raw inputs.<br>- No `shadow-evaluator` agent: `compare` is a CLI tool, which closes 0017's open item. |
| 4 | **What is the state-level entry point?** | `prepareState(state, {questions, profile})`: scrub plus the size check on an in-memory string or object, returning `{state, tokens, redactions}` or a typed refusal. `prepare()` gains a `state` source kind built on it, so an object stays an object and fixture keys match. Excludes are path-based and can't apply to a state held in memory; this departs from spec §3, and 0020 and the docs say so. |
| 5 | **What surface does adopted TypeScript import?** | A new subpath, **`@garygentry/system1-core/runtime`**: `createPolicyRuntime`, `prepareState`, the reason codes and their types, and nothing else. The `./runtime` exports are pinned by a test. A breaking change needs a minor bump plus a decision record, and `adopt` pins an exact version. M13 extends this into the full policy. |
| 6 | **How does the runtime behave in a deployed app?** *Maintainer: $1.00 a day.* | `createPolicyRuntime({egress, maxUsdPerDay, root?, model?, mode?, …})` (full list in `docs/runtime.md`). It never walks up the tree.<br>- `root` names where the ledger and fixtures go. If it is absent or unwritable, spend is counted in memory and every result carries `ledger: "memory"`.<br>- **Spend cap:** `maxUsdPerDay`, written explicitly into each generated module (default **$1.00**). In one process it holds against concurrent calls. Across processes it holds only through a shared, writable `root`, and can be overshot by the calls in flight at once. At the cap it falls back with `budget`.<br>- **Every non-model result is a fallback with a reason code:** `egress-off`, `undecided`, `provider-error`, `refused` (size or scrub), `budget`, `timeout`, `no-key`, `engine-unavailable` (Python), `internal` (a bad option, including a model profile the runtime doesn't allow). |
| 7 | **How does Python reach the engine?** | It spawns **`decide runtime --module <its own path> --root <dir>`**, with `{questions, state, namespace}` as JSON on stdin and one `PolicyResult` as JSON on stdout.<br>- **There is no egress flag.** `decide runtime` reads the grant from the module file itself: exactly one line matching the marker, `EGRESS = "on"`, turns it on; anything else is off. So the grant is always a line of reviewed code, never a transient argument an agent can type.<br>- **A live call needs a writable `--root`,** so the cap holds across the one-process-per-call spawns; without it the result is `internal` ("a live call needs --root").<br>- It loads no repo config and reads no `SYSTEM1_*` variable, only `OPENROUTER_API_KEY`.<br>- Its output is not 0015's envelope and it always exits 0, like `decide hook`: PR 6 amends 0015 and adds `decide schema runtime`.<br>- Skills never run it: `validate.ts` forbids `decide runtime` in skill files.<br>- **Version:** the module checks `decide runtime --protocol` once at startup (a small integer that changes only when the stdin/stdout shape does), not the CLI version, so upgrading a global `decide` doesn't switch every Python module to fallback. A protocol mismatch is `engine-unavailable`. |
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

1. **0020 and this plan.** Also amend AGENTS.md's egress rule for the one grant outside the repo config (0020).
2. **Engine hardening.**
   - A ledger or fixture write that fails becomes a typed, non-fatal outcome: the call's answer is kept and the failure reported. It is never a raw throw after a paid call.
   - `prepareState` and the `state` source kind (D4).
3. **`./runtime`** (D5, D6): `createPolicyRuntime`, the reason codes, the in-memory ledger, `maxUsdPerDay`, no walk-up.
   - Tests from a temp directory with no `.git`, and with a read-only root (`chmod`).
   - The export-pin test, and `docs/runtime.md` with the stability promise.
4. **Transport dispatch and `emulated`** (D2): the schema, prompt and strict parse ported with tests against `jev-poc`'s fixtures.
   - The `allowProfiles` opt-in and its CLI.
   - `profile-not-allowed` in `ask`, `many`, `hook`, `spec check` and the runtime.
   - 0015 amended.
5. **`decide compare`** (D3), as a core tool with a CLI and `decide schema compare`.
   - **Signals:** cost per call (unknown when missing), latency, decisiveness, undecided share, agreement by question type, baseline parse rate.
   - **Labels:** with `.system1/labels/<spec>.jsonl`, accuracy with its n; without labels, no winner.
   - It writes `report.json`.
6. **`decide runtime` for Python** (D7): `--module`, `--root`, `--protocol`; the 0015 amendment and `decide schema runtime`; the validator rule against it in skills. Plus `decide opportunities set-status`.
7. **Templates**, kept as skill references under `skills/adopt/references/templates/{ts,python}/`: the policy module, the mapping, the shadow harness and offline tests against recorded fixtures.
   - **Two layers of inert (spec §7.5):** an app-level `enabled` flag that keeps the existing path, and the `EGRESS` line.
   - **The validator scans the templates for any grant, not one spelling:** `EGRESS` assigned anything but `"off"` with any quotes or spacing; `egress: "on"` or `egress:` from a variable; `egressConsent`; an `EGRESS` read from `os.environ` or `process.env`. The generated test in each module does the same over the module as written, so code adapted "in the repo's idiom" is checked too.
   - **Tests from a directory with no `.git` and a read-only root, in TypeScript and in Python** (spec acceptance).
   - The shadow harness warns that `captured.jsonl` holds raw inputs.
   - A Codex smoke runs the generated Python tests.
8. **Skills:** `adopt` and `compare` (user-invocable).
   - Setup's `.gitignore` list.
   - Doctor checks for runtime consent in adopted modules, found by the marker and by any `createPolicyRuntime(` call or `decide runtime` spawn, for the emulated allow-list, and for captured files not ignored.
   - Routing sets and `MINIMUMS`; the Pi package contents.
9. **Dogfood, TypeScript:** `route.ts` through adopt → capture → compare, with the numbers recorded in the spec's Results.
10. **Dogfood, Python:** choose the target (D8), then take it through the whole chain.
11. **Docs:** the chain, the policy module, runtime consent and environment, the emulated profile and its opt-in, and the report format. Update `docs/architecture/`, whose README still says 0.3.1. Then the 0.6.0 release.

**Contingency (spec):** met. 0020 was accepted before any code.

## To verify along the way

- **The transport can lose a paid call's cost (found in PR 2's review; predates M11).** A timeout while reading a 200's body is reported as `malformed-response`; a body that fails validation drops its `usage`; a retry after a server-side timeout can pay twice and log once. The runtime's `maxUsdPerDay` and `compare`'s cost signal count only what the transport returns. Fix in the transport before PR 5 reports cost. *Fixed (2026-10-01, gap B): both clients share `transport/post.ts`, a failure that may have been billed carries `spent` and is logged, and `uncountedAttempts` marks the retries that were billed unreported (0015 amendment). One case is still uncounted: a caller abort, such as the runtime's deadline, after a 200. The runtime keeps its projection for that case; the ledger does not see it.*

- Does OpenRouter's chat endpoint honour `provider.data_collection: "deny"` for the chosen model, and report usage and cost in the response? *Accepted and reported (2026-09-30, PR 4): one live call with the preference answered from `anthropic/claude-haiku-4.5`, 494 input and 25 output tokens, cost $0.000619 reported, which matches the listed price. Whether a provider that keeps data was ever eligible isn't observable from the reply.*
- Does `strict: true` structured output hold for the chosen model, and at what parse-failure rate on the dogfood states? *One live call over a three-question set (noul, score, choice) parsed strictly. The rate on real states is for PR 5's compare runs.*
- Inside the Codex sandbox, does a Python test that spawns `decide` (node) see stdout? The known quirk is node spawning node.
- Does `adopt` in a real Claude session keep the marked line off, with the generated test catching a flip?
