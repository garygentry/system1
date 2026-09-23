# Crosscutting rules: egress, honesty, contract, secrets

The invariants every change keeps, and the code that enforces each. The rules themselves are stated
once, in [AGENTS.md § Rules](../../AGENTS.md#rules); this page doesn't restate them, it says where
each one lives, so a change that touches that code knows what it must preserve.

## Egress

The rule: every path to the provider goes through `prepare()` and a decider built with
`egressConsent`, and consent lives only in `<repo>/.system1/config.yaml`
([0009](../../plans/decisions/0009-egress-consent-once-per-repo.md)).

| Piece | Where | What it guarantees |
|---|---|---|
| One content path | `packages/core/src/prepare.ts` | Sources are read, excluded, scrubbed, split, excluded again, scrubbed again and size-checked before anything can be sent. |
| Excludes | `packages/core/src/egress/exclude.ts` | `DEFAULT_EXCLUDES` always apply; `egress.exclude` in config only adds. Matched on the given and the resolved path, so a symlink to `.env` is withheld. |
| The repo boundary | `packages/core/src/sources/read.ts` | Content that resolves outside the repo root is withheld as `outside-repo` unless `--allow-outside`. |
| Scrubbing | `packages/core/src/egress/scrub.ts` | Secret-shaped text and credential-named fields are redacted; counts are reported in `redactions`. |
| The last boundary | `packages/core/src/decide.ts` | The decider scrubs the state and the questions and checks the size again before the wire, so a library caller can't skip `prepare()`'s protections. |
| Consent is required | `DeciderOptions.egressConsent` in `decide.ts` | The option is mandatory, so no caller can build a decider and forget it. Live and record call `assertConsent` before the transport. `tools/many.ts` also checks once before the fan-out. |
| Consent is per repo | `readConsent` in `packages/core/src/config/load.ts` | Consent is read only from the repo layer. A grant in the user config is ignored rather than covering every repo. |
| Consent is the user's | `packages/cli/src/commands/config.ts` | `decide config egress allow` needs an interactive terminal or `--confirm`. Skills never pass `--confirm` ([0015 § Consent guard](../../plans/decisions/0015-cli-contract-v1.md#consent-guard)). |

Replay sends nothing, so it needs no consent and no key. The Claude prompt hook sends nothing
either: `decide route` matches the prompt locally and never builds a decider
([0018](../../plans/decisions/0018-claude-routing-hook.md)).

**Adding a new source or a new command that decides:** route it through `prepare()` and
`deciderFor()` in `packages/core/src/tools/context.ts`. Don't construct a transport anywhere else.
The only other `fetch` in the engine is `packages/core/src/ping.ts`, a keyless GET of the public
model listing that carries no content; keep it that way.

## Honest numbers

The rule: projected costs are labelled as projected, every answer carries its `source`, and a
replay miss is an error, never a synthesised answer
([0010](../../plans/decisions/0010-no-key-replay-only-a-fixture-miss-is-a-typed-error.md)).

- **Projected.** `project()` in `packages/core/src/run/budget.ts` returns `basis: "projected"`
  and the price date it used. The token estimate (`packages/core/src/egress/size.ts`, 3 characters
  per token) overestimates on purpose. The spend guard compares only projections.
- **Measured.** `usage` comes only from the provider's response (`packages/core/src/decide.ts`)
  and is zero for a replay. When the provider sends no usage, the response is marked
  `reported: false`, and `sumUsage()` in `packages/core/src/run/spend.ts` carries that mark into
  any total, so a sum is shown as a lower bound rather than a false zero. The ledger records only
  measured figures.
- **Source.** Every `DecisionResult` carries `source: "live" | "replay"`, and so does a `many`
  result, because every item in a run shares the decider's mode.
- **Replay miss.** `FixtureStore.lookup()` has no fallback: a missing fixture, or one written in
  another fixture format, is a miss, and the decider throws `replay-miss` (exit 6). The fixture
  key includes the requested model id, so a model change misses instead of replaying the old
  model's answers.
- **Undecided.** Answers too flat to act on are named in `undecided` and never rounded to the top
  option (`packages/core/src/model/answers.ts`); the projection lists them apart and never
  thresholds them (`packages/core/src/project/project.ts`).

## The CLI contract

The rule: one JSON envelope `{v, ok, command, result|error}` per command, and a fixed exit code per
error class ([0015](../../plans/decisions/0015-cli-contract-v1.md)).

- **The envelope** is built only by `ok()` and `fail()` in `packages/cli/src/envelope.ts`, and
  printed only by `emit()` in `packages/cli/src/run.ts`. `ENVELOPE_VERSION` is 1.
- **Error codes** are the `ErrorCode` union in `packages/core/src/errors.ts`. Add codes; never
  rename one.
- **Exit codes** are `EXIT` and `BY_CODE` in `packages/cli/src/exit-codes.ts`. `BY_CODE` is typed
  over every `ErrorCode`, so a new code doesn't compile until it has an exit status. Add codes;
  never renumber.
- **Docs follow.** `tools/docs.test.ts` fails until `docs/cli.md` has the exit-code table that
  matches `EXIT` and `BY_CODE`, and `docs/troubleshooting.md` has a section per error code and per
  doctor check.
- **Inputs are strict.** The TypeBox schemas in `packages/core/src/tools/schemas.ts` refuse
  unknown properties, and `decide schema <tool>` prints them.

Adding a field to a result is not breaking. Removing or renaming a field, or changing its type, is
a breaking change to the envelope or a result shape: it bumps `ENVELOPE_VERSION` and needs a
decision record. Exit codes and error codes are never renumbered or renamed at all.

## Config layering and secrets

The rule: defaults → user config → repo config → environment, with tests never reading the real
user config, and the key never printed.

Where it happens: `loadConfig()` in `packages/core/src/config/load.ts`.

- **Scalars** (`model`, `endpoint`, `concurrency`, `timeoutMs`, `budget.*`): the repo layer wins
  over the user layer, which wins over `DEFAULTS`. `SYSTEM1_MODEL` and `SYSTEM1_ENDPOINT` win over
  both.
- **Lists add up**, user first: `egress.exclude`, `profiles`, and `route.disable`,
  `route.triggers` and `route.ignore`. `SYSTEM1_ROUTE=off` disables routing whatever the files say.
- **Consent** comes only from the repo layer (above).
- **Other environment:** `SYSTEM1_REPLAY` forces replay, `SYSTEM1_SESSION` overrides the detected
  harness session, and `SYSTEM1_SPECS_PATH` overrides the bundled specs directory
  (`packages/core/src/tools/context.ts`).
- **Tests** that load config must pass a temporary `home` to `loadConfig()` or `createContext()`,
  so they never read the real `~/.config/system1`.

Secrets:

- **The key** comes from `OPENROUTER_API_KEY`, else `~/.config/system1/credentials`
  (`resolveApiKey` in `load.ts`). A credentials file readable by group or others is refused with
  `config-error`, as ssh does for private keys.
- **Never printed.** `decide config` and `decide doctor` report only whether the key is present and
  where it came from. The key goes nowhere but the transport's `Authorization` header
  (`packages/core/src/transport/openrouter.ts`).
- **No `.env`.** The engine and CLI never read one; a project's `.env` belongs to that project. The
  only loader is `vitest.live.config.ts`, for this repo's own live test. `.env` files are also in
  `DEFAULT_EXCLUDES`, so they are never sent, and so is any file at `.system1/credentials`.
