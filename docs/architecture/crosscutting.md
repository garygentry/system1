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
| Opt-ins on top of consent | `packages/core/src/config/consent.ts`, `packages/cli/src/commands/config.ts`, `packages/cli/src/commands/guard.ts` | A guard pack sends only when `guard.packs.<pack>.enabled` and consent are both in the repo file; an emulated baseline only when its id is in `egress.allowProfiles`, also repo-only. `decide guard enable` and `decide config egress allow-profile` need a terminal or `--i-consent`; `--confirm` doesn't count. `tools/validate.ts` (`USER_ONLY`) fails any skill file that spells `--i-consent`, `allow-profile` or `allowProfiles`. |
| A second vendor only in `compare` | `assertDecisionProfile` in `packages/core/src/model/profiles.ts`, `createDecider` in `decide.ts`, `tools/compare.ts` | An `openrouter-chat` profile can't build a decider, so `ask`, `many`, `spec check`, a guard hook and the runtime all refuse it with `profile-not-allowed`. `compare` builds its own client (`baseline/client.ts`) and refuses a profile the repo hasn't allowed before Jev spends anything. A chat profile can't come from the user config (`profileList` in `config/load.ts`). |

Replay sends nothing, so it needs no consent and no key. The Claude prompt hook sends nothing
either: `decide route` matches the prompt locally and never builds a decider
([0018](../../plans/decisions/0018-claude-routing-hook.md)). The guard hooks return `{}` having
read only the config until the pack is enabled and consented (`runHook` in
`packages/core/src/tools/hook.ts`).

### The exception: adopted code

An adopted module runs in the user's application, where there may be no repo config to hold
consent. Its grant is one marked line of reviewed code
([0020](../../plans/decisions/0020-runtime-consent-for-adopted-code.md), which amends 0009 for this
case). Everything else about egress still holds except excludes.

| Piece | Where | What it guarantees |
|---|---|---|
| The grant is a line | `grantIn()` in `packages/core/src/runtime/grant.ts` | On only when exactly one line carries `system1: runtime egress` and assigns the literal `"on"` to `EGRESS` at column 0, with nothing after it but the marker. Two marked lines, a computed value or an indented line are off. No flag, config key or environment variable grants it. |
| Two locks in TypeScript | `moduleLock()` in `packages/core/src/runtime/runtime.ts` | With `egress: "on"`, a live call also needs the file named by `module` (`import.meta.url`) to say on. Without `module`, it falls back with `egress-off`. `module: "bundled"` opts out, for builds that strip comments; then the value passed is the only lock. |
| Two locks in Python | `packages/cli/src/commands/runtime.ts` | `decide runtime` reads the grant from `--module` itself, and refuses a live call with `egress-off` while a harness session variable is set (`HARNESS_SESSION_VARS`): a deterrent against an agent running a module it just wrote, not a control. It loads no config and reads no `SYSTEM1_*` variable. |
| Scrub and size, no excludes | `prepareState()` in `packages/core/src/prepare-state.ts`, then `decide.ts` | Every runtime state is scrubbed and size-checked twice, as any other. Excludes match paths and an in-memory state has none, so the module decides what goes into a state. |
| `adopt` never writes "on" | `plugins/system1/skills/adopt/references/templates/{ts,python}/grants.*`, `tools/validate.ts`, `tools/templates.test.ts` | Each generated module's test scans the module as written for any grant, not one spelling (an `EGRESS` set to anything but `"off"`, `egress:` from a variable, `egressConsent`, an `EGRESS` from the environment), and fails if its own line is on. `pnpm validate` runs the same scan over the templates, and refuses `decide runtime` in any skill file outside them. |
| Visible after the fact | `adoptedCheck()` in `packages/core/src/tools/doctor-adopt.ts` | `decide doctor` finds adopted modules by the marker, `createPolicyRuntime` or a `"bundled"` opt-out (`git grep`), and warns (advisory) on any with egress on or the lock opted out. |

