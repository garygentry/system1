---
name: design
description: Save a decision-model question set as a reusable spec in this repo, with thresholds, a default source and examples checked against recorded answers, or repair a saved spec that gives wrong or undecided answers. Use when the user wants to keep, save, name or reuse a `decide` question, turn a recurring judgement into a spec, write or edit a file in `.system1/specs/`, or fix a spec whose answers look wrong. For a one-off question, use the `ask` skill instead.
---

# Design a spec

A **spec** is a question set saved in `.system1/specs/<name>.yaml`. It records the questions, the thresholds (each with the reason for it), an optional default source, and examples. Once saved, anyone can run it with `decide many --spec <name>`. It can be tested offline with `decide spec check <name>`. It changes only through a reviewed diff.

Question craft is covered by the `ask` skill's references. Read `question-craft.md`, `primitives.md` and `thresholds.md` there before drafting.

## The loop

1. **Draft the file:**

   ```yaml
   description: One sentence on what this spec decides and why.
   questions:
     <name>:
       type: noul | choice | score
       instructions: …
       criteria: …            # noul: {true, false}; choice: {key: description}; score: [level 0, level 1, …]
   keep: ["<name>>=0.7"]      # the default filter
   sort: <name>               # optional
   policy:
     thresholds:
       <name>: { value: 0.7, why: "What a wrong keep and a wrong drop each cost here." }
   source: { glob: ["src/**/*.ts"], split: file }   # optional default source
   examples:
     - { id: clear-yes, state: "…", expect: { <name>: true } }
     - { id: clear-no, file: "src/a.ts:10-40", expect: { <name>: false } }
     - { id: borderline, state: "…" }             # no expect: captured so you can read it
   ```

   - **Examples:**
     - Write 4–8. Cover each branch you care about, plus at least one near miss, i.e. something that looks like a match but isn't.
     - Use short, real `state` text. For real code, point at `file` (`path` or `path:START-END`).
   - **`expect` values:**
     - a noul takes `true` or `false`;
     - a choice takes an option key;
     - a score takes a level or `[lo, hi]`;
     - any question can take a filter such as `">=0.7"`, or `undecided`.
2. **Validate the file:**

   ```sh
   decide spec validate <name> --format brief
   ```

   Fix every problem it lists before going on. It also checks that each example `file` exists inside the repo.
3. **Record answers for the examples.** This makes real calls. It needs a key and the repo's egress consent, and costs about $0.00003 per example:

   ```sh
   decide spec check <name> --live --format brief
   ```

   If it fails, stop and tell the user why, by exit code:
   - **Exit 3:** the repo has no egress consent. Suggest the `setup` skill, and never grant consent yourself.
   - **Exit 2 with `no-key`:** live calls need an API key. Suggest the `setup` skill.
   - **Exit 4:** the spend guard stopped it. Show the projection, and let the user decide.
4. **Read the distributions before trusting the result.** A `pass` with a 0.6 noul, or a choice split 0.5/0.45, is a warning. For each `FAIL` or `UNDECIDED`:
   - suspect the question first;
   - find the literal reading of your words that explains the answer;
   - rewrite the criteria, split the question, or add the missing way out.

   Change the example itself only if it really was mislabelled.
5. **Repeat steps 3–4** until the examples pass for the right reasons.
   - Recorded answers are keyed by the exact state and questions, so rewording a question records new ones.
   - The answers for the old wording stay behind unused. Before committing, clear `.system1/fixtures/<name>/` and record once more, so only live answers are kept.
6. **Check it offline:**

   ```sh
   decide spec check <name> --format brief
   ```

   Then tell the user to commit both the spec and `.system1/fixtures/<name>/`. The recorded answers make `decide spec check <name>` an offline regression test, with no key needed.

   **A fixture holds the exact text that was sent**, so committing one publishes that text to everyone with the repo. Say so, and suggest reading the files first, especially when an example points at a real file.

## Repairing a spec

Start at step 4. Run `decide spec check <name> --format brief` to replay what's recorded, add the input that misbehaved as a new example, and continue the loop from step 3.

## Rules

- **The spec's name is its file stem:** lowercase letters, digits, `.`, `_` and `-`. The name is also its fixture namespace, so renaming the file abandons its recorded answers.
- **Every threshold gets a `why`.** Write it from the cost of each kind of mistake, not from the scores you happened to see.
- **Don't raise or lower a threshold just to make examples pass.** Fix the question instead.
- **Retry once at most** after a non-zero exit, then report the one-line error.
