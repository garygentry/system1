# Adopt and compare: replace a judgement, then measure it

`adopt` and `compare` are the steps after [scout](scout.md). Scout finds a closed judgement your
code makes today, such as a chat-model call parsed to a yes or no, or a keyword rule. `adopt`
puts a decision-model **policy module** in front of it, with the existing code as the fallback.
A **shadow harness** runs the existing mechanism over real inputs and captures them. `compare`
then measures the decision model against that mechanism over the same inputs, and writes a
report.

Both are skills you run by name: `/system1:adopt` and `/system1:compare` in Claude Code,
`$system1:adopt` and `$system1:compare` in Codex, `/skill:adopt` and `/skill:compare` in Pi.

- **Nothing changes until you switch it on.** The module `adopt` writes is off in two places,
  and every call takes the existing path until you turn on both.
- **Switching it on is yours to do.** The agent never writes the grant, and never runs the
  shadow harness or your app live. Cutover is your decision, made in reviewed code.
- **Without labels, `compare` names no winner.** Agreement shows where the two sides differ,
  not which one is right.

## The chain

| Step | Who runs it | What it sends | What it writes |
|---|---|---|---|
| 1. Scout | the agent, `scout` skill | screened files, under repo consent | `.system1/opportunities.json` |
| 2. Adopt | the agent, `adopt` skill | the spec's examples and a few probe states, under repo consent | a spec, its recorded answers, the policy module, its tests, the shadow harness |
| 3. Capture | **you**, the shadow harness | whatever the existing mechanism sends | `.system1/compare/<spec>/captured.jsonl` |
| 4. Compare | the agent, `compare` skill, or you | each captured state, under repo consent | `.system1/compare/<spec>/report.json` |
| 5. Cutover | **you** | the app's inputs, under the module's own grant | two edits in reviewed code |

