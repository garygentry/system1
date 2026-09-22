I would **hold publication for fixes, but keep CLI-only for 0.1.0**. The biggest risk is treating sandbox compatibility as solved by a network rule: in this review environment, the primary file-screening recipe hangs before reaching the model. CLI-plus-skills remains a reasonable architecture, but the current implementation also breaks its version-pinning promise and gives relative paths surprising semantics. These are problems worth fixing before users depend on the contract.

## Findings

The commands below use these abbreviations, with all test data under `/tmp/s1-review/`:

```sh
B=/home/gary/.cache/system1-review/work-cli-only/packages/cli/dist/bundle/decide.mjs
S=/tmp/s1-review/cli-pass
export SYSTEM1_REPLAY=1 XDG_CONFIG_HOME="$S/xdg"
unset OPENROUTER_API_KEY
```

1. **High — The main glob recipe can hang indefinitely in the sandbox.**

   File: [packages/core/src/sources/read.ts:141](/home/gary/.cache/system1-review/work-cli-only/packages/core/src/sources/read.ts:141).

   Every nonempty glob in a Git worktree runs synchronous `git check-ignore --stdin`, without a timeout. In this environment, piping input into a Node child hangs. This blocks even the cheap, offline dry run that the skill recommends before spending money.

   Repro, in a scratch Git repo containing `src/a.ts`:

   ```sh
   cd "$S/repo"
   rtk proxy timeout 5 node "$B" many --glob 'src/**/*.ts' \
     --question 'q:noul:Is this code?' --dry-run --format brief
   ```

   **Observed:** no output; exit **124**. The original invocation without `timeout` remained pending across repeated checks until interrupted.

   I isolated the dependency:

   ```sh
   rtk proxy timeout 5 node --input-type=module -e \
     'import {execFileSync} from "node:child_process"; console.log(execFileSync("/usr/bin/cat",[],{input:"hello",encoding:"utf8"}));'
   ```

   **Observed:** no output; exit **124**. Direct `fs/promises.readdir` and standalone `tinyglobby` succeeded.

   This is an **environment-dependent compatibility failure**, not proof that globbing hangs everywhere. I could not verify whether the approved, unsandboxed `decide` execution path eliminates it.

   **Fix:** bound every Git subprocess and return a typed failure on timeout; never continue by silently dropping ignore checks. Verify the actual glob recipe under both default and approved execution, and replace stdin piping if this sandbox remains supported.

2. **Medium — The “pinned” plugin silently executes any other `decide` on PATH.**

   File: [tools/generate.ts:225](/home/gary/.cache/system1-review/work-cli-only/tools/generate.ts:225), generating `plugins/system1/bin/decide:26`.

   The global fallback checks executability and excludes copies of its own shim. It checks neither package identity nor version. Consequently, the pinned `npx` fallback is bypassed by an unrelated executable—or an incompatible System 1 release. Updating a global install can silently change an older plugin’s behavior.

   Repro using a copied shim, outside the checkout bundle’s resolution path:

   ```sh
   rtk proxy mkdir -p "$S/plugin/bin" "$S/global"
   rtk proxy cp plugins/system1/bin/decide "$S/plugin/bin/decide"
   rtk proxy sh -c 'printf "#!/bin/sh\nprintf '\''unrelated decide 9.9.9\\n'\''\n" > /tmp/s1-review/cli-pass/global/decide'
   rtk proxy chmod +x "$S/global/decide"
   rtk proxy env -u SYSTEM1_CLI SYSTEM1_NO_NPX=1 \
     PATH="$S/global:/usr/bin:/bin" "$S/plugin/bin/decide" version
   ```

   **Observed, exit 0:**

   ```text
   unrelated decide 9.9.9
   ```

   `doctor` cannot reliably rescue this: it may itself be dispatched to that unrelated program.

   **Fix:** resolve a package-specific installation matching the plugin version. Keep `SYSTEM1_CLI` as an explicit override; do not treat an arbitrary command-name match as a pinned dependency. Fix the generator, not the generated shim.

3. **Medium — Relative source paths silently change meaning inside subdirectories.**

   Files: [packages/core/src/tools/many.ts:80](/home/gary/.cache/system1-review/work-cli-only/packages/core/src/tools/many.ts:80), [ask.ts:42](/home/gary/.cache/system1-review/work-cli-only/packages/core/src/tools/ask.ts:42).

   Both commands resolve sources against the repository root, although question/input files resolve against the shell’s working directory. An agent following normal shell conventions can fail—or judge the wrong file when both locations exist.

   With `repo/src/a.ts` present and no `repo/a.ts`:

   ```sh
   cd "$S/repo/src"
   rtk proxy node "$B" many --file a.ts \
     --question 'q:noul:Is this code?' --dry-run --format brief
   ```

   **Observed, exit 2:**

   ```text
   decide many: error source-error — No such file: a.ts
   ```

   After creating the competing root file:

   ```sh
   rtk proxy sh -c 'printf "root file\n" > /tmp/s1-review/cli-pass/repo/a.ts'
   ```

   Repeating the same command **succeeded, exit 0**:

   ```text
   decide many (dry run): would send 1 item(s) to typesafe/jev-1.13 · projected $0.000001 (~22 tokens, price as of 2026-09-19) · no calls made
   first: a.ts
   ```

   **Fix:** resolve explicit CLI sources against invocation cwd while retaining repo-root semantics for saved-spec defaults and consent. Keep exclusions anchored consistently, and document the distinction.

## Checked and fine

- `ask --text hello --question 'q:noul:Is this a greeting?' --format brief` returned `replay-miss`, exit 6; no synthesized answer.
- Adding `--dry-run` to that `ask` returned exit 2 and explicitly directed me to `many`.
- The diff recipe with `--diff HEAD --split hunk --dry-run` found the actual changed file: `first: src/a.ts#h1`.
- The reviewed skill recipes use `decide`, with file references for prepared evidence; they do not call HTTP directly.
- Checkout files remained unchanged (`git status --short` was empty); no consent, live decisions, smoke tests or routing sessions were run.

## If I were you

Keep MCP deferred, but make first installation explicitly cover the CLI, credentials, repo consent and host execution policy: installing skills alone is insufficient. A host-launched MCP adapter could remove shell quoting/PATH friction, amortize startup and potentially escape shell sandbox restrictions, but that last benefit depends on host policy—the [MCP architecture assigns security enforcement to the host](https://modelcontextprotocol.io/specification/2025-06-18/architecture). It would add lifecycle, transport and compatibility testing even with shared core schemas; I could not verify a numerical context cost per session, so stop treating the “schemas always occupy context” assertion as a measured advantage. Gate startup on useful commands and installed-shim resolution, since the current benchmark gates only warmed `version` and `help`. Fix these boundary defects before adding another execution surface.
hook: Stop
hook: Stop Completed
