# M1 — Core: model, profiles, transport, fixtures, spend

**Status:** done (2026-09-22)
**Goal:** `@garygentry/decisions-core` can make one decision call, live or replayed. The call returns typed, validated answers labelled with their source. It also records a fixture and appends measured spend to a ledger. There is no CLI decision command yet; that is M3.

## Modules (`packages/core/src/`)

| Module | What | Ported from (jev-poc) |
|---|---|---|
| `model/types.ts` | Wire types: `State`, `Question` (choice/score/noul), `QuestionSet`, `Answer`, `Usage`, `DecisionResponse` | `shared/jev.ts` (types renamed from `Jev*` to model-neutral names) |
| `model/answers.ts` | `isUndecided`, `noulConfidence`, `rankedProbabilities`, type guards, `undecidedNames` | `shared/jev.ts` |
| `model/profiles.ts` | Data-only `ModelProfile` and a registry, `resolveProfile(id)`. Pinned builds such as `typesafe/jev-1.13-20260917` resolve to their family profile | new (decision 0003); numbers from `shared/jev.ts` |
| `transport/openrouter.ts` | `createOpenRouterTransport(opts).decide(req, signal)`: retry/backoff/per-attempt timeout/abort, strict validation of the response | `server/transport.ts` |
| `fixtures/store.ts` | `FixtureStore`, content-addressed as `<dir>/<namespace>/<sha256>.json`. `lookup`, `record` | replaces `server/fixtures.ts`; no synthetic fallback (decision 0010) |
| `run/pool.ts` | `mapWithConcurrency` | `server/concurrency.ts`, verbatim |
| `run/spend.ts` | `sumUsage`, and `SpendLedger`, an append-only JSONL file with `summary()` | `server/spend.ts`, rebuilt as a persisted instance |
| `decide.ts` | `createDecider({profile, transport, fixtures, mode, ledger})`, where mode is `auto \| live \| replay \| record` | new |
| `errors.ts` | `DecisionsError` with a `code` that maps onto the CLI exit codes | new |

## Design points settled here

- **Response validation is stricter than jev-poc's.**
  - Every requested question must be answered, with the type it was asked as.
  - Each answer's fields must have the right JSON types.
  - A mismatch is a `malformed-response` provider error, never a partial result.
- **Modes.**
  - `auto` goes live when a key is present and replays otherwise.
  - `live` needs a key.
  - `replay` never makes a network call, and a miss raises `replay-miss`.
  - `record` is live and also writes the fixture.
  - `DECISIONS_REPLAY=1` forces replay.
- **Fixture key** = sha256 of the canonical JSON (sorted keys) of `{model, state, questions}`.
  - `model` is the *requested* id, so a model upgrade misses the cache instead of silently replaying old answers.
  - A fixture stores the request, the response, `recordedAt`, and the served model build.
- **Ledger.** Each call appends `{ts, session?, model, source, calls, input_tokens, output_tokens, cost}`.
  - A replayed call costs 0 and says so.
  - Nothing in the ledger is estimated.
- **Keys.** The engine never reads `.env`. The CLI does not auto-load a project's `.env` either: an agent working in *another* repo shouldn't pick up that repo's key by accident. Only the live test script loads this repo's `.env`, through `process.loadEnvFile`.
- **Unknown models are refused** with `unknown-model`, which lists the known profiles. Supplying profiles through config comes in M2.

## Acceptance

- [x] 69 offline unit tests cover:
  - the parser, against a real recorded Jev response (`src/testdata/`, from jev-poc's guardrail capture), including six malformed variants;
  - transport retry/backoff (429→503→ok, backoff 100/200), no retry on 401, unreachable after 3 attempts, no retry after caller abort, per-attempt timeout, non-JSON 2xx;
  - fixture key canonicalisation and sensitivity, store round trip, namespace isolation, path-escape refusal;
  - decider modes, `no-key`, `replay-miss` (no network call), validation before spend;
  - ledger persistence, filters and a torn line;
  - pool ordering, failure isolation and peak concurrency.
- [x] `pnpm test:live` made one real call: `typesafe/jev-1.13-20260917`, **370 ms, measured $0.0000199** (473 in / 80 out). All three primitives were answered, and the replay was identical with `source: replay`.
- [x] `pnpm check` passes. Test files are now typechecked too (through `tsconfig.tools.json`).

## Observations from the live call

- The dependency-bump line came back `chore` at confidence 1.0. Jev is as decisive as jev-poc found.
- The same line scored `risk` 0.28 with confidence 0.58 (0.79 / 0.14 / 0.07). That is a decided answer held moderately, and it is well above the 0.15 floor.
- `touches_tests` came back 0.12, correct for a `package.json` edit.
- The response carried `legend` on the score answer, and the parser keeps it.

## Carried forward

- **Noul undecided band:** a noul is treated as undecided when `|noul − 0.5| · 2 ≤ floor`, which means 0.425–0.575 at the 0.15 floor. Nobody has calibrated this against live data yet. Revisit it in M5, when there are real specs.
- **Session id:** `DECISIONS_SESSION` is honoured if set. Detecting it automatically from each harness's environment is M4.
- **Profiles from config:** an unknown model is refused for now. Supplying profiles through config is M2.
