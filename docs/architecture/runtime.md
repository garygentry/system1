# Runtime: one `decide many` call, and the prompt hook

Two traces: a fan-out from argv to envelope, and the Claude hook from prompt to hint. Together they
show where each guarantee is enforced. `decide ask` follows the same path with one item and no
budget check.

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
   included, appends a ledger line.
9. **Projection.** `project/project.ts` applies `keep`, `sort`, `limit` and `fields`. Undecided rows
   are listed apart and never thresholded.
10. **Output.** `emit()` wraps the result in the envelope `{v, ok, command, result}`, or renders
    `brief` or `jsonl`, and returns exit 0.

## Where each guarantee lives

| Guarantee | Enforced in | How |
|---|---|---|
| No content leaves without the repo's consent | `tools/many.ts`, `decide.ts` | `many` calls `assertConsent` before the fan-out; the decider checks again before every live call, which is the check `ask` relies on. Consent is read only from `<repo>/.system1/config.yaml`. Replay needs none. |
| Secret files are never sent | `prepare.ts`, `egress/exclude.ts` | Excludes run on documents and again after splitting, on the given and the resolved path. |
| Secrets in text are redacted | `prepare.ts`, `decide.ts`, `egress/scrub.ts` | Scrubbed per document, per item, and once more on the state and questions at the wire. |
| Refuse, don't truncate | `egress/size.ts`, called by `prepare.ts` and `decide.ts` | An oversized item fails with `state-too-large` before any call. A `choice` with more options than the profile allows is refused up front too. |
| Spend is guarded | `run/budget.ts`, called by `tools/many.ts` | Over the budget (200 calls or $0.05 projected by default), the run stops with the projection unless `--confirm`. |
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
| Bad config or an insecure credentials file | `config-error` | 2 |
| A source can't be read | `source-error` | 2 |
| An item is over the model's limit | `state-too-large` | 2 |
| Live or record asked for with no key | `no-key` | 2 |
| No consent, in live or record mode | `egress-refused` | 3 |
| Over the spend guard | `budget-exceeded` (projection in `details`) | 4 |
| Transport: unreachable, non-retryable or final HTTP error, bad body | `provider-unreachable`, `provider-http`, `malformed-response` | 5 |
| Replay with no matching fixture | `replay-miss` | 6 |

**Partial failure in `many`.** Items that fail are listed in `result.failed` with their code, and
the run still exits 0 with the rest. If every item fails with the same code, that code is raised
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
work; that needs the deferred Stop-hook `guard` pack (known gap 1).
