# Plan: M10 §3–§6 — guard state, `decide hook`, `done-check`, wiring

- **Status:** in progress, 2026-09-27. Merged: §1 spike (#23), §2 `guard` (#24), PR 1 state (#25), PR 2 hook runner (#26), PR 3 gathering (#27), PR 4 decisions (#28). PR 5 (wiring) in review; then §7–§9 and 0.5.0.
- **Spec:** [`milestones/M9-M11-scout-guard-adopt.md`](milestones/M9-M11-scout-guard-adopt.md) §M10. This file is the implementation plan for work items 3–6; the spec wins where they differ, except for the decisions below.

## Decisions (maintainer, 2026-09-27)

| # | Question | Choice |
|---|---|---|
| 1 | What does `maxUsdPerSession` count? | **Guard spend only.** Ledger entries get an optional `tag` (for example `guard:done-check`), and the cap sums only the entries with the pack's tag. |
| 2 | Should a local check for a completion claim in the last message be in 0.5.0? | **No, it's deferred.** The hash skip already sends nothing on an unchanged re-stop. §8 measures the false blocks on non-completion stops, and that data decides whether to add the check later. |
| 3 | What if a Codex hook has no network? | **Wire Codex anyway.** It fails open with "not checked: no network from the Codex hook", and the docs say so and give the fix if there is one. |
| 4 | Where does spend live? | **In the spend ledger**, by session id and tag, not in the state file. The spec says "spend so far" in state, but the ledger is measured and append-only, so a second copy would drift. |
| 5 | How is the session id formed? | The generated wiring passes `--harness claude\|codex`. The hook sets `SYSTEM1_SESSION=<harness>:<session_id from stdin>`, unless it is already set. Without the flag, a present `turn_id` means Codex. |

## Integration points

- **CLI dispatch:** `packages/cli/src/main.ts`, the lazy switch. `hook` bypasses `emit()` and the envelope.
- **Hot-path tool pattern:** `packages/core/src/tools/route.ts`, with its input check written by hand and a subpath export in `packages/core/package.json`.
- **Session and ledger:** the session comes from `config/session.ts` `detectSession`, then `config/load.ts`, then `tools/context.ts` `deciderFor`, and is written to each ledger line (`decide.ts`). Totals come from `run/spend.ts` `SpendLedger.summary({session})`.
- **Lint pre-filter:** `spec/lint.ts` `lintStatement(text)`.
- **Change:** `prepare.ts` `prepare()`. The diff source (`sources/read.ts`) takes the base sha as its `range`.
- **Lock and atomic write:** `opportunities/backlog.ts` `withBacklogLock`. Extract it into a shared `withFileLock`.
- **Wiring:** `tools/generate.ts` `claudeHooks()` and the manifests. Hook tests go in `tools/hooks.test.ts`, and the startup bench is `tools/bench-startup.ts`.

## Work, as PRs (each green on `pnpm check`, with an adversarial review before merging)

1. **State.** A shared `withFileLock` and `guard/state.ts`:
   - `GUARD_STATE_FORMAT = 1` and a TypeBox schema with its validator. Per session it holds `harness`, `base` (a sha, or `null`), `baseSource` (`session-start` or `first-stop`), `startedAt`, `criteria` snapshots (`{path, sha256, text?}`, text capped at 16 KB per file), `last` (`{hash, at, outcome}`) and `updatedAt`.
   - Writes are atomic.
   - Every write prunes: sessions idle for more than 14 days go, and the newest 200 are kept.
   - A file over 1 MB, or one that is invalid, fails open with a message and is never deleted automatically.
2. **Hook runner.** `decide hook <pack> [--harness]`:
   - Stdin is capped at 1 MB. Stdout carries only the harness's hook JSON.
   - It **always exits 0**; under Claude, exit 2 would be a blocking error.
   - An amendment to 0015 and `decide schema hook`.
   - **Dormant fast path:** it imports only config and packs, and prints `{}` unless the pack is enabled and consented. It then allows at once when `stop_hook_active` is set.
   - **Fail open with a `systemMessage`** for each class of error: consent, provider, timeout (`latencyMs`, clamped to 55 s or less), replay miss, budget, size, git, internal.
   - SessionStart records the base, and keeps the existing base on `resume` or `compact`.
   - `done-check` is a stub that allows.
   - A bench case: the dormant path under 150 ms.
3. **done-check gathering.**
   - Criteria bullets, with `[x]` dropped. A criteria file that changed since the session base is read at its base version, from git or the snapshot, and the reason says so.
   - `lintStatement` flags go to "check these yourself".
   - The change: the diff against the base, untracked files (`git ls-files --others --exclude-standard -z`) and the evidence files, all through one `prepare()`.
   - Withheld paths are listed. A criterion that names a withheld path goes to "check yourself".
   - A hash skip for an unchanged re-stop.
4. **done-check decisions.**
   - Two `noul`s per criterion: judgeable (`j<i>`) and met (`m<i>`). The diff is marked as data, not instructions.
   - **Oversize:** one call per criterion over the files whose path or content shares the criterion's words. If it still doesn't fit, report it as not checked.
   - **Block** only if `p(judgeable) ≥ T.judgeable` and `p(met) ≤ 1 − T.unmet`. Both thresholds start at 0.8 as a provisional named constant, fitted in §8.
   - Block once, with the reason naming each unmet criterion plus the "check yourself" list. Otherwise, a `systemMessage` summary.
   - **Spend:** the per-event `checkBudget`, never confirmed, and the per-session cap summed from the ledger by `tag`.
5. **Wiring.**
   - `SessionStart` and `Stop` entries in `claudeHooks()`, running `SYSTEM1_NO_NPX=1 "${CLAUDE_PLUGIN_ROOT}/bin/decide" hook done-check --harness claude`, with timeouts of 10 s and 60 s.
   - A new `codexHooks()` writes `hooks/codex-hooks.json` (`${PLUGIN_ROOT}`, guard entries only; routing stays Claude-only), and the `.codex-plugin` manifest gets a `hooks` key.
   - Commands stay version-free, because a changed entry makes Codex ask for trust again.
   - **Doctor** warns about two things: guard enabled but the Codex hooks untrusted (`$CODEX_HOME/config.toml` `hooks.state`), and the latency of the npx route.

Then the spec's §7 (the `guard` skill), §8 (evaluation, which fits the thresholds), §9 (docs) and the 0.5.0 release.

## To verify along the way

- Does the Codex Stop `session_id` equal `CODEX_THREAD_ID`, and does the Claude one equal `CLAUDE_CODE_SESSION_ID`? The ledger's session ids depend on it.
- Does a Codex hook command have network (decision 3)?
- Does Codex key hook trust as `system1@<mkt>:hooks/codex-hooks.json:stop:0:0` for a hooks file in a subdirectory? The doctor match accepts any `…codex-hooks.json:stop:` form. Confirm it in the 0.5.0 Codex smoke.
- Doctor's warning about npx-route latency (§6) is not built yet. It goes with §9's docs on install latency.
- Is the 0.5.0 release the first real run of `release.yml` after #18? Check its `verify` and `stage` jobs before approving.