The control is the user's review of the diff: nothing in generated code can stop an agent from
writing a grant, so these make one visible, not impossible (0020, "What we give up").

**Adding a new source or a new command that decides:** route it through `prepare()` (or
`prepareState()` for a state held in memory) and `deciderFor()` in
`packages/core/src/tools/context.ts`. Don't construct a transport anywhere else; the runtime
builds its own because it has no tool context, and `baselineFor()` is for `compare` alone. Every
content POST goes through `postJson()` in `packages/core/src/transport/post.ts`. The only other
`fetch` in the engine is `packages/core/src/ping.ts`, a keyless GET of the public model listing
that carries no content; keep it that way.

## Honest numbers

The rule: projected costs are labelled as projected, every answer carries its `source`, and a
replay miss is an error, never a synthesised answer
([0010](../../plans/decisions/0010-no-key-replay-only-a-fixture-miss-is-a-typed-error.md)).

- **Projected.** `project()` in `packages/core/src/run/budget.ts` returns `basis: "projected"`
  and the price date it used. The token estimate (`packages/core/src/egress/size.ts`, 3 characters
  per token) overestimates on purpose, and the projection adds the profile's `callOverheadTokens`
  per call, for the prompt the provider wraps around each request. The spend guard compares only
  projections.
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
- **A paid failure is counted.** `transport/post.ts` decides, per attempt, whether it may have
  been billed (`mayHaveRun`). A failure that may have been carries `details.spent`
  (`{usage, uncounted}`) and is logged before it is reported; an answer whose retries may have been
  billed unreported carries `uncountedAttempts`, and its `usage` is marked `reported: false`. A
  `many` run folds its failed items' spend into `usage`.
- **`compare` names no winner without labels.** `winner` is `null` unless
  `.system1/labels/<spec>.jsonl` exists, and then it is decided only on the labelled answers both
  sides gave (`headToHead` in `packages/core/src/compare/signals.ts`), each accuracy with its `n`.
  A capture row with no `usage` is cost unknown, never zero (`costSignal`). The emulated
  baseline's replies are parsed strictly and counted in `baseline.parsed`; nothing is rounded or
  clamped into an answer (`packages/core/src/baseline/parse.ts`).
- **Emulated answers stay apart.** A `BaselineAnswer` is a single uncalibrated value, a different
  type from `Answer`, and never reaches `project()`, a threshold or a decider. Its profile says
  `calibrated: false`.
- **The runtime's cap counts what it can't see.** `maxUsdPerDay` is counted from the provider's
  reported cost, at the projection for each attempt billed unreported, and at the projection for a
  call abandoned at its deadline (plus any excess it later reports). Each call reserves its
  projection first, so concurrent calls in one process can't pass the cap together; a call's
  measured cost can still pass it by the difference. Across processes it holds only through a
  shared, writable `root`, and in memory it resets on restart (0020 §4). A cap that isn't a finite
  number of at least 0 makes every call fall back, never uncapped.

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
- **Two commands are outside the envelope**, because something other than an agent reads them:
  `decide hook` (the harness's hook JSON) and `decide runtime` (one policy result). Both always
  exit 0 and report problems in their own output (`systemMessage`, or a fallback with `internal`).
  `main.ts` dispatches them before it parses `--format`. Their stdin shapes are
  `decide schema hook` and `decide schema runtime`, and `RUNTIME_PROTOCOL` changes only when the
  runtime's stdin/stdout shape does (0015, M10 and M11 amendments).

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
  A `profiles` entry with the chat transport is taken only from the repo file.
- **Consent**, `egress.allowProfiles` and `guard.packs.<pack>.enabled` come only from the repo
  layer; set in the user file they are ignored with a warning.
- **The runtime reads no config at all.** `createPolicyRuntime` takes its environment as options,
  and `decide runtime` reads only `OPENROUTER_API_KEY` from the environment.
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
