# Task: time out every outgoing request

Acceptance criteria:
1. Every `fetch` call under src/ aborts after a few seconds (an AbortSignal timeout or equivalent).
2. `postJson` in src/http/legacy.ts aborts after 10 seconds.
3. A test covers the timeout behaviour.
4. No debugging output is left in the change.
