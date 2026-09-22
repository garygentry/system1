I would **not publish this candidate with its current egress promises**. The consent guard works, but consent authorizes a pipeline that can include external files, excluded files under aliases, and recognizable secrets. The biggest risk is false confidence: routine source and splitter choices defeat protections advertised as always applying. No live calls were made, no consent or key was added, and the repository remains unchanged.

## Findings

Reproductions below run from the clone root using this [offline reproduction script](/tmp/s1-review/egress.mjs). It invokes the built CLI’s `main`, forces replay, and observes prepared requests at fixture lookup; it returns no fabricated answers. Exit 6 is the expected replay miss. Outputs shown are exact excerpts. **Actual provider delivery: I could not verify this**, because live calls were prohibited.

1. **High — Path identity does not enforce the consent boundary or exclusions.**

   Files: [sources/read.ts:79](/home/gary/.cache/system1-review/work-egress/packages/core/src/sources/read.ts:79), [spec/spec.ts:148](/home/gary/.cache/system1-review/work-egress/packages/core/src/spec/spec.ts:148), [sources/read.ts:222](/home/gary/.cache/system1-review/work-egress/packages/core/src/sources/read.ts:222).

   Ordinary sources accept absolute paths and `..`. Symlinks are followed without checking their targets; even spec examples’ “inside repo” check is only lexical. Consequently, a saved spec can read another directory under the current repo’s consent, or alias `.env` as an innocent filename.

   ```sh
   rtk proxy node /tmp/s1-review/egress.mjs paths
   ```

   ```json
   {"route":"file ..","exit":6,"states":["OUTSIDE_PRIVATE_CONTENT"]}
   {"route":"glob ..","exit":6,"states":["OUTSIDE_PRIVATE_CONTENT"]}
   {"route":"symlink .env","exit":6,"states":["EXCLUDED_FILE_CONTENT"]}
   {"route":"outside spec source","exit":6,"states":["OUTSIDE_PRIVATE_CONTENT"]}
   {"route":"example symlink","exit":6,"states":["OUTSIDE_PRIVATE_CONTENT"]}
   ```

   Absolute paths and symlinks outside the repo also reproduced successfully.

   Diff parsing independently loses path identity: Git quotes `secrets/é.txt`, the parser substitutes `unknown`, and exclusions stop matching.

   ```sh
   rtk proxy node /tmp/s1-review/egress.mjs diff
   ```

   ```json
   {"split":"hunk","ids":["unknown#h1"],"skipped":0,"privateContent":true}
   ```

   This also reproduced with `file`, `row`, `lines`, and `join`.

   **Fix:** enforce a canonical filesystem boundary for every file-backed source, including examples and spec defaults. Apply exclusions to both the supplied path and resolved target. Decode Git paths correctly and refuse unparseable paths instead of treating them as sendable `unknown` content.

2. **High — Preparation does not cover the complete request, and the public library can bypass it altogether.**

   Files: [prepare.ts:55](/home/gary/.cache/system1-review/work-egress/packages/core/src/prepare.ts:55), [tools/ask.ts:61](/home/gary/.cache/system1-review/work-egress/packages/core/src/tools/ask.ts:61), [wiring.ts:46](/home/gary/.cache/system1-review/work-egress/packages/core/src/wiring.ts:46), [decide.ts:103](/home/gary/.cache/system1-review/work-egress/packages/core/src/decide.ts:103).

   Only item states are scrubbed. Instructions and criteria remain untouched, although they also carry user content and go into the provider request. A synthetic GitHub-token-shaped string survives every tested question entry point:

   ```sh
   rtk proxy node /tmp/s1-review/egress.mjs questions
   ```

   ```json
   {"route":"--question","exit":6,"unscrubbedQuestion":true,"state":"safe"}
   {"route":"--questions","exit":6,"unscrubbedQuestion":true,"state":"safe"}
   {"route":"--input","exit":6,"unscrubbedQuestion":true,"state":"safe"}
   {"route":"spec check --live (forced replay)","exit":6,"unscrubbedQuestion":true,"state":"safe"}
   ```
   ```text
   control scrubText=[REDACTED:github-token]
   ```

   Moreover, exported `createDeciderFromEnv()` returns a decider that performs neither scrubbing nor size checks. Its consent check remains present, but callers can inadvertently skip preparation:

   ```sh
   rtk proxy node /tmp/s1-review/egress.mjs storage
   ```

   ```json
   {"publicLibrary":"replay-miss","state":"password=\"correct-horse-battery-staple\""}
   ```

   **Fix:** make the final decision boundary enforce sanitization and size checks on the entire request. Reject secrets in identifier fields where redaction would change answer mappings. Make unsafe lower-level APIs explicitly internal, or require a validated prepared-request type.

3. **High — Parsing and splitting destroy context needed for redaction; fixtures preserve the resulting leaks.**

   Files: [egress/scrub.ts:77](/home/gary/.cache/system1-review/work-egress/packages/core/src/egress/scrub.ts:77), [prepare.ts:46](/home/gary/.cache/system1-review/work-egress/packages/core/src/prepare.ts:46), [fixtures/store.ts:82](/home/gary/.cache/system1-review/work-egress/packages/core/src/fixtures/store.ts:82).

   JSONL scrubbing examines individual values without their field names. Thus an obvious `password` field escapes a rule that works on identical JSON supplied as text. Splitting precedes scrubbing, so line windows and rows separate private-key delimiters from their payload.

   ```sh
   rtk proxy node /tmp/s1-review/egress.mjs scrub
   ```

   ```json
   {"route":"JSON text","exit":6,"states":["{\"password\":\"[REDACTED:assigned-secret]\"}\n"]}
   {"route":"JSONL object","exit":6,"states":[{"password":"correct-horse-battery-staple"}]}
   {"route":"PEM whole","exit":6,"states":["[REDACTED:private-key]"]}
   {"route":"PEM lines","exit":6,"states":["-----BEGIN PRIVATE KEY-----","QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=","-----END PRIVATE KEY-----"]}
   ```

   `row` likewise exposes the synthetic PEM-shaped block.

   Fixtures contain full requests, not merely hashes and answers. The storage reproduction above also prints:

   ```json
   {"fixtureContainsFullState":{"password":"correct-horse-battery-staple"}}
   ```

   Yet setup recommends ignoring only ad-hoc fixtures, and design tells users to commit saved-spec fixtures. Missed secrets therefore risk both provider disclosure and publication through Git.

   **Fix:** scrub complete documents before splitting, preserve field-name context for structured values, and retain a final request-level check. Explain that fixtures contain source content; default them to ignored and require deliberate review before sharing.

## Checked and fine

- CLI `ask`, `many`, and `spec check` all call `prepare()`; their decision paths retain consent checks.
- A mock transport with consent false produced `{"consentError":"egress-refused","transportCalls":0}`.
- `egress.mjs checks` verified `.env` exclusion before joining and redaction of a quoted password from stdin.
- The same checks refused oversized text with `state-too-large` and rejected `ask --dry-run`; both exited 2.
- Replay forced `spec check --live` offline. The ledger implementation stores usage/session metadata rather than request content.

## If I were you

Make egress enforcement a single boundary before publishing the library. Replace the unconditional scrubbing promise with an accurate description of its limits. Consent is cooperative policy: writable configuration, `--confirm`, and a TTY check cannot authenticate a human; I did not execute granting paths. Fix the skills’ fixture-sharing advice alongside the code.
hook: Stop
hook: Stop Completed
