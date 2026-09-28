# Guard: check the agent's work when it stops

A **guard pack** is a check that runs at a harness event and sends content to the decision
model. The only pack is **`done-check`**. When the agent stops, it reads your criteria (the open
bullets in `TASK.md` or `.system1/done.md`) and judges the session's change against them. If a
criterion is clearly not met, it blocks the stop once and names that criterion, so the agent
carries on.

It exists because an agent rarely hands off a check of its own work, even when a skill says it
should ([Known gap #1](../plans/ROADMAP.md#1-claude-does-not-hand-off-a-review-of-its-own-work-routing-ask)).
A hook runs whether or not the agent chooses to.

- **Where it runs:** Claude Code and Codex. The plugin installs the hooks. Pi has no hooks for it
  yet.
- **Off until you turn it on,** in each repo. Until then the hooks send nothing and write
  nothing, adding about 55 ms at session start and at each stop.
- **Turning it on is yours to do.** Enabling a pack is your decision, like
  [egress consent](getting-started.md). Without a terminal, `decide` refuses unless the command
  carries a flag that is yours to type, and the plugin's skills never pass it.

## Turn on done-check

1. **Grant egress consent in the repo**, if you haven't: `decide doctor` says whether it's
   there, and the `setup` skill walks through it.
2. **Enable the pack**, in a terminal at the repo root, if `decide` is installed there
   (`npm i -g @garygentry/system1`):

   ```sh
   decide guard enable done-check
   ```

   With the Claude Code plugin alone, `decide` is on the agent's PATH, not your terminal's, so
   use the `!` prompt. It has no terminal, so add the flag that says the decision is yours:
   `! decide guard enable done-check --i-consent`. `--confirm` doesn't count: agents pass
   it to approve spend. The `guard` skill (`/system1:guard`, `$system1:guard`) explains all this
   and gives you the line, but never runs it.
3. **In Codex, trust the hooks once.** Open Codex interactively in the repo and trust the system1
   hooks when it asks. Codex skips an untrusted hook without a word, and it may ask again after
   a plugin update. `decide doctor` warns while they're untrusted.
4. **Write the criteria** (next section).

Enabling writes `guard.packs.done-check.enabled: true` into `.system1/config.yaml`, with when and
how. Committing that file turns the check on for everyone who clones the repo, so that's your
team's call. `decide guard status` shows each pack and the repo's consent.

## Write criteria that work

done-check reads bullets (`-`, `*`, `+`, `1.` or `1)`, with or without a `[ ]` box) from
`TASK.md` and `.system1/done.md`. A bullet ticked `[x]` counts as done and is skipped.

```markdown
# Task: expiring links

- [ ] `LinkStore.put` accepts an optional `ttlMs` and records when the link expires.
- [ ] `LinkStore.get` returns `undefined` for a link whose ttl has passed.
- [ ] The README documents the ttl option with an example.
```

Use `TASK.md` for this task, and `.system1/done.md` for rules every change should follow:

```markdown
# Rules for every change

- No `console.log` or other debugging output is added.
- No secret, password or API key is added.
- No new dependency is added to package.json.
```

- **One checkable statement per bullet,** about code, docs, tests or files: "`get` returns
  `undefined` for an expired link", not "expiry works well and is documented".
- **Name the file where the evidence lives.** A bullet that names a file sends that file whole,
  even when the change didn't touch it. That's how "the README documents it" can be judged.
  Up to three files per bullet and ten in all are sent, and they must be tracked by git.
- **Leave out what the change can't show:** "deployed to staging", "the product owner approved
  it", "users find it clear". The model rates these as not judgeable, and a criterion it can't
  judge never blocks.
- **Exact facts aren't sent at all:** "all tests pass", "coverage above 90%", "before Friday".
  They are listed for the agent to check itself. For test results, send the log as evidence
  instead:

  ```yaml
  # .system1/config.yaml
  guard:
    packs:
      done-check:
        evidence: [test-output.log]
  ```

- **Other files:** `criteria: [docs/ACCEPTANCE.md]` reads a different list of files
  ([settings](configuration.md#guard-packs)).

If the agent edits or ticks its own criteria during the session, done-check still checks the
version from the start of the session, and says the file changed.

## What happens at a stop

- **Nothing changed since the session started:** nothing is sent. This covers a stop to ask you
  something before any work. Evidence files don't count as a change.
- **Nothing changed since the last check:** nothing is sent.
- **A criterion is clearly unmet:** the stop is blocked, and the agent sees:

  ```text
  System 1 done-check: these criteria look unmet by this session's change:
  - The README documents the ttl option with an example.
  Finish them, or say why they don't apply. The next stop is allowed.
  ```

  The agent either finishes the work or explains why the criterion doesn't apply. **The next
  stop is always allowed**, so done-check can't trap the agent in a loop.
- **Otherwise the stop goes through,** with one line saying what was checked, for example
  `System 1 done-check: 2 of 3 criteria met, 1 not settled`.
- **When it can't check,** because of a provider error, a timeout, a missing key or the spend
  cap, the stop goes through with the reason: `System 1 done-check: not checked: …`. "Checked and
  fine" never looks like "not checked".
- **A change too large to send in one call** is checked per criterion, over the files that share
  its words. That partial view can say "met", but it never blocks: the others show as "not
  settled", noting the change was too large.

It blocks only when the model is confident on both counts: that the criterion can be judged from
what it was shown, and that it isn't met. Anything unsure is reported, never blocked.

## What it sends, and what it costs

When a check runs, it sends the decision model, under the repo's egress consent:

- the criteria bullets;
- the session's change since it started, including commits made during the session and new
  untracked files;
- the files the criteria name, and any evidence files.

Secret-looking files are left out and listed, secret-shaped strings are scrubbed, and nothing
too large is cut short (see [concepts](concepts.md)). A criterion that names a withheld file is
left for the agent to check.

- **Cost:** usually one call per check, about $0.00004–0.00005 measured.
  `maxUsdPerSession` (default $0.01) caps what done-check spends in one session.
- **Latency:** a check that calls the model added a median of about 460 ms at the stop, and
  615 ms at the 95th percentile (measured on 2026-09-27). `latencyMs` (default 5000) is the
  limit. Past it, the stop goes through with a note.
- **Accuracy:** on 38 labelled stop events run live 3 times each, it blocked no finished work
  and caught every unfinished task. In an earlier run it missed one half-done criterion in 2
  of 3 tries.
  Details and limits are in [evaluation](evaluation.md#done-check-does-the-stop-hook-block-the-right-stops).

### How the install affects it

The hooks run `decide` with downloads turned off. So they never wait on npm, and they find the
CLI one of these ways:

| Install | Added at each stop, pack off | Notes |
|---|---|---|
| Global (`npm i -g @garygentry/system1`) | about 55 ms | Recommended when a pack is on. Codex needs it anyway |
| Claude Code plugin only, CLI in npx's cache | about the same | Found in npx's cache and run directly |
| Claude Code plugin only, not in npx's cache | nothing, and no check | See below |

With the Claude Code plugin alone, the CLI lives in npx's cache, which fills the first time the
agent runs `decide`. After a plugin update, or an npm cache clean, there's no cached copy of the
new version. Until the agent runs `decide` again, the hook finds no CLI and **skips the check
without a word**. When a pack is on and `decide` runs from npx's cache, `decide doctor` warns
that the setup can fail this way. A global install avoids it. For comparison, a call that goes
through `npx` itself takes about 720 ms. The hooks never make one.

## Where it falls short

- **Stops to ask a question.** When the agent stops mid-task to ask you something, done-check
  doesn't read its message. So it blocks when the work so far leaves a criterion unmet, which
  happened in 9 of 12 such stops measured. The agent's next stop is allowed.
- **Large changes are checked only in part, and never blocked.** That includes a change beside
  one large untracked file, such as a 100 KB log. Add such files to `.gitignore`, or to
  `egress.exclude`.
- **It judges the text, not the behaviour.** It can't run the tests. A bullet it can't settle
  from the change is reported, not blocked.

## Turn it off

```sh
decide guard disable done-check
```

That needs no consent, since it only stops content being sent. When a check blocked, skipped or
said nothing and you don't know why, see
[troubleshooting](troubleshooting.md#done-check-blocked-skipped-or-said-nothing).
