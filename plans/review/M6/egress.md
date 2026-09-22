# Pass 2 — egress and consent

**The promise** (`plans/decisions/0009-egress-consent-once-per-repo.md`, the README's "What gets sent, and when", and the `setup` skill): nothing leaves the machine until the repo's owner grants consent; secret-shaped files are excluded; secret-shaped strings are scrubbed; oversized content is refused rather than truncated; and consent is the user's to give, never an agent's.

**Where to look:** `packages/core/src/prepare.ts`, `egress/{exclude,scrub,size}.ts`, `config/consent.ts`, `config/load.ts`, `sources/read.ts`, `split/split.ts` (including `--split join`), `tools/{ask,many,spec-check}.ts`, `decide.ts`, `fixtures/store.ts`, `run/spend.ts`, and the skills in `plugins/system1/skills/`.

**Judge:**
1. **Find a path to the provider that skips `prepare()` or the consent check.** Try every source (`--glob`, `--file`, `--diff`, `--jsonl`, `--stdin`, `--text`, `--questions`, `--input`, a spec's own `source`, and a spec example's `file`), every split, and `spec check --live`.
2. **Can content escape the repo boundary?** Example files, globs, `..` paths, symlinks, absolute paths, a spec loaded by path from outside the repo.
3. **Are the excludes and the scrubber good enough to promise what the README promises?** Look at `DEFAULT_EXCLUDES` and the scrub patterns for real gaps (private keys in odd formats, cloud credentials, tokens in URLs, JSON payloads, base64 blobs). What would a user be surprised to learn was sent?
4. **Consent integrity:** can an agent grant it? Can it be granted non-interactively by accident? Is `--confirm` respected? Does the repo-root walk (`.system1/` or `.git`) let a repo's consent apply to content from elsewhere?
5. **What is written to disk**: fixtures, the spend ledger, and whether any of it stores content or secrets the user wouldn't expect, and whether the gitignore advice in `setup` is adequate.
6. Read the skill text as an adversary: wording that could lead an agent into sending something the user didn't intend, or into granting consent.

Use replay and `--dry-run`. `withheld` and `redacted` lines in `--format brief` show what was kept back.
