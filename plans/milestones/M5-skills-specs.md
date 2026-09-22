# M5 — Skills: asking well, saving specs, setup

**Status:** done (2026-09-22). It was reviewed adversarially and merged to `main`. The decisions below came from interviewing the user.
**Goal:** Partway through any task, an agent recognises a closed judgement, writes a good question for it, hands it to `decide`, and reads the answer correctly, in Claude Code, Codex and Pi. A question that proves its worth can be saved as a spec in the repo and repaired against examples. `setup` takes a user from "installed" to "live-ready".

## First principles

- **Most decisions are ad hoc.** "Which of these 40 grep hits actually do X", "does this output show an error", "which of these options fits", "is this criterion met by the diff": the agent can't know these ahead of time, so the core skill is **writing the question on the spot**. A spec is secondary. It's how a question that proved useful gets kept, not the starting point.
- **What a skill is for:** it teaches *when* a judgement is closed enough to hand off, *how* to phrase it so a literal-minded decision model reads it as intended, and *how* to act on calibrated answers, including the undecided ones.
- **`jev-poc` is inspiration only.** Use it for ideas about use cases, not as a source of specs or designs to port.

## Decisions (interview, 2026-09-22)

| # | Question | Decision |
|---|---|---|
| D1 | Bundled specs in v1? | **None.** Ad-hoc questions are the main path. Specs live in the user's repo (or at the user level), saved through `design`. This answers open question 4, and drops the bundled-spec fixture plumbing from M5. |
| D2 | How does an agent hand over a question richer than a one-line noul? | A **new `--questions <file\|-\|inline>` flag** takes a question set as YAML or JSON, in the same shape as a spec's `questions:`. It can come from a file, from stdin, or inline, and the inline form leaves stdin free for content. `--question` stays for quick asks. |
| D3 | Where does question-craft guidance live? | **In `ask`** (as references), because every ad-hoc call needs it. `design` narrows to saving a question as a durable repo spec, with examples, and repairing a spec that misbehaves. |
| D4 | Which decision kinds does `ask` target (and the evals cover)? | All four: **screening many items**; **judging one piece of text**; **checking criteria against evidence**; **picking among candidates**. |
| D5 | How far may `setup` change the machine? | **Writes only with consent, one change at a time.** After an explicit yes it may add the Codex `prefix_rule`, or run the global install. It never grants egress consent and never handles the key. |
| D6 | The `ping` skill? | **Removed**, because `setup` covers it. `decide ping` stays as a command. |
| D7 | How rigorous are the routing evals? | **Scripted, in Claude, Codex and Pi.** |
| D8 | `decide spec check`? | **Yes.** It drives `design`'s repair loop, and it gives users an offline regression test for their own specs. |

## Scope

### 1. CLI: `--questions` (D2)

- **Input:** `decide ask|many --questions <path|->` reads a question map as YAML or JSON (YAML is a superset, so one parser handles both). It is validated with `assertQuestionSet`, like a spec.
- **Conflicts** (all exit 2, with a clear message):
  - `--questions -` together with `--stdin`, because only one of them can read stdin;
  - `--questions` together with `--spec` or `--question`. Mixing sources of questions is ambiguous.
- `decide schema ask|many` shows the flag.
- **Contract:** record this in 0015 as additive. `ENVELOPE_VERSION` doesn't change.
- **Tests:** a file, a heredoc on stdin, invalid YAML, an invalid question set, and each conflict.

### 2. CLI: `decide spec check <name|path>` (D8)

- It runs a spec's `examples` against its questions:
  - in replay by default;
  - with `--live`, when there is consent and a key. That path goes through `prepare()` and the spend guard, like `many`, and fixtures are recorded under the spec's namespace.
- **Result:** for each example, `pass`, `fail` or `undecided`, with the full distribution for each question. The run's result is `ok: true` with `passed: boolean`, the same convention as `doctor`'s `healthy`.
- **`expect` semantics** (this format is new in M5, and 0015 records it):
  - a noul takes `true`/`false`, compared at 0.5;
  - a choice takes an option key, compared with the winner;
  - a score takes a level index or a range `[lo, hi]`, compared with the weighted mean;
  - a threshold-based expectation, `{ q: ">=0.7" }`, uses the same shorthand as `--keep`.
