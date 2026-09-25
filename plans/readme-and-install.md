# README rewrite and install path: `decide` first, then the plugin

**Status:** implemented 2026-09-25 on branch `docs/readme-decide-first` (the optional `cli-global` check in §3.3 was dropped; the docs change closes the gap). Implements the presentation half of [0021](decisions/0021-decide-is-the-product-one-repo-two-layers.md). No engine or contract change, except the small `doctor` items in §3.
**Goal:** A developer landing on the README understands in one screen what `decide` is, how a call flows, and can reach a first live decision in a couple of minutes, from a terminal, with or without an agent. Then they see what the agent plugin adds, and which parts are optional packs.

## 1. What prompted this

Running `decide` in a terminal to grant consent gave `command not found`. That is **not** specific to this machine's dev symlink; it's what every plugin-only Claude Code install does:

- The Claude plugin's `bin/decide` shim is put on **Claude's** Bash PATH, not on the user's shell PATH. `pnpm dev:link` symlinks the plugin into `~/.claude/skills/system1`, which also only affects Claude's PATH.
- So after following the README's Claude row ("`decide` on PATH: comes with the plugin"), the user's own terminal has no `decide`. Consent then has to go through `! decide config egress allow --confirm`, and CI, scripts and other repos have nothing to call.
- Codex and Pi already require `npm i -g @garygentry/system1`. Only Claude is the exception, and the docs build a special case around it (getting-started §4, tutorial Exercise 1, setup skill `consent`).

The fix is the install ordering 0021 sets: **install the CLI globally first, in every harness; the plugin is second.** The shim already prefers a real `@garygentry/system1` install on PATH, so nothing breaks, and the plugin-only path stays as a documented fallback.

## 2. Review of the current README

Read as a developer who has never seen the project and wants to know "what is it, how does it work, how do I try it".

### What works and stays

- The one-line pitch and the four example judgements (lines 3–9). Concrete and right.
- The real `decide many` run with its output (lines 26–44). The best thing on the page: it shows kept / undecided / dropped, cost and scrubbing in one block.
- The honesty: measured vs projected, `live` vs `replay`, undecided never rounded, one model / one provider.
- "What gets sent, and when", and "Known limits". Short, specific, needed.
- The documentation table.

### Problems, in the order a reader hits them

1. **Stale facts.**
   - The status box says **0.3.1**; the release is 0.4.0.
   - "Three skills ship with it" — there are four; `scout` is missing from the table.
   - Getting-started's `doctor` sample shows `decide 0.3.1`.
   - `doctor`'s Claude `path` message says "the decisions plugin" (pre-0016 name) — see §3.
2. **The CLI is framed as a by-product of the plugin.** "It ships as one plugin … plus the `decide` CLI that the plugin's skills … call." 0021 inverts this: `decide` is the tool; the plugin teaches agents to use it. The reader has to reach the Packages table at the very bottom to learn the CLI is its own npm package.
3. **No mental model of a call.** The page never says, in a few lines, what happens: question set + items → `decide` reads, splits, excludes, scrubs → Jev returns a probability per answer → thresholds split kept / undecided / dropped → a short result. The reader has to reverse-engineer it from the example.
4. **The first command can't be run where it appears.** The example is at line 26, but the key and consent it needs are explained at line 100, and nothing tells the reader that. A developer who copies it gets a consent or key error.
5. **Jargon in the first example.** `no_timeout:noul:…` — `noul` (the yes/no question type) and the `name:type:text` shape are never explained on the page. Nor are `--keep 'no_timeout>=0.5'` and `--format brief`.
6. **The smallest possible call is missing.** Everything shown is a fan-out over 57 files. There's no one-item `decide ask --text … --question …` a reader can run in 5 seconds to see a single answer, and no JSON envelope sample for someone scripting against it.
7. **Evidence comes before install.** "Where it stands" (a 9-row evidence table) sits between the pitch and install. It matters, but a developer wants to try it first; it belongs after the usage sections, shortened, pointing to `docs/evaluation.md`.
8. **Install is harness-first, and wrong for the terminal.** The table starts from "which agent do you use", so a developer who wants `decide` in CI or another repo only gets one line under it. And its Claude row causes §1.
9. **No "use it in your own project" section.** Per-repo setup (key, consent, `.system1/specs/`, fixtures, CI replay) is the path 0021 calls layer 1, and the README only reaches it through a docs-table row ("CI and scripts").
10. **The layer / tier structure isn't visible.** Nothing distinguishes core skills (`setup`, `ask`, `design`) from use-case packs (`scout`, and later `guard`, `adopt`/`compare`).
11. **The roadmap table is long for a README.** 10 rows that duplicate `plans/ROADMAP.md`. Three lines (now / next / later) and a link are enough.
12. **Specs are mentioned, never shown.** "Save a question as a spec" means little until the reader has seen five lines of YAML and `decide many --spec <name>`.

