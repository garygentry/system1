# M5 — Skills: asking well, saving specs, setup

**Status:** planned (2026-09-22). The decisions below came from interviewing the user.
**Goal:** Partway through any task, an agent recognises a closed judgement, writes a good question for it, hands it to `decide`, and reads the answer correctly, in Claude Code, Codex and Pi. A question that proves its worth can be saved as a spec in the repo and repaired against examples. `setup` takes a user from "installed" to "live-ready".

## First principles

- **Most decisions are ad hoc.** "Which of these 40 grep hits actually do X", "does this output show an error", "which of these options fits", "is this criterion met by the diff": the agent can't know these ahead of time, so the core skill is **writing the question on the spot**. A spec is secondary. It's how a question that proved useful gets kept, not the starting point.
- **What a skill is for:** it teaches *when* a judgement is closed enough to hand off, *how* to phrase it so a literal-minded decision model reads it as intended, and *how* to act on calibrated answers, including the undecided ones.
- **`jev-poc` is inspiration only.** Use it for ideas about use cases, not as a source of specs or designs to port.

## Decisions (interview, 2026-09-22)

| # | Question | Decision |
|---|---|---|
| D1 | Bundled specs in v1? | **None.** Ad-hoc questions are the main path. Specs live in the user's repo (or at the user level), saved through `design`. This answers open question 4, and drops the bundled-spec fixture plumbing from M5. |
| D2 | How does an agent hand over a question richer than a one-line noul? | A **new `--questions <file\|->` flag** takes a question set as YAML or JSON, in the same shape as a spec's `questions:`, from a file or a heredoc. `--question` stays for quick asks. |
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
- **`validate.ts`:** checks that every skill has an eval entry with the minimum number of positives and negatives.

## Out of scope

- Bundled specs, and fixture read-through for them (D1). Revisit once real use shows questions that recur across repos.
- Spec variables (`{goal}`). Ad-hoc questions cover goal-dependent judgements.
- The `question-critic` agent, `scout` and the agent generator (M7). Shapes beyond single and fanout (M9).
- Publishing (M6).

## Open, to settle while building

- **How many options can a choice have?** "Pick among candidates" needs to know. `validate.ts` enforces no maximum. Measure one live call with about 20 options, and document the practical limit in `recipes.md`.
- **How Pi exposes skill loading, for the evals, and how it invokes a user-only skill headless, for smoke.**

## Acceptance

- [ ] `--questions` and `spec check` are implemented and tested, and 0015 is amended (additively).
- [ ] `doctor` has the `path-version` check, with tests.
- [ ] The `ask` skill (body plus 4 references), `design` and `setup` pass `pnpm validate` and `claude plugin validate --strict`. `ping` is gone.
- [ ] `pnpm smoke` passes in all three harnesses.
- [ ] The routing evals meet the pass bar in Claude, Codex and Pi, or a documented proxy is used where a harness can't expose skill loading. The results table is recorded here.
- [ ] One live end-to-end ad-hoc ask per use case (D4) is recorded here, with its measured cost.
- [ ] The ROADMAP M5 row and open question 4 are updated. `pnpm check` passes.
- [ ] The work is on branch `m5-skills-specs`, gets an adversarial review before it merges, and the fixes are recorded here.