- **Exit codes:** 0 when the run completes, whatever `passed` is; 2 for a spec with no examples, or an `expect` that names an unknown question; 6 for a replay miss (the message names the `--live` fix).
- **Tests:** pass, fail, undecided, no examples, a replay miss, and a bad `expect`.

### 3. `ask` skill (model-invoked; the everyday skill)

**Body.** Keep it lean. It covers:

- **When a judgement is closed:** the answer is one of N, a yes/no, or a position on a scale that you define, over text that the agent can point at.
- **The four use cases (D4), one pattern each:**
  - **Screen many items:** `many` over `--glob`, `--diff`, `--stdin`, `--jsonl` or `--file`, with `--keep`, `--sort` and `--limit`.
  - **Judge one piece of text:** `ask` with `--text`, `--file` or `--stdin`.
  - **Check criteria against evidence:** one noul per criterion in a single `--questions` set, asked over one state, e.g. the diff plus the test output.
  - **Pick among candidates:** a choice whose options are the candidates plus a "none of these", over the state that describes the need.
- **When not to use it:** generation, counting, arithmetic, dates, images, reasoning across documents, anything that must be exact (write code for those). Also a handful of items that fit in context: just read them.
- **Before looking at the answers:** set the threshold, then read them. Undecided items mean "read these yourself" and are never silently dropped. Noul 0.5 means uncertain. The model is decisive, so 1.0 is common. Score levels start at 0.
- **Saving the question:** if the same question will recur, suggest saving it as a spec with `design`.
- **Rules:**
  - Don't invent flags; `decide schema <cmd>` is the reference.
  - Don't add a source to a spec that already has one, unless the user names the files.
  - Retry at most once.
  - Never run `egress allow`.
  - On a non-zero exit, report the one-line error and stop.

**References:**

- `references/primitives.md`: choice, score and noul. What each answer means (winner versus distribution, confidence, the weighted mean). Choosing a primitive by what the answer means.
- `references/question-craft.md`:
  - always give a no-match option;
  - describe score levels as concrete situations;
  - give noul true/false criteria whenever the proposition could be read two ways;
  - the model applies criteria literally;
  - use one question per failure mode;
  - never mix different states in one set;
  - one state per call, and batch questions that share it.
  - It ends with a short self-review checklist, until M7's `question-critic` exists.
- `references/thresholds.md`: fix the threshold before you look; asymmetric costs (a keep threshold is low when dropping costs more than keeping); undecided goes to a human or to the agent's own reading; every saved threshold gets a `why`.
- `references/recipes.md`: one complete, copy-pasteable command per use case, including a `--questions -` heredoc.

Shapes are covered only as far as today's `decide` supports them: single (`ask`) and fanout (`many`). Pairwise, rounds and the others appear when their commands exist.

### 4. `design` skill (model-invoked and user-invocable; D3)

- **When:** the user or agent wants to keep a question for reuse, or a saved spec is giving odd answers.
- **Its loop:**
  1. Write `.decisions/specs/<name>.yaml` with the questions, thresholds that each have a `why`, and an optional default source.
  2. Add 4–8 examples that cover each branch, including a borderline one.
  3. `decide spec validate`.
  4. `decide spec check <name> --live`, which records fixtures under the spec's namespace.
  5. **Read the distributions before trusting it.** When an answer looks wrong, blame the question first, rewrite it and check again.
  6. Commit the spec and its fixtures, so the user has an offline regression test.
- It points to `ask`'s references for craft rather than duplicating them.

### 5. `setup` skill (user-only; D5, D6)

