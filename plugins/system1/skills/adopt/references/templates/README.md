# adopt's code templates

A worked example, `ticket-triage`, of what `adopt` generates: the existing mechanism is a support-ticket triage (urgent or not, and which team) and the decision model takes it over behind a fallback. `adopt` copies these files and changes every line marked `ADOPT:` to fit the repo's spec, types, test runner and import style.

| File (TS · Python) | What it is |
|---|---|
| `policy.ts` · `policy.py` | The policy module: the spec's questions and thresholds, the state builder, the `EGRESS` line, and `triage()`, which answers with the model or falls back to the existing mechanism with a reason code and a trace |
| `mapping.ts` · `mapping.py` | The existing mechanism's output in the question set's answer space, strictly: what the shadow harness writes as `current` |
| `shadow.ts` · `shadow.py` | The shadow harness: runs the existing mechanism over samples and appends `{id, state, current, usage?, latencyMs}` to `.system1/compare/<spec>/captured.jsonl` |
| `policy.test.ts` · `test_policy.py` | Offline tests against the spec's recorded fixtures (replay) |
| `grants.ts` · `grants.py` | The grant scan the tests run over the module's own files |

## The rules every generated module keeps

- **Inert twice over.** `enabled` defaults to false where the app calls the policy, and the module's one marked line sets `EGRESS` to "off". `adopt` never writes "on" there, and never writes a grant any other way: no config, no environment variable, no option. `grants.ts` · `grants.py` hold the scan each generated test runs over the module as written, and `pnpm validate` runs the same scan over these templates. It is an allowlist for the name, read one line at a time: the marked line is a constant set to "off", and every other use is a comparison, an import, an assertion, or the runtime's `egress: EGRESS` as the last property, closing its object. Comment lines and string contents are skipped. It reads text, not what runs, so a computed key or code it doesn't parse can still pass it: the user's review of the diff is the control. In Python, `decide runtime` also reads the marked line from the module file, so both must say on.
- **Every fallback has a reason:** a runtime reason code (`docs/runtime.md`), `disabled`, or `below-threshold`.
- **TypeScript** imports only `@garygentry/system1-core/runtime`, pinned to an exact version.
- **Python** spawns `decide` once per call, checks its runtime protocol once, and falls back with `engine-unavailable` when `decide` is missing or speaks another protocol. Node 22 and `decide` must be in the runtime image and in CI, with Python 3.9 or later.
- **Recorded answers** live in `.system1/fixtures/<spec>/`, committed. `decide spec check <spec> --live` records them for the spec's examples, and the tests replay the same states, as plain strings. A state must reach the model exactly as the examples hold it, and be recorded with the module's `MODEL`, or replay misses.
- **The capture holds raw inputs:** `.system1/compare/*/captured.jsonl` stays out of git.