## 3. Work

### 3.1 README, new structure

In this order. Target: the first screen (to the end of "Try it") fits in about 80 lines.

1. **Title and pitch** (keep): two sentences plus the four example judgements. The second sentence names the two layers: "`decide` is a CLI you can run anywhere; the System 1 plugin teaches Claude Code, Codex and Pi when to use it."
2. **Status line**, one sentence, 0.4.0, pre-1.0, no outside users yet, link to "Where it stands".
3. **How it works** (new). A 5-step flow (ASCII or a short numbered list):
   question set + items → `decide` reads and splits (glob, file, diff, stdin) → excludes secret files, scrubs secrets, refuses oversize → one decision-model call per item, typed probabilities back → thresholds sort into kept / undecided / dropped, with cost and `live`/`replay` on every result.
   Then the three question types in a 3-row table: `noul` (yes/no, a probability), `choice` (one of several keys), `score` (a level on a scale), and the inline `--question name:type:text` shape.
4. **Try it** (new; the main change). Numbered, copy-pasteable, terminal only:
   1. `npm i -g @garygentry/system1` (Node ≥ 22), then `decide doctor --format brief`.
   2. Key: `export OPENROUTER_API_KEY=…` or the credentials file (one line, link to getting-started §3).
   3. In the repo: `decide config egress allow` — one sentence on what that permits and what always applies, link to "What gets sent".
   4. One call: `decide ask --text '…' --question 'destructive:noul:The command deletes or overwrites data.' --format brief`, with its real output. (Record it for real when implementing; do not invent output.)
   5. A fan-out: the existing `decide many` example and output, with one line each for `--question`, `--keep` and `--format brief`.
   Close with: without a key, `decide` only replays; `decide ping` checks reachability for free.
5. **Add it to your agent** (was Install). Plugin commands per harness in a table, with the network column. A note that the plugin works before step 1 of "Try it" too (the shim fetches the pinned CLI), but the global install is what makes `decide` available in your terminal, CI and other repos. The `setup` skill per harness. The Claude routing hook, one sentence.
6. **What's in the plugin** (new). Two tiers:
   - Core skills: `ask`, `design`, `setup` (the current table), plus the Claude routing hook.
   - Packs, run on request: `scout` now; `guard`/`done-check` (0.5.0) and `adopt`/`compare` (0.6.0) marked as planned.