- **Invocation:** user-only, via `disable-model-invocation: true` and `allow_implicit_invocation: false`.
- **Flow:** run `decide doctor --format brief`, then walk through each problem it reports, using the fix it printed.
- **Codex rule:** with a yes, append the exact `prefix_rule` line `doctor` prints to `$CODEX_HOME/rules/decisions.rules`. If the line is already there, don't touch the file.
- **Global install:** with a yes, run the install command `doctor` prints.
- **Key:** say where the key goes (`OPENROUTER_API_KEY`, or `~/.config/decisions/credentials` with mode 600). Never ask for the key in the conversation, and never echo it.
- **Consent:** explain egress, and give the user the command `decide config egress allow --confirm` to run themselves. **Never run it.**
- **Fixtures:** suggest a `.gitignore` for `.decisions/fixtures/adhoc/` and `.decisions/usage.jsonl`. Spec fixtures stay committed.
- **Finish:** run `decide ping` as the final connectivity readout.
- **`doctor` change:** add a `path-version` check. It spawns the `decide` found on PATH with `version` (2 s timeout) and warns on a mismatch. This was deferred from M4. It comes with tests.

### 6. Remove `ping` (D6)

- Delete `plugins/decisions/skills/ping/`, and replace the `ping` entry in `catalog.yaml` with `setup` and `design`. Then `pnpm generate`.
- **Smoke:** the network case invokes `setup` by name, headless (Claude `/decisions:setup`, Codex `$setup`, Pi: to be found out).
  - **Verify first** that each harness runs a user-only skill in headless mode.
  - If a harness can't, that case prompts the agent to run `decide ping` directly. It proves the network path, and doesn't claim to prove the skill was used.
- **Recheck** `MANY_PROMPT` and the marker in `tools/smoke/lib.sh` against the new `ask` body. The smoke fixture repo keeps its own `smoke` spec (a repo spec, not a bundled one).

### 7. Routing evals (D7)

- **`tools/evals/routing.yaml`:** for each skill, positive prompts and near-miss negative prompts.
  - **`ask`:** at least 8 positives, 2 per use case (D4). At least 8 negatives: generation, counting, "read this one small file", a request that must be exact, a cross-document question, and so on.
  - **`design`:** at least 4 positives and 4 negatives. One negative must be an ad-hoc ask, which should go to `ask`.
  - **`setup`:** negatives only, since it must never auto-trigger. Plus one explicit invocation by name.
- **`tools/evals/run.sh <claude|codex|pi|all>`:** headless, local only (it spends harness tokens), in replay with no key, inside a git-initialised workdir under `.smoke/`. For each prompt it records which skill, if any, the harness loaded, and prints a pass-rate table per skill and harness.
  - **Claude:** detect the loaded skill from `--output-format stream-json`.
  - **Codex and Pi:** find out how each exposes a loaded skill (transcript, JSON events, or a file read of `SKILL.md`). This is the first eval task. If a harness can't expose it reliably, write that down and use the best proxy, e.g. whether a `decide` call was made, labelled as a proxy.
- **Pass bar:** at least 7 of 8 positives, and every negative, per skill and harness. The results table is recorded here.
- **Minimum prompt counts:** `tools/evals/run.test.ts` checks that every skill has the minimum number of positives and negatives, so `pnpm test` enforces them.

## Out of scope

- Bundled specs, and fixture read-through for them (D1). Revisit once real use shows questions that recur across repos.
- Spec variables (`{goal}`). Ad-hoc questions cover goal-dependent judgements.
- The `question-critic` agent, `scout` and the agent generator (M7). Shapes beyond single and fanout (M9).
- Publishing (M6).

## Settled while building

- **Choice option limit: 255.** Measured live on 2026-09-22 with one state and one choice listing N file names:
  - At 20, 60 and 150 options, the right file won each time (0.79–0.83 confidence), in 346–478 ms, for $0.000028–$0.000130.
  - At 400 options, upstream refused with "at most 255 choices".
  - The profile now carries `maxChoices: 255`, and `prepare()` refuses a larger choice before any call.
- **Skill invocation by name:**
  - Claude: `/decisions:setup`.
  - Codex: `$decisions:setup`. Codex names plugin skills `<plugin>:<skill>`, and hides a user-only skill from the model.
  - Pi: `/skill:setup`. This works in `-p`.
