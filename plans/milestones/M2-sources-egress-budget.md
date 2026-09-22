# M2 — Core: config, sources, splitters, egress, budget

**Status:** done (2026-09-22)
**Goal:** the engine turns *references* (a glob, a file range, a JSONL file, a git diff, text or stdin) into a list of items ready to send. Before anything leaves the machine, it:
- applies path excludes and secret scrubbing;
- refuses oversized states;
- projects the cost and enforces the spend guard;
- refuses any live call in a repo that has not consented.

Fan-out execution itself (`decide many`) is M3.

## Modules (`packages/core/src/`)

| Module | What |
|---|---|
| `config/load.ts` | Layered config: defaults → `$XDG_CONFIG_HOME/decisions/config.yaml` (user) → `<repo>/.decisions/config.yaml` → env. Finds the repo root by walking up to `.decisions/` or `.git`. Resolves the API key: env first, then `~/.config/decisions/credentials`, which must be mode 600. Extra model profiles come from config |
| `config/consent.ts` | `grantConsent(repoRoot)` writes `egress.consent` into the repo config, preserving its comments. `assertConsent(config)` checks it |
| `sources/*` | `text`, `stdin` (the caller passes the content in), `file` (with `:L1-L2`), `glob` (tinyglobby, gitignore-aware in a git repo, binaries skipped), `jsonl` (one row = one document), `diff` (`git diff`, run with `execFile`, never through a shell) |
| `split/*` | `file` (one item per document), `hunk` (diff documents only), `lines:N[/overlap]`, `row` (JSONL rows, or the non-empty lines of text). Every item gets a stable id (`path`, `path:L10-L40`, `path#h3`, `row:17`) |
| `egress/exclude.ts` | Default secret-path patterns plus `egress.exclude`. Excluded paths are **reported, never silently dropped** |
| `egress/scrub.ts` | Redacts common secret shapes in strings and in the string leaves of objects: private keys, AWS, GitHub, OpenAI/Anthropic/OpenRouter-style `sk-` keys, Slack, JWTs, and `key = value` assignments. Always on. Returns counts by kind |
| `egress/size.ts` | A conservative token estimate (about 3 characters per token) against the profile's `maxStateTokens`. An oversized state is refused with `state-too-large` and is never truncated |
| `run/budget.ts` | Projects cost from the estimated input tokens of each item plus the question set's overhead, labelled `projected`. `checkBudget` raises `budget-exceeded` above the limit (default 200 calls or $0.05) unless the caller confirms |
| `prepare.ts` | The pipeline: sources → split → exclude → scrub → size → items + report |

**New error codes:** `egress-refused` (exit 3), `budget-exceeded` (exit 4) and `state-too-large` (exit 2).

**Consent in the decider:** `createDecider` gains a required `egressConsent` flag, and a live or record call without it raises `egress-refused`. Replay never needs consent, because nothing leaves the machine. `createDeciderFromEnv` reads the flag from the repo config.

## Decisions to settle here

- **No live `command` source** ([0014](../decisions/0014-no-command-source.md)). `cmd | decide many --stdin …` covers the use case. The agent's shell already runs the command under its own permissions, and the CLI never spawns anything except `git`.
- **Consent is per repo only.** A user-level `egress.consent` is ignored, per decision 0009.

## Acceptance

- [x] Sources and splitters are tested with temp dirs and throwaway git repos. The tests cover:
  - line ranges, binary and oversized skips, sorted globs, and `node_modules`/`.git` never being entered;
  - gitignore honoured while **tracked files that match an ignore rule are kept** (this is why `check-ignore` runs without `--no-index`);
  - JSONL line numbers and bad-line errors;
  - diff per file and per path, and an option-shaped range refused.
- [x] Default and config excludes, reported once each with the pattern that matched.
- [x] Scrubbing covers 12 secret shapes, plus 8 look-alikes it must leave alone: `getToken()`, `process.env.X`, `${VAR}`, `<placeholder>` and others. The first version redacted `const token = getToken()`, which is code. The assignment rule is now split in two: a quoted literal, or an unquoted value that contains a digit and is not a call or property path. Every rule uses lookarounds, so only the secret is replaced.
- [x] Consent:
  - it is granted into the repo config, and existing comments are kept;
  - it can be revoked;
  - a grant at user level is ignored;
  - a live call without it is refused *before* any network call;
  - replay works without it.
- [x] The budget guard trips on calls or on dollars, hands back the projection, and lets `--confirm` through. A state over the limit is refused with its id and the limit.
- [x] Config layering (user → repo → env, XDG), extra profiles from config, and the key from env or a mode-600 credentials file. A credentials file other users can read is refused.
- [x] 159 offline tests. `pnpm check` and `pnpm test:live` pass.
- [x] **Dogfood:** `prepare` over this repo gave 107 items. `.env` was withheld, and the key text appeared in no item. The 18 redactions all sit in the six files that deliberately contain fake secrets. The projected cost for the whole repo was $0.0046.

## Carried to M3

- Summarise `skipped` by reason, and list only a few paths. A glob over a repo can skip hundreds of gitignored files, and the agent needs counts, not a dump.
- `root config.ts` was renamed to `wiring.ts`, to avoid confusion with `config/`.
