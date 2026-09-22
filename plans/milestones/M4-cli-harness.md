# M4 — CLI hardening and harness wiring

**Status:** done (2026-09-22)
**Goal:** `decide` works well inside Claude Code, Codex and Pi. It starts fast, resolves on PATH, reaches the network (or says exactly why it can't), attributes spend to the agent session that caused it, and a real headless session in each harness runs `decide many` through a skill in replay.

## Measured at the start (2026-09-22, 2-core box, load average ≈ 9.4, so absolute numbers are inflated)

| What | Time |
|---|---|
| `node -e 0` | 24–65 ms |
| `decide version` (`dist/bin.js`) | 418–1169 ms |
| `decide version` via `plugins/decisions/bin/decide` | 814–1127 ms |
| `import('typebox')` alone | ≈ 400 ms |
| `import(core/dist/index.js)` | 766–1046 ms |

`NODE_COMPILE_CACHE` barely helped. The cost is **eager module loading**: every command, including `version` and `help`, imports all of core, and core imports TypeBox, yaml, tinyglobby and picomatch whether the command needs them or not.

## Harness facts verified this session

| Harness | Session id in the shell env | Other markers |
|---|---|---|
| Claude Code 2.1.278 | `CLAUDE_CODE_SESSION_ID` (UUID) | `CLAUDECODE=1`, `AI_AGENT=claude-code_<ver>_agent` |
| Codex 0.152.1 | `CODEX_THREAD_ID` (= `CODEX_SESSION_ID`) | `CODEX_SANDBOX_NETWORK_DISABLED=1` in the default sandbox. Does **not** set `AI_AGENT` |
| Pi 0.87.0 | `PI_SESSION_ID`, present even with `--no-session` | `PI_CODING_AGENT=true`, `AI_AGENT=pi` |

- **Parent variables leak into child harnesses.** A Pi or Codex run launched from inside Claude Code still sees `CLAUDE_CODE_SESSION_ID`, and Codex leaves Claude's `AI_AGENT` in place. Detection therefore has to pick the innermost harness, not the first variable it finds.
- **No Codex plugin ships exec-policy rules.** Across the 190 plugin manifests in the local Codex cache, the only functional keys are `skills`, `apps` and `mcpServers`. That answers open question 2: the `prefix_rule` for `decide` has to be written to `$CODEX_HOME/rules/` by `setup`, with the user's consent (M5). A plugin cannot ship it.

## Scope

1. **Session auto-detect** (core `config/load.ts`):
   - `DECISIONS_SESSION` always wins.
   - Otherwise, pick the innermost harness:
     1. `AI_AGENT=pi` → `pi:$PI_SESSION_ID`
     2. `CODEX_THREAD_ID` → `codex:…`
     3. `PI_SESSION_ID` → `pi:…`
     4. `CLAUDE_CODE_SESSION_ID` → `claude:…`
   - The harness prefix keeps ids from colliding and tells `usage` where spend came from. `config` shows the resolved session and its origin.
   - `decide usage --session current` is shorthand for the detected session.
   - Known limit: when Claude Code runs *inside* Codex, the Codex id wins. An explicit `DECISIONS_SESSION` fixes it.
2. **Startup under 150 ms over bare `node`** for `version`, `help` and `ping`:
   - `main.ts` dynamic-imports each command module, and `version` reads a constant without loading core.
   - Heavy dependencies are imported where they are used, not through the core barrel.
   - Bundle the CLI with esbuild into one ESM file, `dist/decide.mjs` (dependencies inlined and tree-shaken), and call `module.enableCompileCache()` at entry. `bin` points at the bundle.
   - `tools/bench-startup.ts` reports the median of N runs minus the `node -e 0` median, for `version`, `ping --help` and `many --replay` on a fixture. Record the numbers here. `ask`/`many` have no hard target, but we measure them.
3. **`bin/decide` shim** (generator):
   - Precedence: `DECISIONS_CLI`, then the working-tree bundle, then a global `decide` that is not the shim itself, then pinned `npx`.
   - Clear stderr when nothing resolves.
4. **`decide doctor`** (new command, same envelope and exit codes):
   - Reports: detected harness and session, which `decide` is running and from where, Node version, key present or absent (never the value), repo consent, replay mode, endpoint reachability (reuses `ping`), and `CODEX_SANDBOX_NETWORK_DISABLED`.
   - Each problem comes with the exact fix for that harness. For Codex, that's the `prefix_rule` line and the file it goes in. For Codex and Pi, that's `npm i -g @garygentry/decisions` once it is published (M6).
   - `doctor` never writes anything. Writing the rule or installing is `setup`'s job, with consent (M5). This is our answer to open question 7 for M4.
5. **Smoke through a skill, in replay** (`tools/smoke/`):
   - A committed fixture repo in `tools/smoke/fixture-repo/` holds a tiny `.decisions/specs/smoke.yaml`, a few source files, and fixtures under `.decisions/fixtures/smoke/` (recorded live once, about $0.0003). The workdir is a copy of it, with `DECISIONS_REPLAY=1` and no key, so the run is deterministic and costs no decision calls.
   - A minimal `ask` skill (placeholder, fleshed out in M5) teaches `decide many --spec <name> … --format brief`.
   - The marker matches only the CLI's `decide many: N kept of M · … replay …` line. The existing `ping` smoke stays as the network proof.

## Out of scope

- The full `setup`, `ask` and `design` skills, and generic specs (M5).
- Publishing, and a real global install for Codex and Pi (M6).

## What was built

- **Session detection:** `core/config/session.ts` exposes `detectSession` and `detectHarness`, which `loadConfig` feeds into `config.session`/`sessionOrigin`. Ledger entries now carry `claude:…`, `codex:…` or `pi:…`, and `decide usage --session current` filters to the current session.
  - A second limit turned up while building it: Codex started inside Pi resolves to Pi, because Codex inherits `AI_AGENT=pi`. Both limits are documented in the module.
- **Startup:** three changes.
  - `main.ts` dynamic-imports each command.
  - The startup path imports `@garygentry/decisions-core/errors` and `/version` (new subpath exports) instead of the barrel. **The barrel defeated code splitting:** esbuild put every core module into one 830 KB chunk that `version` loaded.
  - core is marked `sideEffects: false`. `packages/cli/bundle.mjs` builds split ESM chunks into `dist/bundle/`, with a `createRequire` banner because `yaml` is CommonJS. `src/entry.ts` calls `module.enableCompileCache()` and then imports the CLI.
  - `bin` points at `dist/bundle/decide.mjs`. The tsc `dist/` output stays for tests.
- **Shim:** resolves `DECISIONS_CLI`, then the checkout's bundle, then a global `decide` other than itself, then pinned `npx`. The `DECISIONS_SHIM` guard stops two shim copies from calling each other forever. With no `npx` it exits 127 and prints the install command. All branches were exercised by hand.
- **`decide doctor`:** `core/tools/doctor.ts` checks the CLI, PATH, key, consent and network, and gives a harness-specific fix for each problem. It never writes anything. The envelope is always `ok` with exit 0, and `healthy` is false only when a check fails. The generator now also stamps `CLI_PACKAGE` into `version.ts`, so the install hint comes from `catalog.yaml`.
- **Smoke:** each harness runs two cases.
  - `ping` proves live network access from the agent's shell.
  - `many` runs the placeholder `ask` skill with `decide many --spec smoke`, in replay with no key, inside a git-initialised copy of `tools/smoke/fixture-repo/`. The fixtures were recorded by `tools/smoke/record.sh` for $0.000045.

## Results

**Startup** (`pnpm bench:startup 20`, median overhead over `node -e 0`):

| Command | load 4.1 | load 15 | Before (tsc build, load ≈ 9) |
|---|---|---|---|
| `version` | +3 ms | +50 ms | 418–1169 ms total |
| `help` | +2 ms | +29 ms | 487–1162 ms total |
| `config` (loads core) | +35 ms | +156 ms | 601–613 ms total |
| `many --dry-run` (loads everything) | +82 ms | +199 ms | — |

`many --spec smoke` in replay takes 98–309 ms in total at load 15.

**Harness runs (2026-09-22):**
- `pnpm smoke`: 6 of 6 pass (claude, codex and pi × ping and many).
- `decide doctor`:
  - Codex without the rule: `fail network … EAI_AGAIN … (Codex sandbox has network disabled)`, with the exact `prefix_rule` line and rules path as the fix.
  - Codex with the rule: healthy.
  - Pi, launched from inside Claude Code: `harness pi` and a `pi:…` session, so the nesting rule held.

## Found along the way

- **Smoke workdirs must be their own git repos.** `.smoke/` is gitignored by the parent repo, so a plain copy there had all of its files withheld as gitignored (`withheld: 3 (gitignored 3)`).
- The `ask` skill is a deliberate placeholder so the smoke tests have a real skill to drive. M5 replaces its body.

## Adversarial review (before merge)

Three independent reviewers covered: session detection and `doctor`; the shim and the smoke tests; the bundle and startup path. I reproduced every finding before fixing it.

**Fixed**
- **Session detection:** Claude Code started inside Pi was attributed to Pi. Claude overwrites `AI_AGENT` too, so this case can be told apart. Both detectors now share one `innermost()` rule.
- **`doctor`:**
  - A new `live` flag sits next to `healthy`, and the brief headline says `live ready` or `replay only`. A missing key or missing consent is still a warning, because replay-only is a supported mode (0010).
  - The network fix now depends on the HTTP status: 404 points at model/endpoint config, and 5xx says "retry later".
  - The Codex rule is suggested only when `CODEX_SANDBOX_NETWORK_DISABLED=1`. That flag also beats the nesting heuristic.
  - A broken config (a bad endpoint URL, malformed YAML) is now a `config` check that fails, instead of a crash with exit 1.
  - The PATH advice fits the harness: Claude gets plugin instructions, and while the package is unpublished at 0.0.0 the fix points at the checkout. A directory named `decide` on PATH is ignored.
  - The CLI doctor test had been passing by accident (a `SyntaxError` in the fake fetch). Key-leak tests now use a distinctive secret.
- **Shim:**
  - It now resolves `$0` through symlinks, so a `~/bin/decide` symlink finds the checkout.
  - The `DECISIONS_SHIM` env guard is replaced by skipping every shim copy by its marker line, plus the shim's own directory.
  - It requires a regular file and doesn't glob PATH entries.
- **The worst shim bug came from my own retest.** A failing `grep` made the marker check fall through, and the shim exec'd itself forever. Now only grep's "no match" (exit 1) lets a candidate run. Verified under dash and bash with broken and missing `grep`.
- **Smoke:**
  - The Claude run no longer gets the repo `bin/` on PATH, so it proves the plugin's own `bin/` wiring.
  - `OPENROUTER_API_KEY` is unset for every run.
  - The `ask` skill says to omit `--glob` unless the user names files. Codex had added `--glob '**/*'` and swept in the README.
- **Bundle:**
  - `bundle.test.ts` runs the built bundle for version, help, contract errors (exit 2 and 6) and the heavy chunks. Before this, CI never executed the bundle.
  - The CLI package now ships only `dist/bundle`, with core as a devDependency, since the bundle inlines it.
  - Spec lookup is anchored to the package root, so it can never pick up `node_modules/plugins/…`.
  - The bundle is built beside the live one and swapped in, so a concurrent `decide` never finds it missing.
  - `bench-startup` accepts `-- N` and rejects runs that aren't numbers.
- **0015** now documents `doctor`'s exit semantics.

**Deferred**
- `doctor` doesn't compare the version of the `decide` found on PATH with the running one. Doing so means spawning it; revisit with `setup` (M5).
- The smoke markers prove `decide` ran and printed real output, not that the agent went through the skill rather than calling `decide` directly.
- The smoke scripts need GNU `timeout`, which macOS doesn't ship by default.
- With `grep` missing entirely, the shim skips a real global install and falls through to `npx`. That's safe, never a loop.
- Node 22.23 spins forever when its compile cache would live under `/proc`. That's a Node bug, unlikely in practice.

## Acceptance

- [x] Session detection has unit tests covering each harness, nesting, and the override. The ledger records `claude:…` from a real Claude session (a live `ask` for $0.000012).
- [x] Bench: `version`/`help` median overhead is +3 ms (load 4) or +50 ms (load 15), under 150 ms. `many --replay` is measured and recorded. `ping` is dominated by the network, so the bench gates `version` and `help` instead.
- [x] `decide doctor` has tests for each branch, and was run for real under Claude, Codex (with and without the rule) and Pi.
- [x] `pnpm smoke`: 6 of 6 pass.
- [x] `pnpm check` passes (242 tests after the review fixes). The ROADMAP M4 row and open questions 2 and 7 are updated.