- **How each harness shows that a skill loaded, for the evals:**
  - Claude: a `Skill` tool call in `stream-json`.
  - Codex: a command that reads `skills/<name>/SKILL.md`, from `exec --json`.
  - Pi: a `read` tool call on it, from `--mode json`.
  - No proxy was needed.

## Routing evals: after the review (2026-09-22, final)

The eval harness fixes from the review changed the setup:
- the plugin is a copy outside the repo;
- Pi uses its own agent directory;
- Claude runs skip user settings;
- only reads of `SKILL.md` count as a load, and a refused call doesn't count;
- a session that ended in an error counts as an error.

The fixture had more variety this time, and the `ask` description added "however small" to its criteria-check clause.

| Skill | Claude (Sonnet) | Claude (Opus) | Codex | Pi | Bar |
|---|---|---|---|---|---|
| `ask` positive | 7/8 | 7/8 | 8/8 | 8/8 | ≥ 7/8 |
| `ask` negative | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 |
| `design` positive | 4/4 | 4/4 | 4/4 | 4/4 | ≥ 3/4 |
| `design` negative | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |
| `setup` negative | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |

- **Claude's one miss** in both models is "is the task in TASK.md done". The uncommitted diff behind it is 22 lines, and Claude checks it itself.
- **Run-to-run variance:** across the last three Claude runs, each model scored 6/8, 7/8 and 8/8 at some point.
- **A packages giveaway, found and fixed:** every generated description started with "Helpers for" and the two real candidates didn't, so Opus isolated them with `grep -v`. All descriptions now use varied openings, and the candidates' distinctive words (wall-clock, restart, Postgres) appear across many packages.

**Smoke: 9 of 9.** Moving the workdirs out of the repo showed that the Claude `setup` run had only reached `ping` because the old workdir inherited this repo's consent. `setup` now always finishes with its confirmation step.

## Adversarial review (before merge)

Three independent reviewers covered: the engine and CLI; the skill text against the real CLI; the eval and smoke tooling. I reproduced every finding before fixing it.

**Fixed**
- **Engine and CLI:**
  - Examples accept a structured `state` again, as `main` did. Example problems are reported only by `spec validate` and `spec check`, so a bad example no longer stops `ask` or `many --spec`.
  - An example `file` must be inside the repo. A committed spec could otherwise read `../../etc/hostname` and send it.
  - An example that is outside the repo, missing or too large is `withheld` on its own, instead of aborting the run.
  - `doctor`'s version probe could make the plugin shim download the package with `npx`. It now sets `DECISIONS_NO_NPX` (the shim honours it), and kills a hung child after 2 s.
  - A config `maxChoices` must be a whole number of at least 2.
  - The `spec-check` schema lists only `replay` and `record`, and the spend projection skips withheld examples.
  - A filter expectation is shown as written, and a one-line inline YAML value gets a hint.
- **Skills:**
  - `setup` described the credentials file as "only the key", which broke every command. It now says `openrouter_api_key: <key>`, and `doctor`'s fix text matches.
  - The criteria recipe wrote `git diff` to a file, which bypassed the path excludes. A new **`--split join`** sends `--diff` plus a log as one state, after excludes.
  - The recipes put prep and `decide` in separate blocks, since a chain like `prep && decide` loses network in Codex.
  - `ask` describes the `brief` first line for each command separately, and gives inline YAML quoting rules. `design` covers exits 2 (no key) and 4, and its "0.55 pass" example (impossible, because 0.55 is undecided) became 0.6.
  - `setup` tells the user to run `egress allow` in their own terminal, and says that committing `.decisions/config.yaml` shares consent with everyone who clones the repo.
- **Evals and smoke:**
  - Agents could still reach this repo through the plugin path. Pi read `plans/milestones/M3…` and `spec.ts`. Every harness now loads a staged copy, and Pi gets an isolated agent directory, since it had also loaded the user's global packages.
  - Detection: a Claude built-in `design` skill, a refused `Skill` call, or a `grep` that named `SKILL.md` no longer counts as a load. A session that errored no longer counts as completed.
  - `DECISIONS_EVAL_DIR=""` or `.`, and `DECISIONS_SMOKE_DIR=$REPO`, would have deleted directories inside the repo. Both are now resolved and refused before anything is created.
  - Parent `CLAUDE_*`, `CODEX_*`, `PI_*` and `AI_AGENT` variables are stripped, and a timeout kills the whole process group.
  - The fixture corpora had collapsed to a few templates: Opus grouped 80 failures into 9 messages. Text now varies.
  - Re-scoring the saved logs with the new detector changed one verdict (a refused `setup` call), and flipped no pass or fail.

