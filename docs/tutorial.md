# Lab: from zero to your first decisions

A hands-on lab for Claude Code. You install System 1, set it up properly, and then use it the way
it's meant to be used: asking your agent for verdicts over a batch of items and watching it hand
them to the decision model. You'll also see one case where it correctly stays out of the way.

| | |
|---|---|
| **Time** | about 20 minutes |
| **Cost** | about 1 cent of OpenRouter credit, plus your Claude Code usage |
| **You need** | Claude Code, Node 22 or newer, `git`, `curl`, and an [OpenRouter](https://openrouter.ai) API key with a little credit |
| **Works in** | a throwaway lab repo in your home directory; none of your own code is sent anywhere |
| **Version** | written for System 1 0.3.2. On 0.3.1, dry runs project about half the real cost and the setup skill's consent command lacks `--confirm`; use the one in Exercise 3 |

Using Codex or Pi? The flow is the same with a few differences; see
[Using Codex or Pi](#using-codex-or-pi).

## What you'll learn

By the end you will have:

1. installed the plugin and confirmed `decide` works inside Claude Code;
2. stored your API key where every session can find it, without pasting it into a conversation;
3. granted egress consent for one repo, and know what it allows;
4. routed 300 support tickets to teams, and read the answers the way they're meant to be read;
5. gated a risky script with one calibrated verdict per command;
6. seen a request the agent should handle itself, without `decide`;
7. checked what it all cost, measured, not estimated;
8. (optional) repaired a saved question that gives bad answers.

## How the lab works

Each exercise has the same parts:

- **Do** — the steps. Lines starting with `>` are prompts you type into Claude Code, word for word.
  Code blocks are commands for your terminal, unless they start with `!`, which you type at the
  Claude Code prompt.
- **Checkpoint** — what you should see before moving on. The outputs shown are from one real
  run. Claude writes its own questions, so your numbers, and now and then a verdict, will differ;
  the shape should match.
- **If it didn't** — the usual cause and fix.
- **What just happened** — the idea behind the step.

Work through them in order. Each one assumes the ones before it, and all of them assume one
Claude Code session from Exercise 3 on (Exercise 7 counts spend per session).

Claude Code will ask you to trust the lab folder the first time, and to approve each `decide …`
command. Approving `decide` for the session saves a lot of clicking.

---

## Exercise 0: Make the lab repo

**Do.** Download the lab material from the 0.3.2 release, a small made-up codebase with tickets,
reviews, logs and a cleanup script with problems planted in them, and make it a git repo:

```sh
mkdir -p ~/system1-lab
curl -sL https://codeload.github.com/garygentry/system1/tar.gz/refs/tags/v0.3.2 \
  | tar -xz -C ~/system1-lab --strip-components=4 system1-0.3.2/tools/evals/fixture-repo
cd ~/system1-lab
git init -q
```

**Checkpoint.** `ls ~/system1-lab` shows:

```text
README.md  TASK.md  cleanup-plan.sh  commits.txt  failures.jsonl  packages.jsonl
reviews.jsonl  src  test-output.log  tickets.jsonl
```

and `ls ~/system1-lab/.system1/specs` shows `timeouts.yaml`.

**If it didn't.** An empty directory usually means the `tar` path didn't match. Check that `curl`
fetched something: `curl -sIL https://codeload.github.com/garygentry/system1/tar.gz/refs/tags/v0.3.2`
should end with `200`.

**What just happened.** `decide` treats the nearest directory holding `.git` or `.system1` as the
repo. Consent, saved questions and the spend log all live there, per repo. Making the lab its own
git repo keeps everything you do here out of any other project, even if your home directory is
itself inside a repo.

---

## Exercise 1: Install the plugin

**Do.** Start Claude Code in the lab repo:

```sh
cd ~/system1-lab && claude
```

Then, at the Claude Code prompt:

```text
/plugin marketplace add garygentry/system1
/plugin install system1@system1
/reload-plugins
```

The same from your terminal, before starting Claude Code:
`claude plugin marketplace add garygentry/system1 && claude plugin install system1@system1`.
If `/plugin install` asks where to install, choose your user. (Restarting Claude Code works in
place of `/reload-plugins`.) If you run Claude Code with its sandbox on, allow outbound
access to `openrouter.ai`, and to `registry.npmjs.org` for the first run, which downloads the CLI.

**Checkpoint.** Type `/system1:` and you should see `setup` offered. Then run:

```text
! decide version
```

It prints the CLI's version number. The first run can take a few seconds.

**If it didn't.** `command not found` means the plugin isn't loaded in this session: run
`/reload-plugins`, or restart Claude Code. Note that `decide` works at the Claude Code prompt
(with `!`) and in Claude's own commands, but not in your normal terminal. That's expected; see
below.

**What just happened.** The plugin brings three skills (`ask`, `design`, `setup`), a `decide`
command on Claude's PATH, and one prompt hook. The `decide` it adds is a small launcher, pinned to
the plugin's version. The first time it runs, it fetches that version of the CLI with `npx`, and
it reuses the copy after that. Your own shell doesn't get `decide` unless you also install it with
`npm i -g @garygentry/system1`. This lab works without it, but outside the lab it's the
recommended install: it's what puts `decide` in your terminal, CI and scripts.

---

## Exercise 2: Add your key

Your OpenRouter key goes in a file that only you can read. Every Claude Code session, in any repo,
then finds it without you exporting anything.

**Do.** In your terminal, in bash or zsh (not in Claude Code, so the key never appears in the
conversation).
`read -rs` takes the key without showing it or saving it in your shell history: paste it, then
press Enter.

```sh
mkdir -p ~/.config/system1
read -rs key
( umask 077; printf 'openrouter_api_key: %s\n' "$key" > ~/.config/system1/credentials ); unset key
```

The file must hold exactly that one line. If you set `XDG_CONFIG_HOME`, use
`$XDG_CONFIG_HOME/system1/credentials` instead.

**Checkpoint.**

```sh
ls -l ~/.config/system1/credentials
```

shows `-rw-------`: readable by you only.

**If it didn't.** `No such file or directory` means the `mkdir` step was skipped. If the
permissions are wider, run `chmod 600 ~/.config/system1/credentials`; `decide` refuses a key file
that others can read.

**What just happened.** `decide` looks for the key in `OPENROUTER_API_KEY` first, then in this
file. It never reads a project's `.env`, never prints the key, and only ever reports whether one is
present. Never paste your key into a conversation with an agent; the skills never ask for it.

---

## Exercise 3: Run setup and grant consent

**Do.** At the Claude Code prompt:

```text
/system1:setup
```

The setup skill runs `decide doctor` and walks you through anything it reports.

**Checkpoint 1.** You should see a report like this, with one warning left, for consent:

```text
decide doctor: SETUP NEEDED (consent) · replay only · harness claude · session claude:…
  ok   cli: decide 0.3.… on node v22.… (…)
  ok   path: decide on PATH: …/bin/decide
  ok   path-version: decide on PATH is 0.3.…, same as this one
  ok   key: OPENROUTER_API_KEY present (credentials)
  warn consent: no egress consent for /home/you/system1-lab: live calls are refused
       fix: if the user agrees, they grant it themselves (an agent must not): …
  ok   route: routing hints on: batch-judgement, pick-from-many, criteria-check, done-check, gate-check
  ok   network: typesafe/jev-1.13 reachable in 218 ms
```

The skill explains what consent allows. Read it. In short:

- **What it allows:** when `decide` runs live, it sends the text of the items being judged (file
  contents, diff hunks, rows) to the decision model on openrouter.ai.
- **What always applies, with or without consent:** files that look like secrets (`.env*`, keys,
  credentials) are never sent; secret-shaped strings are scrubbed from everything that is sent;
  anything outside the repo is withheld unless `--allow-outside` is passed; an item too big for
  the model is refused, never cut short.

**Do.** If you agree, grant it yourself, at the Claude Code prompt:

```text
! decide config egress allow --confirm
```

**Checkpoint 2.** Ask setup to check again, or run `! decide doctor --format brief`. The first
line now reads:

```text
decide doctor: healthy · live ready · harness claude · session claude:…
```

**If it didn't.**

- `egress-refused` without `--confirm`: the `!` prompt has no terminal, so `decide` needs
  `--confirm` to know the decision is yours.
- `key` still warns: check Exercise 2, then the [key check](troubleshooting.md#doctor-key).
- `network` fails: the sandbox is blocking `openrouter.ai`, or you're offline.

**What just happened.** Consent is recorded in `.system1/config.yaml` in this repo only. Claude
didn't grant it: the skills tell it never to, and `decide` refuses the command without a terminal
unless `--confirm` is given. That flag is yours to type, never the agent's. In a real project,
committing `.system1/config.yaml` shares the consent with everyone who clones the repo, so make
that a team decision.

---

## Exercise 4: Route 300 tickets

`tickets.jsonl` holds 300 support tickets, one JSON object per line. You want each one sent to the
right team.

**Do.** At the Claude Code prompt:

> Route each of the support tickets in tickets.jsonl to the team that should handle it: billing, auth, infra or other.

Watch what Claude does. You should see, roughly in this order:

1. **A routing hint.** The plugin's prompt hook notices a batch judgement and adds a line to your
   prompt: `System 1 routing hint (batch-judgement): …`.
2. **The `ask` skill loads.** Claude checks for a saved question (`decide spec list`), then writes
   a choice question with a description of each team.
3. **A dry run.** `decide many … --dry-run` projects the calls and the cost, and sends nothing:

   ```text
   decide many (dry run): would send 300 item(s) to typesafe/jev-1.13 · projected $0.006397 (~152313 tokens, …) · no calls made
   ```

4. **The spend guard stops it.** 300 calls is over the default guard of 200 calls per run, so the
   live run stops before sending anything:

   ```text
   decide many: error budget-exceeded — Over the spend guard (300 calls > 200). Narrow the source, or re-run with --confirm to proceed.
   ```

   Claude should show you the projection and **ask you** whether to go ahead. Say yes. Only then
   does it re-run with `--confirm`. This `--confirm` approves spend, and Claude adds it only
   because you said yes. It has nothing to do with consent's `--confirm` in Exercise 3, which is
   only ever yours to type.

**Checkpoint.** The run's first line looks like this:

```text
decide many: 300 kept of 300 · 0 undecided · 0 dropped · live typesafe/jev-1.13 · $0.005524 measured · 10.5 s
```

followed by `kept:` and one line per ticket, such as:

```text
  tickets.jsonl:row16  team=infra(0.59)  "{"id":"T-1015","text":"Urgent: exports have been stuck … in 'processing' for two days…"
```

Claude then summarises how many tickets went to each team, and which answers it checked itself.

**If it didn't.**

- **No hint and no skill.** The hook runs only once the CLI has been fetched (Exercise 1's
  `! decide version` does that). You can always ask directly: add "use the system1 ask skill" to
  your prompt.
- **Exit 3, `egress-refused`.** Consent isn't granted in this repo; go back to Exercise 3.
- **Claude added `--confirm` without asking you.** It shouldn't. Tell it so; the skill says to
  show you the projection and wait.

**What just happened.** Read the first line from left to right:

- **kept / undecided / dropped.** With no filter, every decided answer is kept. An **undecided**
  answer is one whose probabilities came back too flat to act on. `decide` lists undecided items
  separately and never counts them as kept or dropped; you (or the agent) read those yourself.
- **The number in brackets** is the model's confidence in its pick: how concentrated its answer
  is on that team rather than spread across the four. `infra(1)` is as confident as it gets; `infra(0.59)` is a
  genuine lean, not a coin flip. Low confidence is not undecided: it's a signal
  to look. In our run, Claude read the 14 answers below 0.7, agreed with 13, and fixed one
  (a partnership enquiry sent to infra at 0.50) by hand.
- **`live`, and the measured cost.** The cost comes from the provider's usage report, not an
  estimate. The dry run's figure was labelled *projected*, and the real cost came in about 15%
  under it, the direction a projection is meant to err.

Each ticket was one call of about 300 ms. They run in parallel, so 300 took about 10 seconds and
half a cent, and Claude never had to read all 300 tickets into its own context.

---

## Exercise 5: Gate a risky script

`cleanup-plan.sh` is a nightly cleanup script "proposed by the ops bot". Before approving it, you
want a verdict on every command.

**Do.**

> cleanup-plan.sh is what the ops bot wants to run tonight on the shared build server. Before I approve it, give me a calibrated verdict for each command: is it destructive?

**Checkpoint.** Claude splits the script into one item per line and asks a yes/no question of each
(here it skipped the first two lines, the shebang and a comment, so about 40 items). You get a
probability per command:

```text
decide many: 40 kept of 40 · 0 undecided · 0 dropped · live typesafe/jev-1.13 · $0.000656 measured · 1.6 s
kept:
  cleanup-plan.sh:3   destructive=0.01  "du -sh /var/cache/build/*"
  cleanup-plan.sh:4   destructive=0.38  "chmod -R 777 /srv/secrets"
  cleanup-plan.sh:5   destructive=0.95  "docker system prune -af --volumes"
  cleanup-plan.sh:11  destructive=0.98  "rm -rf /srv/artifacts/infra"
  cleanup-plan.sh:12  destructive=0.96  "psql -h db.internal -c 'TRUNCATE builds CASCADE'"
  …
```

Then a verdict you can act on: which lines to strike before this runs.

**If it didn't.** A single verdict for the whole file means the script wasn't split. Ask for "one
verdict per command".

**What just happened.** Look at line 4. `chmod -R 777 /srv/secrets` came back at only 0.38. It
deletes nothing, so as a "destructive" question the model leans no. But it makes
every secret on a shared server readable by everyone, which is arguably worse. **An answer that
looks wrong usually means the question was badly posed.** In our run, Claude caught this and
asked a sharper question of that one line:

```text
decide ask: cleanup-plan.sh:4-4 · live typesafe/jev-1.13 · 832 ms · $0.000012 measured
  exposes=0.97
```

If yours didn't, ask it: *"Do lines 4 and 37 make sensitive files readable by every user?"* (The
script repeats several commands, `chmod` included, so check the repeats too.) Rewording
the question is the fix, not overriding the answer in your head.

---

## Exercise 6: When not to use it

**Do.**

> What does src/billing/charge.ts do?

**Checkpoint.** No routing hint, no skill, and no `decide` call. Claude just reads the file and
explains it.

**If it didn't.** If Claude reached for `decide` here, that's a routing miss worth reporting.

**What just happened.** `decide` answers **closed** questions: pick one of these, yes or no,
rate on this scale. Explaining code, writing it, summarising, counting and exact lookups are the
agent's own job. The skills are written to stay out of the way for those, and a single file that
fits in context is better read than judged.

---

## Exercise 7: See what you spent

**Do.**

```text
! decide usage --session current --format brief
```

**Checkpoint.**

```text
usage (measured): 341 call(s) — 341 live, 0 replayed · $0.006193 · 147447 input tokens · session claude:…
```

**What just happened.** Every call is logged in `.system1/usage.jsonl` with the provider's own
token and cost figures. `--session current` limits it to this Claude Code session. Drop it to see
everything this repo has spent, or use `--since`.

---

## Exercise 8 (optional): Repair a bad question

The lab repo came with a saved question, `.system1/specs/timeouts.yaml`, meant to find network
calls that could hang. It's broken on purpose.

**Do.** First, see the problem:

> Run the saved timeouts spec and show me which files it flags.

Claude runs `decide many --spec timeouts`. Expect something like
`34 kept of 86 · … · $0.001143 measured`: far too many files. Open
`.system1/specs/timeouts.yaml` and you'll see why. Its whole question is "The code does
networking", which says nothing about timeouts.

Then fix it:

> The saved spec .system1/specs/timeouts.yaml flags files that are fine. Repair it so it only flags network calls without a timeout.

**Checkpoint.** The `design` skill loads. It may start by running `decide spec check timeouts`,
which fails with "has no examples to check": expected, since the spec has none yet. Claude then
rewrites the question with explicit criteria for
true and false, adds a few examples with the answers they should get, records the model's answers
for them (a few live calls), and checks them. When it's done:

```text
! decide spec check timeouts --format brief
```

reports `PASSED` offline, from the recorded answers, and running the spec again keeps far fewer
files.

**What just happened.** A spec is a question you keep: its wording, its threshold, its default
source and examples with known answers. The recorded answers in `.system1/fixtures/timeouts/` make
`decide spec check` a free regression test, so a later edit that breaks the question fails
without a key or a network. See [specs.md](specs.md).

---

## Wrap-up

You've now:

- [x] installed the plugin and run `decide` inside Claude Code;
- [x] stored a key in `~/.config/system1/credentials`, readable only by you;
- [x] granted consent for one repo, yourself, knowing what it sends and what it never sends;
- [x] routed a batch with a choice question, and read kept, undecided and confidence correctly;
- [x] seen the spend guard stop a run until you approved it;
- [x] gated a script with per-command verdicts, and fixed a badly posed question by rewording it;
- [x] seen the agent handle an ordinary request itself;
- [x] checked the measured cost.

## Clean up

Nothing here touched your own projects. Consent, specs and the spend log all live inside the lab
repo, so removing it removes them. In your terminal:

```sh
rm -rf ~/system1-lab
```

(To keep a repo but stop live calls from it, `decide config egress deny` withdraws its consent.
It's per repo, so no other repo is affected.)

Keep `~/.config/system1/credentials` if you'll use System 1 elsewhere; otherwise delete it. To
remove the plugin: `/plugin uninstall system1@system1`. The CLI copy it downloaded sits in npm's
`npx` cache, which npm manages; `npm cache clean --force` clears it if you want it gone.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `decide: command not found` in your terminal | The plugin puts `decide` on Claude's PATH only | Use `!` at the Claude Code prompt, or `npm i -g @garygentry/system1` |
| `! decide …` also not found | The plugin isn't loaded in this session | `/reload-plugins`, or restart Claude Code |
| `egress-refused` (exit 3) | No consent in this repo | Exercise 3; [details](troubleshooting.md#egress-refused--exit-3) |
| `budget-exceeded` (exit 4) | The run is over 200 calls or $0.05 | Approve it (Claude re-runs with `--confirm`) or narrow the source; [details](troubleshooting.md#budget-exceeded--exit-4) |
| `replay-miss` (exit 6) saying no API key is set, or doctor warns `key` | `decide` found no key, so it could only replay | Exercise 2; [details](troubleshooting.md#doctor-key) |
| `config-error` (exit 2) naming the credentials file | The file is readable by others, or isn't the one `openrouter_api_key:` line | `chmod 600` it, fix the line; [details](troubleshooting.md#config-error--exit-2) |
| No routing hint on a batch prompt | The CLI hasn't been fetched yet, or the prompt didn't match a pattern | Run `! decide version` once; or name the skill in your prompt |

Everything else is in [troubleshooting.md](troubleshooting.md).

## Using Codex or Pi

The exercises work the same way, with these differences:

| | Codex | Pi |
|---|---|---|
| Install | `codex plugin marketplace add garygentry/system1`, then `codex plugin add system1@system1` | `pi install npm:@garygentry/system1-pi` |
| `decide` | `npm i -g @garygentry/system1` (Codex doesn't put plugin `bin/` on PATH) | `npm i -g @garygentry/system1` |
| Network | Add `prefix_rule(pattern = ["decide"], decision = "allow")` to `$CODEX_HOME/rules/system1.rules` (`$CODEX_HOME` defaults to `~/.codex`), then restart Codex | no sandbox |
| Setup | `$system1:setup` | `/skill:setup` |
| Consent | `decide config egress allow` in your terminal, in `~/system1-lab` | the same |
| Routing hint | none (the prompt hook is Claude Code's); the skills load from their descriptions | none; the same |

Because `decide` is installed globally for these, you can run Exercises 3 and 7 in your own
terminal instead of with `!`.

## Where next

- **Your own repo:** [getting-started.md](getting-started.md) is the short version of Exercises
  1–3.
- **Questions worth keeping:** [cookbook.md](cookbook.md) has tested specs to copy, and
  [specs.md](specs.md) shows how to write your own.
- **What the numbers mean:** [calibration.md](calibration.md) on probabilities and thresholds,
  [concepts.md](concepts.md) on undecided, live and replay, and what gets sent.
- **Scripts and CI:** [ci-and-scripts.md](ci-and-scripts.md).
