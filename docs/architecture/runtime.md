# Runtime: `decide many`, the policy runtime, `decide compare`, and the hooks

Five traces: a fan-out from argv to envelope, one call from an adopted policy module, one
`decide compare` run, the Claude prompt hook, and the guard hooks. Together they show where each
guarantee is enforced. `decide ask` follows the `many` path with one item and no budget check.

## `decide many`, step by step

```mermaid
sequenceDiagram
    autonumber
    participant CLI as CLI (main.ts, commands/decide.ts)
    participant Many as tools/many.ts
    participant Prep as prepare.ts
    participant Run as run/budget.ts
    participant Dec as decide.ts
    participant Fix as fixtures/store.ts
    participant Tr as transport/openrouter.ts
    participant OR as OpenRouter
    participant Led as run/spend.ts (usage.jsonl)

    CLI->>CLI: extract --format, load the command lazily
    CLI->>CLI: argv → tool input (args.ts); load config (createContext)
    CLI->>Many: runMany(ctx, input)
    Many->>Many: checkInput (TypeBox), resolveRequest (spec, sources, split, profile)
    Many->>Prep: prepare()
    Prep->>Prep: read sources → exclude → scrub → split → exclude → scrub → size
    Prep->>Run: project() the cost
    Prep-->>Many: items, skipped, redactions, projection
    Note over Many: --dry-run returns here
    Many->>Dec: deciderFor() picks the mode
    alt mode is live or record
        Many->>Many: assertConsent (once, up front)
        Many->>Run: checkBudget(projection, --confirm)
    end
    loop each item, under the concurrency cap
        Many->>Dec: decide(item)
        Dec->>Dec: scrub and size-check again, compute the fixture key
        alt replay
            Dec->>Fix: lookup(namespace, request)
            Fix-->>Dec: record, or a miss → replay-miss
        else live or record
            Dec->>Dec: assertConsent
            Dec->>Tr: decide(request)
            Tr->>OR: POST, with timeout and retries
            OR-->>Tr: answers + usage
            Tr->>Tr: validate the body strictly
            Tr-->>Dec: response
            opt record
                Dec->>Fix: record(namespace, request, response)
            end
        end
        Dec->>Led: append (measured usage; zero for a replay)
        Dec-->>Many: answers, undecided, source, usage
    end
    Many->>Many: collect failures, project keep/sort/limit/fields
    Many-->>CLI: ManyResult
    CLI->>CLI: envelope (json) or brief/jsonl; exit code
```

1. **Startup.** `entry.ts` turns on Node's compile cache, then imports `bin.ts`, which calls
   `main()`. `main.ts` takes `--format` out of argv first, so even a flag error is reported in the
   format asked for, then loads `commands/decide.js` on demand.
2. **Tool input.** `args.ts` maps flags to the `many` tool input; `--input` supplies a full JSON
   input and flags override it. `createContext()` loads the layered config once.
3. **Validate and resolve.** `runMany` checks the input against its TypeBox schema, then
   `resolveRequest()` merges any spec's defaults with explicit input and picks the model profile.
4. **Prepare.** `prepare()` reads the sources, withholds excluded paths, scrubs whole documents,
   splits them, excludes again, scrubs each item, and size-checks each item. It returns the items,
   everything withheld with a reason, redaction counts, and a projection labelled
   `basis: "projected"`. It makes no network call. A dry run stops here.
5. **Mode.** `deciderFor()` builds the decider. `auto` becomes `live` when a key is set and
   `replay` when not; `--record`, `--replay` and `--live` choose explicitly; `SYSTEM1_REPLAY`
   forces replay. Asking for `live` or `record` with no key fails with `no-key`.
6. **Consent and budget, once.** Unless the mode is replay, `runMany` checks consent and then the
   spend guard, before any item is sent. `prepare()` always runs before `checkBudget()`, so the
   guard sees the real item count and a projection from scrubbed, size-checked items.
7. **Fan-out.** `mapWithConcurrency` runs `decider.decide()` per item. The cap is the config's
   `concurrency` (8 by default); `--concurrency` can lower it but not raise it. A failed item is
   captured, not thrown, so the siblings already paid for are kept.