**Deferred**
- The smoke scripts need GNU `timeout`. This was already true on `main`.
- Two `design` positives name `.decisions/specs/timeouts.yaml`. A user repairing a spec would name it, so they're kept, and the reason is noted in `routing.yaml`.

## Routing evals: before the review (2026-09-22, round 4)

Run with the shipped `ask` description, and with Claude isolated from user settings (the new default):

| Skill | Claude (Sonnet) | Claude (Opus) | Codex | Pi | Bar |
|---|---|---|---|---|---|
| `ask` positive | 7/8 | 7/8 | 8/8 | 8/8 | ≥ 7/8 |
| `ask` negative | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 |
| `design` positive | 4/4 | 4/4 | 4/4 | 4/4 | ≥ 3/4 |
| `design` negative | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |
| `setup` negative | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |

**What closed the Claude gap.** Probes on Claude's misses (Sonnet) moved from 0/4 to 2/4 to 4/4 across these description rounds. The user chose to keep iterating the text rather than add a hook.

- **A:** open with *when* to load it ("whenever the user asks you to classify, route, triage…"), and add "even if they never mention decisions or decide".
- **B:** lead with "Load this skill before you read through a file … of many items to judge each one yourself", and name "is the task done".
- **C, D:** name the command-by-command verdict, "is this safe to commit", and "one package, file, helper or option out of hundreds".

**The environment matters too.** My global hook rewrites `git diff` to `rtk git diff`, which falls outside `--allowedTools`. Under my user settings, Claude couldn't read a diff at all. Claude runs now skip user settings by default (`EVAL_CLAUDE_USER_SETTINGS=1` opts back in).

**Claude's remaining single misses vary between runs:** the pre-commit check on Sonnet, CI triage on Opus.

## Routing evals (2026-09-22, round 3: volume versions of the two universal misses, cost-first `ask` description)

`pnpm eval:routing <harness> --only ask`. Round 2 had shown that `design` and `setup` pass everywhere, so this round covers `ask` only.

| `ask` | Claude (Sonnet) | Claude (Opus) | Codex | Pi | Bar |
|---|---|---|---|---|---|
| positive | **1/8** (plus 1 timeout) | **3/8** | **8/8** | **8/8** | ≥ 7/8 |
| negative | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 |

- **Codex and Pi route every positive**, so the prompts are fair.
- **Claude with only this plugin loaded** (`EVAL_CLAUDE_ISOLATED=1`, 21 skills in the session) still missed all 3 probe prompts. A crowded skill list isn't the cause: Claude chooses to do the work itself.
- **After round 3, the Claude gap was still open.** Neither lever tried so far had closed it. Round 4 closed it with further description work.

## Routing evals (2026-09-22, round 2: harder positives)

`pnpm eval:routing all`, with Claude on Sonnet, and Codex and Pi on their defaults. The fixture comes from `tools/evals/make-fixture.py`.

| Skill | Claude | Codex | Pi | Bar |
|---|---|---|---|---|
| `ask` positive | **2/8** | **6/8** | **6/8** | ≥ 7/8 |
| `ask` negative | 8/8 | 8/8 | 8/8 | 8/8 |
| `design` positive | 4/4 | 4/4 | 4/4 | ≥ 3/4 |
| `design` negative | 4/4 | 4/4 | 4/4 | 4/4 |
| `setup` negative | 4/4 | 4/4 | 4/4 | 4/4 |