Steps 2 and 4 need a key and [egress consent](getting-started.md#4-consent-per-repo) for the
repo, like any `decide` call. Step 5 doesn't use repo consent at all: see
[runtime consent](#runtime-consent-the-marked-line).

## Adopt: what it generates

Give the skill an opportunity id from the scout backlog, or describe the judgement and where it
lives. It then:

1. **Reads the code** at the opportunity's location: what one decision is made from, what the
   app uses afterwards, and which inputs really matter. Only those go into the state sent to the
   model.
2. **Drafts a spec** with the `design` skill, in `.system1/specs/<name>.yaml`
   ([specs](specs.md)). `decide spec lint` must pass, and `decide spec check --live` records the
   answers for its examples, so the generated tests can replay them offline.
3. **Probes real inputs.** It runs the spec over a handful of real inputs with `decide ask`,
   reads the distributions, and revises questions or thresholds. The probe files live under
   `.system1/compare/<name>/probe/` and are deleted afterwards. It shows you each threshold and
   why it sits where it does.
4. **Generates the module from the templates**, next to the code it serves, in the repo's idiom:

   | File (TS · Python) | What it is |
   |---|---|
   | `policy.ts` · `policy.py` | The spec's questions and thresholds, the state builder, the marked `EGRESS` line, and the function the app calls. It answers with the model, or falls back to the existing mechanism with a reason code and a trace |
   | `mapping.ts` · `mapping.py` | The existing mechanism's output in the spec's answer space, strictly: what the harness records as `current` |
   | `shadow.ts` · `shadow.py` | The shadow harness |
   | `policy.test.ts` · `test_policy.py` | Offline tests against the recorded answers, including a scan of the module for a grant |
   | `grants.ts` · `grants.py` | That grant scan |

   The worked template, a support-ticket triage, is in
   [`skills/adopt/references/templates/`](../plugins/system1/skills/adopt/references/templates/README.md).
5. **Wires it in, inert,** where the existing mechanism is called, with the existing code path as
   the fallback, `enabled: false`, and a writable `root` for the spend ledger. The repo's own
   tests must still pass.
6. **Generates the shadow harness** and tells you what running it costs and sends.
7. **Marks the opportunity adopted:** `decide opportunities set-status <id> adopted`.

The generated tests replay recorded answers and send nothing. They must pass, the grant scan
included.

### TypeScript or Python

| | TypeScript | Python |
|---|---|---|
| What the module calls | `@garygentry/system1-core/runtime`, pinned to an exact version | `decide runtime`, one process per call |
| Needs at run time | the package | Node 22 and the `decide` CLI in the app's image and in CI, Python 3.9 or later |
| Extra cost per call | none | starting Node: p50 90 ms, p95 148 ms measured in replay on the spamfilter dogfood |
| When `decide` is missing or too old | n/a | falls back with `engine-unavailable` |

The runtime import is the only part of `@garygentry/system1-core` with a stability promise before
1.0. Its exports, options and reason codes are in [the runtime](runtime.md).

## Two switches, both off

A generated module is inert twice over:

- **`enabled`**, where the app calls the policy. It defaults to false. Off, every call takes the
  existing path with the reason `disabled`, and the module loads nothing.
- **The marked `EGRESS` line** in the module:

  ```ts
  export const EGRESS: "on" | "off" = "off" // system1: runtime egress (only you switch this on)
  ```

  ```python
  EGRESS: Final = "off"  # system1: runtime egress (only you switch this on)
  ```

  `adopt` writes `"off"` and nothing else. Off, a live call falls back with `egress-off`.

`enabled` lets you turn the policy on and off per environment without touching the grant.
`EGRESS` is the grant itself.

## Capture: run the shadow harness

The harness runs the existing mechanism over sampled inputs you name (a log, a fixture set, a
query) and appends one line per input to `.system1/compare/<spec>/captured.jsonl`:

```json
{"id": "t-1042", "state": "Subject: refund not received…", "current": {"urgent": 0, "area": "billing"}, "usage": {"cost": 0.000021}, "latencyMs": 612}
```

`current` is the existing mechanism's answer, mapped into the spec's answer space. The full
format is in [cli.md § compare](cli.md#compare). Run it from the repo root. Know three things
before you do:

- **It runs the existing mechanism for real.** If that is a model call, every row costs what it
  costs and sends what it sends, outside System 1's checks. That's why you run it, not the agent.
- **The file holds raw inputs.** So will compare's recorded answers beside it. Keep
  `.system1/compare/` out of git (the `setup` skill suggests the line; `decide doctor` warns
  while it isn't ignored, see [doctor: `captured`](troubleshooting.md#doctor-captured)). Delete
  a capture once its comparison is done.
- **A row without `usage` means its cost is unknown, never zero.** If the existing client doesn't
  report cost, `compare` says so. In the spamfilter dogfood, adding OpenRouter's `usage.include`
  accounting flag to the harness's call gave a measured cost without changing what was sent.

The engine never runs this code: the harness is your code, and `compare` reads only its file.

## Compare: measure it

```sh
decide compare <spec> --dry-run --format brief    # what would be sent, and the projected cost
decide compare <spec> --record --format brief     # run it, and keep the answers
decide compare <spec> --replay --format brief     # rebuild the report offline, at no cost
```

`compare` sends each captured `state`, scrubbed and size-checked, to the decision model. The
captured `current` answers, the mechanism's raw output and its usage stay on your machine. Above
the [spend guard](spend.md) the run needs `--confirm`, which the skill passes only after you
approve the projection. `--record` keeps the answers in `.system1/compare/<spec>/fixtures/`, so
`--replay` rebuilds the report later with no key. Every flag is in
[cli.md § compare](cli.md#compare).

### The baseline

- **`current`** (the default) is the mechanism in place. Its answers come from the capture, so
  no baseline call is made, and its cost and latency are what the harness recorded. Prefer it:
  it measures the thing that would actually be replaced.
- **`emulated`** asks a chat model the same questions instead: Claude Haiku 4.5 on OpenRouter
  (`emulated:anthropic/claude-haiku-4.5`), asked for strict JSON. Use it when the existing
  mechanism is a rule with no model to compare against, or to compare with a general chat model.

The emulated baseline is fenced in:

- **It sends your content to a second vendor,** so the repo has to allow it first, and only you
  can. In a terminal at the repo root:

  ```sh
  decide config egress allow-profile emulated:anthropic/claude-haiku-4.5
  ```

  Without a terminal, such as Claude Code's `!` prompt, add `--i-consent` to say the decision is
  yours. `--confirm` doesn't count, and skills never run it. `decide config egress status` shows
  what's allowed; `deny-profile` takes it back. Until then `compare` refuses with
  `profile-not-allowed` before any call.
- **It is refused everywhere but `compare`:** `ask`, `many`, `spec check`, guard hooks and
  adopted code. Its answers are single, uncalibrated values, so `SYSTEM1_MODEL` can never switch
  a real gate to it.
- It asks OpenRouter not to route to providers that keep data. A reply that doesn't fit the
  answer space strictly is counted as a parse failure, never repaired.

The profile's fields are in [configuration § profiles](configuration.md#profiles).

## Read the report

`report.json` (and the command's output) holds, for each side:

| Signal | What it tells you |
|---|---|
| `jev.cost`, `baseline.cost` | Cost per call. `total: null` means unknown, never zero; `complete: false` makes it a lower bound. Replayed answers measure no cost |
| `jev.latency`, `baseline.latency` | p50 and p95, in ms |
| `signals.agreement` | How often the two agree, by question and by question type, with `n`. Jev's undecided answers are counted apart, not as disagreements |
| `signals.undecidedShare` | How often Jev was undecided. Those rows would take the existing path |
| `signals.decisiveness` | How far Jev's answers sit from a coin flip |
| `baseline.parsed` | For an emulated baseline, how many answers fit the answer space |
| `disagreements.sample` | Up to 50 disagreeing rows, as ids and answers, never states |
| `labels`, `winner`, `verdict` | See below |

Every field is in [output.md § compare](output.md#compare).

### Labels decide who is right

**Without labels, `winner` is always `null`.** High agreement means switching changes little;
low agreement means someone has to look at the rows where they differ.

To get accuracy, label captured rows in `.system1/labels/<spec>.jsonl`, one line per row, any
subset of the questions:

```json
{"id": "t-1042", "labels": {"urgent": 0, "area": "billing"}}
```

Start with the disagreeing rows, then a random sample of the rest. Label them yourself; the agent
must not invent labels from the model's answers. With labels, the report adds:

- **accuracy for each side,** with the `n` it rests on and an `unanswered` count: a row a side
  didn't answer (Jev undecided, a failed call, a parse failure) is unanswered, not wrong, so the
  two rates rest on different rows;
- **a head-to-head** over the labelled answers **both** sides gave. `winner` comes only from
  that, so a side can't win by declining the hard rows.

Read a small `n` as a lean, not a result. The labels file holds only ids and answers, so it can
be committed if your team may share the inputs' labels.

### The raw answers aren't the policy

`compare` scores each raw answer. The module acts only on answers that clear the spec's bars,
and keeps the existing answer otherwise. Two things follow:

- **The policy can do better or worse than Jev's raw accuracy.** Both dogfoods below scored the
  policy as it would run by replaying compare's answers through the module (their `evaluate`
  scripts).
- **The runtime calls a result `undecided` when any question is.** The fallback still carries
  the answers and lists the undecided questions. A module with diagnostic questions it doesn't
  act on can read the ones it needs from that fallback, as `tools/route-policy/policy.ts` does;
  the template's module takes the fallback.

## Runtime consent: the marked line

When you switch the module on, its grant is **the marked `EGRESS` line set to `"on"`**, and
nothing else ([decision 0020](../plans/decisions/0020-runtime-consent-for-adopted-code.md)):

- **The runtime reads no repo config for consent,** since a deployed app may have none. No
  environment variable grants it, and a key alone never does.
- **The agent never writes it.** Each generated test fails while the line is on, so switching it
  on means updating that test in the same change, on purpose. The same scan runs over the
  templates in this repo's CI.
- **Two locks.** In Python, the module checks its own `EGRESS`, and `decide runtime` reads the
  marked line from the module file: both must say on. In TypeScript the module passes
  `module: import.meta.url`, and the runtime reads that file's marked line the same way. A
  TypeScript build that drops comments (`tsc --removeComments`, esbuild, tsup, any bundle) needs
  `module: "bundled"`, which gives up the second lock and is also your edit
  ([the module lock and your build](runtime.md#the-module-lock-and-your-build)).
- **`decide doctor` reports** every module it finds with egress on, or opted out of the lock
  ([doctor: `adopted`](troubleshooting.md#doctor-adopted)).

The control is your review of the diff. An agent can write a line of code as easily as you can;
these rules make an agent-written grant easy to see, not impossible.

## Switch it on

Cutover is your call, after reading the report. Two edits, both yours:

1. Set the marked line to `"on"` and update the generated test that checks it, in one reviewed
   change.
2. Pass `enabled: true` (`enabled=True` in Python) where the app calls the policy, in the
   environments you choose.

Then the app needs, wherever it runs:

- **`OPENROUTER_API_KEY`** in its environment. Without one, calls fall back with `no-key`.
- **A writable `root`,** the directory `adopt` wired in, for the spend ledger. With one, the
  daily cap survives a restart and is shared by processes using the same directory. Without one,
  TypeScript counts spend in memory per process; Python can't make a live call at all
  (`decide runtime` answers `internal`).
- **The daily cap,** `MAX_USD_PER_DAY` in the module, $1.00 by default: about 30,000 decisions a
  day at current prices for small states (projected). At the cap every call falls back with
  `budget` until the UTC day turns.
- **Python only: run it outside an agent session.** `decide runtime` refuses a live call with
  `egress-off` when a Claude Code, Codex or Pi session variable is set. Replay still works.

Every call that doesn't use the model's answer still returns the existing answer, with a reason
your app can log or count: one of the [runtime's reason codes](runtime.md#results), `disabled`,
or `below-threshold`. A provider outage, a timeout or the cap never breaks the app; it runs as it
did before.

## Worked examples

Both dogfoods went through the whole chain on 2026-10-06. The full write-ups are in the
[M11 results](../plans/milestones/M9-M11-scout-guard-adopt.md#results). Costs are measured, as
reported by OpenRouter.

### `route.ts`: no gain, so the regex stays

The target was System 1's own prompt router (`packages/core/src/route/route.ts`), a set of
regular expressions that decides whether to hint the `ask` skill. The hoped-for gain was
quality. The module is in [`tools/route-policy/`](../tools/route-policy/policy.ts), run from
source as a shadow: the router ships inside the bundled `decide`, where the module lock can't
hold.

- **Capture and labels:** the 72 `ask` prompts of the routing eval sets, with each prompt's
  positive or negative label. The regex costs $0 and under 1 ms.
- **Compare** (live, $0.0029 in all): Jev at $0.000041 a call, p50 204 ms. On the `hint`
  question, Jev was right on 90.9% of 66 (6 undecided), the regex on 91.7% of 72; head-to-head,
  60 to 63, baseline ahead.
- **The policy as it would run:** 65 of 72 right, against the regex's 66.

**Verdict: no cutover.** The model was no better than the regex, and every prompt would pay about
200 ms and $0.00004 and send its text to the provider. At n = 72 that is a lean, not a result.

### `spamfilter`: fewer real comments blocked, at about the same cost

The target was [`mags0ft/spamfilter`](https://github.com/mags0ft/spamfilter), a small Python
package whose OpenAI filter makes one chat call (gpt-4o-mini, here via OpenRouter) parsed to
`{is_spam: bool}`. The adoption is kept as a patch in
[`evidence/dogfood-spamfilter/`](../evidence/dogfood-spamfilter/README.md), with the steps to
reproduce it.

- **Capture and labels:** 200 YouTube comments, 100 spam and 100 not, with the corpus's own
  labels. The shadow run cost $0.00406 ($0.000020 a call), p50 894 ms.
- **Compare** (live, $0.00375): Jev at $0.000019 a call, p50 199 ms, undecided on 5.0%. Jev was
  right on 93.7% of 190, the filter on 91.5% of 200; head-to-head, 178 to 175, Jev ahead.
- **The policy as it would run:**

  | | Right | Spam caught (of 100) | Real comments blocked (of 100) |
  |---|---|---|---|
  | The existing filter | 183/200 | 90 | 7 |
  | The policy | 188/200 | 90 | 2 |

  The model decided 179 of the 200; the other 21 kept the filter's answer, so they paid for both
  calls and the Node spawn. In all, the policy cost about 2% more than the filter alone.

**Verdict: a lean towards the policy.** It caught as much spam and wrongly blocked 2 real
comments instead of 7, but with 200 rows the difference isn't significant (exact McNemar
p ≈ 0.23). Cutover stays with spamfilter's users, and the module ships off.

## Where it falls short

- **Excludes don't reach runtime states.** `egress.exclude` matches paths, and a state built in
  memory has none. The module decides what goes into a state: leave out any field that mustn't be
  sent. Secret-shaped strings are still scrubbed, and an oversized state is refused, never cut
  short.
- **The grant guards reviewed code paths, not a determined agent.** An agent holding a key can
  call the provider directly. The key is yours to withhold.
- **The daily cap is approximate across processes,** and an in-memory ledger resets on restart.
  Give the runtime a shared, writable `root`.
- **The capture is only as good as the sample.** Both dogfoods ran on a few hundred inputs at
  most; a bigger, unseen set is what turns a lean into a result.
- **Replay matches states character for character.** A module whose `toState` changes, or one
  recorded under another model, misses in replay until its answers are recorded again.

For a module that falls back when you expect an answer, the reason code says why: see
[the runtime's results](runtime.md#results) and [troubleshooting](troubleshooting.md).