8. **Per item.** The decider checks the question set, scrubs the state and the questions again,
   checks the size again, and computes the fixture key. Replay looks the key up. Live and record
   check consent again, then call the transport: up to three attempts, a timeout per attempt
   (`timeoutMs`, 5 s by default), doubling backoff on retryable statuses, and strict validation of
   the response against the questions asked. Record also writes the fixture. Every call, replays
   included, appends a ledger line. A failure that may have been billed (a server-side timeout, a
   gateway error, a 200 whose body didn't validate) carries `spent` and is logged before it is
   thrown (`transport/post.ts`). A ledger or fixture write that fails after a paid call is
   reported in `unsaved`; the answer stands.
9. **Projection.** `project/project.ts` applies `keep`, `sort`, `limit` and `fields`. Undecided rows
   are listed apart and never thresholded.
10. **Output.** `emit()` wraps the result in the envelope `{v, ok, command, result}`, or renders
    `brief` or `jsonl`, and returns exit 0.

## Where each guarantee lives

| Guarantee | Enforced in | How |
|---|---|---|
| No content leaves without the repo's consent | `tools/many.ts`, `decide.ts` | `many` calls `assertConsent` before the fan-out; the decider checks again before every live call, which is the check `ask` relies on. Consent is read only from `<repo>/.system1/config.yaml`. Replay needs none. The one exception is adopted code, whose grant is its marked line ([below](#one-policy-runtime-call)). |
| Secret files are never sent | `prepare.ts`, `egress/exclude.ts` | Excludes run on documents and again after splitting, on the given and the resolved path. |
| Secrets in text are redacted | `prepare.ts`, `decide.ts`, `egress/scrub.ts` | Scrubbed per document, per item, and once more on the state and questions at the wire. |
| Refuse, don't truncate | `egress/size.ts`, called by `prepare.ts` and `decide.ts` | An oversized item fails with `state-too-large` before any call. A `choice` with more options than the profile allows is refused up front too. |
| Spend is guarded | `run/budget.ts`, called by `tools/many.ts`, `tools/compare.ts` and `guard/check.ts` | Over the budget (200 calls or $0.05 projected by default), the run stops with the projection unless `--confirm` (a hook never confirms). done-check also caps each session (`maxUsdPerSession`), and the runtime each UTC day (`maxUsdPerDay`), below. |
| A replay miss is an error | `decide.ts`, `fixtures/store.ts` | A missing or wrong-version fixture throws `replay-miss`; nothing is synthesised. |
| Measured and projected never mix | `run/budget.ts`, `run/spend.ts`, `decide.ts` | Projections carry `basis: "projected"`; `usage` comes only from the provider's report, is zero for a replay, and is marked `reported: false` when the provider sent none. |
| Every answer says where it came from | `decide.ts`, `tools/many.ts` | `source: "live"` or `"replay"` on each decision and on the run. |

The rules themselves, and why, are in [crosscutting.md](crosscutting.md).

## Failure paths

Every failure the engine reports on purpose is a `DecisionsError` with a stable code
(`packages/core/src/errors.ts`). `emit()` in `packages/cli/src/run.ts` turns it into an error
envelope and maps the code to an exit status through `BY_CODE` (`packages/cli/src/exit-codes.ts`).
Anything else is a bug: code `error`, exit 1, with the stack on stderr when `SYSTEM1_DEBUG` is set.

| Where it fails | Code | Exit |
|---|---|---|
| Bad flags or input, unknown spec, no questions or no source | `invalid-request` | 2 |
| A model with no profile | `unknown-model` | 2 |
| An emulated baseline named for a decision, or one the repo hasn't allowed in `compare` | `profile-not-allowed` | 2 |
| Bad config or an insecure credentials file | `config-error` | 2 |
| A source can't be read | `source-error` | 2 |
| An item is over the model's limit | `state-too-large` | 2 |
| Live or record asked for with no key | `no-key` | 2 |
| No consent, in live or record mode | `egress-refused` | 3 |
| Over the spend guard | `budget-exceeded` (projection in `details`) | 4 |
| Transport: unreachable, non-retryable or final HTTP error, bad body (with `details.spent` when it may have been billed) | `provider-unreachable`, `provider-http`, `malformed-response` | 5 |
| Replay with no matching fixture | `replay-miss` | 6 |

**Partial failure in `many`.** Items that fail are listed in `result.failed` with their code, and
the run still exits 0 with the rest. Their possible cost is folded into `usage`, which is then
marked `reported: false` if any of it is unknown. If every item fails with the same code, that code is raised
for the whole run, so a missing fixture or a dead endpoint exits 6 or 5 rather than 0 with an
empty result. An all-items failure with no code of its own is raised as `invalid-request`.
Skipped sources are never failures: they are reported in `result.skipped` with a reason.

## The Claude prompt hook

Claude Code runs `plugins/system1/hooks/claude-hooks.json` on every `UserPromptSubmit`
([0018](../../plans/decisions/0018-claude-routing-hook.md)).

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant Hook as hook command (sh)
    participant Shim as bin/decide
    participant Route as decide route --hook
    CC->>Hook: event JSON on stdin {prompt, cwd, …}
    Hook->>Shim: SYSTEM1_NO_NPX=1 … route --hook --format brief
    Shim->>Route: exec a local CLI, never a download
    Route->>Route: load config from the event's cwd; match triggers, then ignore vetoes
    Route-->>Hook: the hint line, or nothing (exit 0)
    Hook-->>CC: prints the output only if decide exited 0; always exits 0
    CC->>CC: adds the hint to the prompt's context
```

- **It sends nothing.** `tools/route.ts` loads config and runs regular expressions from
  `route/route.ts`. It never builds a decider, so consent and `prepare()` don't apply.
- **It never blocks.** The hook command prints only when `decide` exits 0, discards stderr, always
  exits 0 (exit 2 from `UserPromptSubmit` would block the prompt), and has a 10 s timeout. A bad
  `route:` config makes `decide` exit non-zero, so the hook is silent; `decide doctor` reports it.
- **It never downloads.** `SYSTEM1_NO_NPX=1` stops the shim's final `npx` step. Since 0.3.1 the shim
  first looks for the pinned version in npx's cache, so a plugin-only install hints once any
  `decide` call has fetched the CLI. Before that it stayed silent, which the evals could not see
  because they run the checkout bundle ([known gap 1](../../plans/ROADMAP.md#1-claude-does-not-hand-off-a-review-of-its-own-work-routing-ask)).
  The resolution order is in [deployment.md](deployment.md#how-the-shim-resolves-decide).
- **What it says.** A prompt matches when a built-in or configured trigger fires and no `ignore`
  pattern vetoes it (the built-in veto is "don't use System 1"). The hint is `DEFAULT_MESSAGE`, or
  `route.message` with `{triggers}` expanded. `--format brief` prints only that line, or nothing.
- **It is cheap.** `commands/route.ts` imports the core's `./route` deep export, which skips TypeBox
  and the tool context. `pnpm bench:startup` holds `decide route --hook` to the startup target.

The hook sees only the user's prompt. It cannot catch Claude deciding by itself to grade its own
work; the guard Stop hook below is what checks that, in repos that opt in (known gap 1).

## The guard hooks

Claude Code and Codex run `decide hook done-check --harness <claude|codex>` on `SessionStart` and
`Stop` (`plugins/system1/hooks/claude-hooks.json`, `plugins/system1/hooks/codex-hooks.json`).
`decide hook` is outside the envelope: its stdout is the harness's hook JSON, and it always exits 0
([0015 § M10](../../plans/decisions/0015-cli-contract-v1.md#m10-guard-and-decide-hook-added-2026-09-27)).
User docs: [../guard.md](../guard.md).

```mermaid
sequenceDiagram
    participant H as Claude Code or Codex
    participant Run as tools/hook.ts (runHook)
    participant DC as guard/done-check.ts
    participant St as guard/state.ts
    participant Chk as guard/check.ts
    participant Dec as decide.ts
    H->>Run: event JSON on stdin
    Run->>Run: loadConfig from the event's cwd
    alt pack not enabled, or no consent
        Run-->>H: {} (nothing read, sent or written)
    else stop_hook_active
        Run-->>H: {} (blocked once already)
    else SessionStart
        Run->>DC: sessionStart
        DC->>St: record HEAD and the criteria files, under the lock
        DC-->>H: {}
    else Stop
        Run->>DC: stop (under the latencyMs deadline)
        DC->>St: the session's base and criteria (HEAD now, if SessionStart never ran)
        DC->>Chk: gather the change; skip if unchanged since the last check
        Chk->>Chk: prepare() · 0011 guard · maxUsdPerSession from the ledger
        Chk->>Dec: judgeable? met? per criterion (tag guard:done-check)
        Dec-->>Chk: answers
        Chk-->>DC: block on confidently unmet, else allow
        DC->>St: the hash and outcome of this check
        DC-->>H: {} or {"decision":"block","reason":…}
    end
```

- **Dormant by default.** Until the user runs `decide guard enable done-check` in a repo with
  consent, the hook loads the config, prints `{}` and stops. `guard/done-check.ts` is not even
  loaded.
- **Block once, never on undecided.** A criterion blocks only when it is confidently judgeable and
  confidently unmet (`DONE_CHECK_THRESHOLDS` in `guard/check.ts`); undecided and unjudgeable ones
  are reported, not blocked on. The next stop arrives with `stop_hook_active` and is let through.
- **Fail open, never silently.** Every failure once the pack is active (provider, deadline, budget,
  git, state file, a bug) allows the stop with a `systemMessage` saying why (`failOpenReason` in
  `tools/hook.ts`). Exit 2 would block the harness, so it never happens.
- **The question check.** With `askAboutMessage: true`, the agent's last message is asked about
  first; a confident "this waits on the user" lets the stop through unchecked and sends nothing
  more.

## One policy-runtime call

What happens when an adopted module asks the engine for an answer
(`packages/core/src/runtime/runtime.ts`). User docs: [../runtime.md](../runtime.md); the
module's side is in [containers.md](containers.md#adopted-code).

```mermaid
sequenceDiagram
    autonumber
    participant App as the app's policy module
    participant Py as decide runtime (Python only)
    participant RT as runtime/runtime.ts
    participant PS as prepare-state.ts
    participant Dec as decide.ts
    participant OR as OpenRouter
    participant L as root/usage.jsonl or memory

    alt enabled is not true
        App->>App: fall back: disabled (no call)
    else TypeScript
        App->>RT: decide({questions, state, namespace})
    else Python
        App->>Py: spawn, request on stdin
        Py->>Py: read the grant from --module; refuse live inside an agent session; need a writable --root
        Py->>RT: decide(request)
    end
    RT->>RT: egress on? module's marked line on? key present?
    RT->>PS: prepareState (scrub, size)
    RT->>RT: reserve the projected cost against maxUsdPerDay
    RT->>Dec: decide(state) with the deadline's signal
    Dec->>OR: POST (live) or fixture lookup (replay)
    OR-->>Dec: answers + usage
    Dec-->>RT: result
    RT->>L: swap the reservation for the counted cost (tag runtime)
    RT-->>App: {ok: true, answers} or {ok: false, reason, detail}
    App->>App: apply the spec's thresholds; fall back on below-threshold
```

1. **Setup, once.** `createPolicyRuntime()` validates its options. A cap that isn't a finite
   number of at least 0, an unknown or emulated model, or a bad `timeoutMs` doesn't throw: every
   call falls back with `internal`. With `egress: "on"`, it reads the module file named by
   `module` and keeps why its marked line doesn't say on, if it doesn't. With a writable `root`, it
   reads today's `runtime` spend from `root/usage.jsonl`, so the cap survives a restart.
2. **Gates, in order.** Live mode needs `egress: "on"` (else `egress-off`), the module's own
   marked line on, or `module: "bundled"` (else `egress-off`), and a key (else `no-key`). Replay
   needs a `root` with fixtures, and no grant: it sends nothing.
3. **Prepare.** `prepareState()` scrubs and sizes the state with its questions. Too large is
   `refused`; there are no excludes, because there is no path.
4. **Reserve.** The call's projected cost is added to today's spend before any `await`, so
   concurrent calls in one process can't pass the cap together. Over the cap is `budget`.
5. **Decide.** A decider built for this call (`egressConsent` from the grant, fixtures under
   `root`) does the usual scrub, size check and POST, raced against `timeoutMs` for the whole call.
6. **Settle.** The reservation is swapped for the counted cost: the reported cost, plus the
   projection for each attempt billed unreported. On a timeout the projection is kept, and if the
   abandoned call later turns out to have cost more, the difference is logged then. Each line goes
   to `root/usage.jsonl` with the tag `runtime`; once a write fails, the runtime counts in memory
   for the rest of the process and says `ledger: "memory"`.
7. **Answer.** An answer with any undecided question is `undecided`, with the answers attached for
   the log. Otherwise `{ok: true, source, answers, usage, latencyMs}`. The module then applies the
   spec's thresholds itself and falls back with `below-threshold` when they aren't met.

**Failure paths: reason codes, never throws.** `decide()` always resolves; an exception anywhere
becomes `internal`. The codes are `REASON_CODES`, which apps count:

| Reason | When | Spend counted |
|---|---|---|
| `egress-off` | `egress` isn't `"on"`, the module's marked line isn't on, or (`decide runtime`) a harness session variable is set | none |
| `no-key` | no `OPENROUTER_API_KEY` or `apiKey`, or a malformed one (never echoed) | none |
| `refused` | the state is too large (`state-too-large`), or the decider refused egress | none for size; the projection if the decider refused |
| `budget` | today's spend plus this call's projection would pass `maxUsdPerDay` | none |
| `timeout` | no answer within `timeoutMs` | the projection, plus any late excess |
| `provider-error` | `provider-unreachable`, `provider-http`, `malformed-response`, or a replay miss | what `spent` says may have been billed (none on replay) |
| `undecided` | an answer too flat to act on | the call |
| `engine-unavailable` | Python only: `decide` missing, or `decide runtime --protocol` isn't 1 | none |
| `internal` | a bad option, an emulated model, a malformed request, anything unexpected | the projection, if a call may have run |

`detail` is one log line built from codes and limits, never the state, the key or a response body
(`describe()` in `runtime.ts`). `decide runtime` adds its own `internal` cases (no `--module`, an
unreadable module, a bad `--max-usd-per-day`, no writable `--root` for a live call, a stdin that
isn't one JSON object) and prints the result whatever happens, exit 0.

## One `decide compare` run

`decide compare <spec>` puts the decision model beside a baseline over states the shadow harness
captured (`packages/core/src/tools/compare.ts`). The baseline is either the current mechanism,
whose answers are already in the capture, or the emulated chat model.

```mermaid
sequenceDiagram
    autonumber
    participant CLI as commands/compare.ts
    participant Cmp as tools/compare.ts
    participant Cap as compare/capture.ts
    participant PS as prepare-state.ts
    participant Dec as decide.ts (Jev)
    participant BL as baseline/client.ts (emulated)
    participant Sig as compare/signals.ts

    CLI->>Cmp: runCompare(ctx, {spec, baseline, mode, limit, dryRun, confirm})
    Cmp->>Cmp: load the spec; refuse an emulated --model for Jev
    Cmp->>Cap: readCaptured(.system1/compare/spec/captured.jsonl)
    Cap-->>Cmp: rows (current parsed strictly), bad lines
    Cmp->>PS: prepareState per row, for each side's profile
    Cmp->>Cmp: project both sides
    Note over Cmp: --dry-run returns here
    alt any side live or record
        Cmp->>Cmp: repo consent · emulated in allowProfiles · one 0011 guard over both
    end
    loop each row, under the concurrency cap
        par
            Cmp->>Dec: decide(state)
        and emulated only
            Cmp->>BL: answer(state)
        end
    end
    Cmp->>Cap: readLabels(.system1/labels/spec.jsonl)
    Cmp->>Sig: agreement · decisiveness · undecided · cost · latency · accuracy · head-to-head
    Cmp->>Cmp: winner only from labels; write report.json
    Cmp-->>CLI: the report
```

- **Only `state` is sent.** The capture's `current`, `output` and `usage` never leave the machine.
  Recorded answers go to `.system1/compare/<spec>/fixtures/`, beside the capture, not with the
  spec's committed fixtures, because they hold every captured state. Every call is tagged
  `compare` in the ledger.
- **Gates before any call.** Repo consent, then an emulated baseline must be in
  `egress.allowProfiles` (`profile-not-allowed`, exit 2), then 0011's spend guard over both
  sides' projections together (`budget-exceeded`, exit 4, unless `--confirm`).
- **What fails a row and what fails the run.** A state too large for either profile is withheld
  and listed in `rows.withheld`. A capture line that doesn't parse is listed in `rows.invalid`.
  A call that fails is counted in that side's `failed` by code, and its possible cost still
  counts. A capture with no usable rows is `source-error` (exit 2), and any replay miss fails the
  run with `replay-miss` (exit 6) and the count. A `report.json` that can't be written is
  reported in `reportUnsaved`; the paid-for report is still returned.
- **No winner without labels.** `winner` is `null` unless `.system1/labels/<spec>.jsonl` exists,
  and then it comes from the head-to-head over labelled answers both sides gave, never from
  agreement. The baseline's `parsed` rate counts replies that didn't parse strictly, and a
  missing cost is unknown, not zero.