- **Missed in every harness:** the `git clean` risk verdict and the choice among 100 helpers. All three agents judged these themselves: an obvious command, and a list short enough to read. These prompts test the prompt, not the skill.
- **Missed only by Claude:** commits (300), CI failures (80), and both criteria checks. Claude did the work itself, at a harness-measured $0.13–$0.61 and 11–164 s per task. `decide` would cost about $0.001–$0.01 for the same items.
- **Round 1** (templated fixture, and before the sharper description): Claude 0/8 and Codex 7/8 on `ask` positives, with every negative held. Claude answered with grep, and on that fixture grep was enough.

## Live end to end, one run per use case (2026-09-22, this repo, measured)

| Use case | Command shape | Result | Cost |
|---|---|---|---|
| Screen files | `many --glob 'packages/core/src/**/*.ts' --question no_timeout…` | 57 files → 3 kept, 2 undecided, 52 dropped · 2.3 s | $0.003412 |
| Rank by relevance | `many --glob … --keep 'relevant>=0.3' --sort --limit 5` | `args.ts` and the flag-parsing commands at 0.98–0.99 | $0.000944 |
| Screen lines | grep hits, `--split row`, `swallowed>=0.7` | 24 rows → 6 kept · 1.1 s | $0.000304 |
| Judge one text | a vitest log, `failure` choice | `none` (1.0): the suite passed | $0.000019 |
| Criteria against evidence | this branch's diff and test log, 3 nouls | `tests_added` 0.98, `tests_pass` 0.97, `no_debug_left` 0.91 | $0.000286 |
| Pick among candidates | "add a --timeout flag", 3 files plus none | `args` (1.0) | $0.000017 |

## Found along the way

- **The Codex `prefix_rule` covers only commands that start with `decide`.**
  - `a && decide …` runs with network, but `echo … | decide …` doesn't.
  - Codex chained `doctor` with a `print` inside a single script, and lost the network for all of it.
  - **Fix:** the recipes now pass content with `--file` instead of pipes, and `ask` and `setup` say to run `decide` as its own command. The `doctor` fix for Codex says pipes stay offline.
- **Inside the Codex Linux sandbox, a child process spawned by node prints nothing and exits 0,** even `node -e "console.log(1)"`. `path-version` therefore reports "not checked" there, instead of a false warning.
- **Harness workdirs inside this repo were contaminated.**
  - Pi read `plans/ROADMAP.md` through our `AGENTS.md`, even from a nested git repo.
  - Codex did the same from a workdir that wasn't a git repo.
  - The first Codex smoke of `setup` "passed" without loading the skill. It said "the named setup skill isn't available", and ran `ping` itself.
  - **Fix:** smoke and eval workdirs now live under `~/.cache/`. The smoke also asserts a `decide doctor:` line, which only the skill asks for, so it proves the skill ran.
- **Piped rows came back as bare ids** (`stdin:10`), with nothing to trace them by. `many` rows now carry an `excerpt` when the id doesn't lead back to the text.
- **Routing depends on volume.** With an 11-file fixture, Codex rightly read the files itself, which is what `ask` tells it to do. The eval fixture was scaled up to 86 source files, 200 tickets and a 2,000-line log.
- **`--allowedTools` in `claude -p` is variadic, and swallows a prompt that follows it.** The first Claude eval run never started, and every negative "passed". The runner now puts a flag after the tool list, and counts a session with no end-of-session event as an error.

## Acceptance

- [x] `--questions` and `spec check` are implemented and tested, and 0015 is amended (additively).
- [x] `doctor` has the `path-version` check, with tests.
- [x] The `ask` skill (body plus 4 references), `design` and `setup` pass `pnpm validate` and `claude plugin validate --strict`. `ping` is gone.
- [x] `pnpm smoke` passes in all three harnesses: 9 of 9, with `setup` invoked by name, the doctor marker, and `many`.
- [x] The routing evals meet the pass bar in Claude, Codex and Pi, or a documented proxy is used where a harness can't expose skill loading. The results table is recorded here.
- [x] One live end-to-end ad-hoc ask per use case (D4) is recorded here, with its measured cost.
- [x] The ROADMAP M5 row and open question 4 are updated. `pnpm check` passes.
- [x] The work is on branch `m5-skills-specs`, got an adversarial review before it merged, and the fixes are recorded here.