7. **Use it in your own project** (new, short). The layer-1 path: `.system1/config.yaml` (consent, per repo), a spec in `.system1/specs/<name>.yaml` (5–8 lines of YAML from the cookbook), `decide many --spec <name>`, fixtures and `decide spec check --strict` in CI with `SYSTEM1_REPLAY=1`, the JSON envelope and exit codes for scripts. Links to specs.md, ci-and-scripts.md, cli.md, cookbook.md.
8. **What gets sent, and when** (keep).
9. **Cost** (fold in from "What it does"): output tokens free, ~$0.00004 per 700-token item, the ~300-token provider overhead, the spend guard.
10. **Where it stands** (moved down, trimmed to the rows that change a reader's decision: calibration measured / not measured, harnesses verified, routing, outside users). Link to evaluation.md.
11. **Known limits** (keep; update the `system1-core` line to point at M11 §3).
12. **Where it's going**: 3 lines — M10 next, M11 after, design partners at M12 — and a link to the ROADMAP.
13. **Documentation**: the same table, grouped under "Using `decide`", "Using the plugin", "Reference", "Evidence".
14. **Packages and layout** (merged): the three npm packages as the two layers, plus one line pointing maintainers to `AGENTS.md`, local-plugin.md and the decision records (with 0021).
15. **License**.

### 3.2 Install guidance across the docs

Make the global CLI install step 1 everywhere, and the plugin-only Claude path a documented fallback.

- **`docs/getting-started.md` §1:** lead with `npm i -g @garygentry/system1`, then the plugin table. The Claude row's "`decide` on PATH" becomes "the global install; the plugin's launcher covers Claude's own shell if you skip it". Update the `doctor` sample to 0.4.0 (re-run it for real). §4 consent: the terminal path first, `!` … `--confirm` as the fallback for a plugin-only install.
- **`docs/tutorial.md`:** keep Exercise 1 working for plugin-only installs (it's pinned to a tag and a throwaway repo), but add the global install as the recommended step and cut the "which you don't need for this lab" framing. Its troubleshooting table already has the right row (line 456).
- **`docs/troubleshooting.md` `path`:** add the Claude case: `decide` works in Claude but not your terminal → `npm i -g @garygentry/system1`.
- **`docs/ci-and-scripts.md`:** no change; already correct.
- **`plugins/system1/skills/setup/SKILL.md`:** in `consent`, when `decide` isn't on the user's own PATH, offer the global install (with a yes) before falling back to `! … --confirm`. The "`decide: command not found`" bullet already recommends the global install; drop its "if the package isn't published yet" line (it is).
- **`docs/architecture/deployment.md`:** one sentence that the recommended install is global plus plugin, with the shim resolving to the global install (step 3 of its resolution order).

### 3.3 `doctor` (small code changes)

- Fix the Claude `path` message: "the decisions plugin" → "the System 1 plugin" (pre-0016 name). Its test and troubleshooting.md follow.
- **New informational check, `cli-global` (optional; decide when implementing):** when the harness is Claude and the `decide` on PATH is the plugin shim with no global install behind it, report `ok` with a note: "decide works in this session only; for your terminal, CI and other repos: `npm i -g @garygentry/system1@<version>`". Status `ok`, not `warn`, so plugin-only installs stay `healthy`. It adds a check name, so the docs-vs-code test and `docs/troubleshooting.md` gain a row. If it adds more than a few lines of logic, drop it; the docs change alone closes the gap.

### 3.4 Not in scope

- Renaming the CLI package (0021 leaves it open).
- Splitting the plugin into two generated plugins.
- Library docs for `system1-core` (M11 §3, M13).

## 4. Acceptance

- [x] README follows §3.1. The `ask` output is from a real 0.4.0 run on 2026-09-25 ($0.00005 for four calls); the `many` run is the dated 2026-09-22 one.
- [ ] A reader who follows only README "Try it", in a fresh shell with no plugin, reaches a live `decide ask` answer. *Steps 1–2 verified with the published 0.4.0 in an isolated npm prefix and a clean env (`doctor` says `SETUP NEEDED (key, consent)`, as the README says). Step 3 is the user's own consent, so the agent did not run it there; steps 4–5 verified live in this repo.*
- [x] The global install is step 1 in README, getting-started and the setup skill. The plugin-only Claude path is still documented and still works (`! decide config egress allow --confirm`).
- [x] No stale version numbers or skill counts in README or getting-started.
- [x] `pnpm check` passes, including the docs link and anchor test (`tools/docs.test.ts`) and `generate:check`.
- [ ] If the setup skill changes: `pnpm eval:routing all` shows no regression for `setup` (it is user-invoked only, so this is a sanity run).
- [x] `docs/docplan.json` entry for getting-started updated (the docplan has no README entry).
