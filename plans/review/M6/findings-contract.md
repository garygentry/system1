I would hold publication until the input-validation gaps are fixed. The CLI-first approach is reasonable, but the biggest risk is silently accepting instructions it will not honor: `ask` rejects `--dry-run` yet accepts and ignores `"dryRun": true` through JSON input. Replay demonstrated that this reaches decision execution; the code would use the normal live path when configured. No live calls were made, and the repository remains unchanged.

## Findings

Reproductions below use this helper from the clone; all inputs and test fixtures are under `/tmp/s1-review/`. Quoted output excerpts are from actual CLI runs.

```sh
CLI="$PWD/packages/cli/dist/bundle/decide.mjs"
cd /tmp/s1-review/contract
d() {
  rtk proxy env -u OPENROUTER_API_KEY \
    SYSTEM1_REPLAY=1 XDG_CONFIG_HOME=/tmp/s1-review/xdg \
    node "$CLI" "$@"
}
```

1. **High — JSON input bypasses the `ask` dry-run rejection.**

   Files: [schemas.ts:53](/home/gary/.cache/system1-review/work-contract/packages/core/src/tools/schemas.ts:53), [decide.ts:63](/home/gary/.cache/system1-review/work-contract/packages/cli/src/commands/decide.ts:63).

   `AskInput` permits additional properties. The CLI checks prohibited flags before loading `--input`, while the handler ignores unknown properties. Thus the M6 fix protects only one spelling of the request.

   [ask.json](/tmp/s1-review/contract/ask.json) contains:

   ```json
   {"questions":{"q":{"type":"noul","instructions":"Is this relevant?"}},"sources":[{"kind":"text","text":"contract-probe"}],"dryRun":true}
   ```

   Repro:

   ```sh
   d ask --input /tmp/s1-review/contract/ask.json
   ```

   Observed: exit **6**, `"code":"replay-miss"`, message beginning `"No recorded answer for this request"`. Execution was attempted despite the dry-run instruction.

   Compare:

   ```sh
   d ask --text contract-probe \
     --question 'q:noul:Is this relevant?' --dry-run
   ```

   Observed: exit **2**, `"--dry-run applies to `decide many`, not `ask` (one state, one call)."`

   **Fix:** Reject unsupported properties in the core schemas, including nested objects, so every input route receives the same validation. Replace opaque question values (`Type.Unknown()`) with discriminated question schemas; currently the advertised machine-readable contract cannot describe valid questions.

2. **Medium — The durable spec format silently accepts incompatible versions and misspelled policy.**

   File: [spec.ts:20](/home/gary/.cache/system1-review/work-contract/packages/core/src/spec/spec.ts:20).

   There is no enforced spec version or unknown-property policy. `spec validate` also does not validate `source.split`. This is dangerous for committed policy: misspelled assertions become examples with no assertions, and `passed: true` can mean nothing was checked.

   [future.yaml](/tmp/s1-review/contract/future.yaml) contains:

   ```yaml
   version: 999
   description: Future policy
   questions:
     q: {type: noul, instructions: "Is this relevant?"}
   kepe: ["q>=0.99"]
   source: {split: nonsense}
   examples:
     - id: example
       state: yes
       exepct: {q: false}
   ```

   Repro:

   ```sh
   d spec validate /tmp/s1-review/contract/future.yaml
   d spec check /tmp/s1-review/contract/future.yaml
   d many --spec /tmp/s1-review/contract/future.yaml --text x --dry-run
   ```

   Observed, respectively:

   - Exit **0**: `{"valid":["future"],"invalid":[]}`.
   - Exit **0**: `"passed":true`, `"pass":0`, `"captured":1`; the example is `"status":"captured"`.
   - Exit **2**: `"Unknown split \"nonsense\" (file, hunk, row, join, lines:N[/overlap])"`.

   The check used an explicitly hand-authored scratch fixture with `q.noul: 0.9`, not a real model answer.

   **Fix:** Add a required spec-format version and reject unsupported versions. Reject unknown operational keys while reserving an explicit metadata extension area. Validate source and projection semantics during `spec validate`. Do not present an entirely assertion-free check as an unqualified pass.

3. **Medium — Exit 1 is not reserved for bugs, and identical failures change classification between commands.**

   Files: [misc.ts:34](/home/gary/.cache/system1-review/work-contract/packages/cli/src/commands/misc.ts:34), [many.ts:131](/home/gary/.cache/system1-review/work-contract/packages/core/src/tools/many.ts:131), [store.ts:67](/home/gary/.cache/system1-review/work-contract/packages/core/src/fixtures/store.ts:67).

   Repro:

   ```sh
   d usage --bogus
   d ask --bogus
   d spec show /tmp/s1-review/contract/
   ```

   Observed:

   - `usage`: exit **1**, `"code":"error","message":"Unknown option '--bogus'"`.
   - `ask`: exit **2**, `"code":"invalid-request"`.
   - `spec show`: exit **1**, `"EISDIR: illegal operation on a directory, read"`.

   Additionally, with a matching scratch fixture containing only `{`:

   ```sh
   d ask --text broken --question 'q:noul:Is this relevant?'
   d many --text broken --question 'q:noul:Is this relevant?'
   ```

   Both report `"Expected property name or '}' in JSON at position 1 (line 1 column 2)"`, but `ask` exits **1/error**, while `many` exits **2/invalid-request**.

   **Fix:** Normalize argument, filesystem and fixture errors at their boundaries, with actionable typed messages. Preserve unexpected errors through fan-out aggregation instead of converting them into usage errors.

4. **Low — Explicit JSON output is not reliably JSON.**

   File: [main.ts:92](/home/gary/.cache/system1-review/work-contract/packages/cli/src/main.ts:92).

   ```sh
   d version --format=json
   d version --format json
   ```

   Both exit **0**, but output differs:

   ```text
   0.1.0
   {"v":1,"ok":true,"command":"version","result":{"version":"0.1.0"}}
   ```

   Default `version` also prints plain text, contrary to the record’s universal default-envelope promise.

   **Fix:** Track explicit format selection in the parser, rather than searching raw argv for one spelling. Either make the default uniform or document the exception.

## Checked and fine

- Replay misses produce exit 6 without inventing answers; successful scratch replays report `source: replay` and zero measured usage.
- With scratch answers 0.9 and 0.5, `--keep 'q>0.99'` dropped the former and separately retained the latter as undecided, including its excerpt.
- `--questions -` combined with `--stdin` exits 2 with an actionable conflict message.
- `doctor` with an invalid endpoint returns exit 0, `ok:true`, `healthy:false`, `live:false`, as specified.
- `ping` against `http://127.0.0.1:1` returns exit 5/provider-unreachable. I could not verify exits 3 and 4 under the no-key, no-consent restrictions.

## If I were you

Freeze strict input semantics before freezing output shapes. Give specs their own version independently of `ENVELOPE_VERSION`. Document fixture-key and namespace compatibility alongside the CLI contract. Keep the shorthand syntax, but validate fields and option names so a typo cannot silently become policy.
hook: Stop
hook: Stop Completed
