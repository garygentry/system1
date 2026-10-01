---
name: adopt
description: Replace a closed judgement in this codebase (a chat-model call parsed to an enum or yes/no, or a keyword rule) with a decision-model policy module, wired in behind the existing mechanism and inert until the user switches it on, plus a shadow harness to measure it. Use only when the user explicitly asks to adopt a scouted opportunity or a named closed judgement.
disable-model-invocation: true
---

# Adopt a decision

Adopt takes one closed judgement the code makes today and puts a decision-model policy module in front of it. The module is **inert until the user switches it on twice**:
- `enabled` stays false where the app calls it;
- its one marked `EGRESS` line says `"off"`.

Until both are switched on, every call takes the existing path. Cutover is the user's call, never yours. You write the module, its tests and a shadow harness, and hand off to `compare` to measure it.

Argument: an opportunity id from the scout backlog, or a description of the judgement and where it lives.

## Rules that hold throughout

- **Never turn egress on.**
  - Don't write `"on"` on the marked `EGRESS` line, and don't compute a grant any other way: no config, no environment variable, no option.
  - Don't write `module: "bundled"`.
  - Each of these is the user's edit, in reviewed code. If they ask you to make one, tell them it's theirs to make, and why (decision 0020 in the system1 docs).
- **Keep what the templates keep:**
  - the marked line, exactly as written;
  - `module: import.meta.url` (TypeScript) right before `egress: EGRESS`, last in the `createPolicyRuntime({…})` call;
  - the grant-scan file (`grants.ts` or `grants.py`);
  - the generated test that runs that scan.
- **Never run the shadow harness or the app live yourself.** The harness runs the existing mechanism for real, so it may spend money and send data outside system1's checks. The user runs it.
- **Consent is the user's.** If `decide doctor` reports no consent or no key, stop and suggest the `setup` skill.

## 1. Load the judgement

For an id, run `decide opportunities list --format json` and find the entry. Read its `location`, `mechanism`, `questions` and `risk`, then read the code at `location` in full: the inputs the mechanism reads, what it returns, and every caller.

Write down three things:
- **the input type:** what one decision is made from;
- **the output type:** what the app uses afterwards;
- **the inputs that matter:** the fields the judgement really depends on. Only these go into the state.

## 2. Draft the spec with the `design` skill

Follow the `design` skill to write `.system1/specs/<name>.yaml`, then:
- run `decide spec lint <name> --format brief` and fix every finding;
- run `decide spec check <name> --live --format brief` to record answers for the examples.

Two rules here keep the generated tests working:
- **Each example's `state` is a plain string, exactly as the module will build it** from an input (the template's `toState`). Replay matches a state character for character, so a reformatted state misses.
- **The module records and replays under one model:** the module's `MODEL` and the model `spec check` ran with must match.

## 3. Read real answers and revise

Run the spec over a handful of real inputs, built as states the same way, and read the distributions, not just the verdicts. Write the states to a scratch file, one JSON string per line, and run `decide many --spec <name> --jsonl <file> --format brief`. Pass the file with `--jsonl`, never through a pipe.

Revise the questions or thresholds where answers are undecided or wrong, then record again (step 2). Show the user the thresholds and why each one is set where it is.

## 4. Generate the module from the templates

Read `references/templates/README.md`, then copy the template for the repo's language:
- `references/templates/ts/` for TypeScript or JavaScript;
- `references/templates/python/` for Python.

Put it next to the code it serves. Change every line marked `ADOPT:` to fit the repo:
- **the spec's questions**, verbatim;
- **the thresholds**, from `policy.thresholds`;
- **the input and output types**, as the app has them;
- **`toState`**, from the inputs that matter;
- **`fromAnswers`**: one branch per question;
- **the mapping** from the existing output into the answer space (`mapping`);
- **the test runner, paths and import style** the repo already uses.

Then:

- **TypeScript:**
  - Add `@garygentry/system1-core` as a dependency pinned to the **exact** version `decide doctor` reports (no `^` or `~`). Import only `@garygentry/system1-core/runtime`.
  - Read how the repo builds and runs its code, and tell the user what it means for the second lock. The runtime reads the marked line from the running file, so the lock holds when the source runs as written (tsx, ts-node, Node's type stripping, vitest) or through plain `tsc`.
  - It can't hold with `removeComments`, esbuild or tsup output, or a bundle. A deployment built that way needs `module: "bundled"`, and the user makes that edit.
- **Python:**
  - The module needs Node 22 and the `decide` CLI wherever it runs, in the app's image and in CI. Each call starts one `decide` process.
  - Say so to the user, and add the install to CI if they agree.

Run the generated tests with the repo's runner. They replay recorded answers and send nothing. They must pass, including the test that scans the module for a grant. A failing grant scan means an adapted line broke a rule above: fix the code, not the scan.

## 5. Wire it in, inert

Call the policy where the existing mechanism is called today, with `existing` set to the current code path. Pass:
- `enabled: false`, from wherever the app keeps its flags;
- `root`: a writable directory for the spend ledger, so the daily cap holds across restarts.

Behaviour must be unchanged while it's off. Run the repo's existing tests to show that.

## 6. Generate the shadow harness

Copy `shadow` from the same template. Point its samples at real inputs the user names, such as a log, a fixture set or a database query, and its `current` at the existing mechanism. Then tell the user, in these words or close to them:

- the harness runs the existing mechanism on every sample, so it costs what that mechanism costs, and sends what it sends;
- `.system1/compare/<name>/captured.jsonl` holds the raw inputs, so it must stay out of git. Offer to add `.system1/compare/*/captured.jsonl` to `.gitignore`;
- they run it, then run the `compare` skill.

## 7. Mark it adopted

```sh
decide opportunities set-status <id> adopted --format brief
```

Report to the user:
- the files written;
- how the policy is switched on (both switches, and that both are theirs to flip);
- what the build means for the second lock;
- the next step: run the shadow harness, then `compare`.
