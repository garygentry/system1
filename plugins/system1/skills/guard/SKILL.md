---
name: guard
description: Explain System 1's guard packs, the opt-in hook checks such as done-check that judge an agent's finished work against the repo's criteria at Stop, and give the user the exact line to enable, tune or turn one off themselves. Use only when the user explicitly asks about guard, guard packs or done-check.
disable-model-invocation: true
---

# Guard packs

A guard pack is a hook check that sends content to the decision model at a harness event. The plugin ships its hooks already installed. Each pack stays **dormant** in a repo, sending and writing nothing, until the user enables it there.

Your job is to explain what a pack does and what it costs, show where this repo stands, and hand the user the exact line to type. **Enabling a pack is the user's decision, like egress consent. You never run `decide guard enable`**, whatever you're asked. Don't run it to try it, and don't run it "for" the user.

## 1. Where this repo stands

Run each of these on its own:

```sh
decide guard list --format brief
decide doctor --format brief
```

- From `guard list`, show each pack's line as printed: `active` (enabled, with consent), enabled but dormant (no consent), or `dormant`.
- From `doctor`, show the `consent` line and any `guard` line, with its `fix:` if it has one.

## 2. Explain the pack the user asked about

The only pack is **`done-check`**. Cover these five points in plain words.

1. **What it does.** When the agent stops, done-check reads the open bullets of the repo's criteria files, by default `TASK.md` and `.system1/done.md`. Ticked `[x]` boxes are skipped. It asks the decision model two things about each bullet: can this be judged from the change, and is it met?
   - It **blocks the stop once**, only when a criterion is confidently judgeable and confidently unmet. The block names that criterion, and the agent carries on.
   - A second stop in a row is always allowed.
   - Undecided or unjudgeable criteria never block; the message counts them as "not settled". Bullets that ask for an exact fact, a count or a date ("all tests pass", "before Friday") aren't sent at all; the message counts them as "for the agent to check".
   - If a criteria file changed during the session, the check uses the version from the start of the session, and the message says it changed.
   - Once it has checked, it checks again only when something it sends has changed. So a later stop where the agent just asks the user a question sends nothing.
2. **What it sends** to the provider (openrouter.ai), under the repo's egress consent:
   - the criteria bullets;
   - the session's change since it started, including commits made during the session and new untracked files;
   - tracked files the criteria name (up to three per criterion, ten in all), and any `evidence` files configured.

   The usual rules always apply: secret-looking files are left out and listed, secret-shaped strings are scrubbed, and oversized content is split or skipped with a reason, never cut short.
3. **Cost.** Usually one decision call per check, about $0.00003. `maxUsdPerSession` (default $0.01) caps what done-check spends in one session. Once the cap is reached, checks are skipped and the message says so.
4. **Latency.** A check adds at most `latencyMs` (default 5000 ms, at most 55000) at the stop. Past that, the stop goes through with a note saying it wasn't checked.
5. **It fails open, with a reason.** Once the pack is active, a provider error, timeout, budget cap or size limit lets the stop through with a one-line message giving the reason, so "checked and fine" looks different from "not checked". The exceptions are a config file that doesn't load and a `decide` the hook can't run: then the hook does nothing, and `decide doctor` shows why.

**Where it runs:** Claude Code and Codex. Pi has no hooks for it yet.

**Codex** also asks the user to trust each plugin hook once, in an interactive session. An untrusted hook is skipped without a word; once a pack is enabled, `decide doctor` warns about it.

## 3. Hand over the enable line

Enabling needs egress consent in this repo first. If `doctor` shows no consent, explain that first; the `setup` skill walks through it. Then show the line; don't run it:

```text
decide guard enable done-check
```

- **Where to type it.** In a terminal at this repo's root, if `decide` is on that shell's PATH. Typing it there is the decision.
- **Through a shell escape.** If `decide` isn't on the user's own shell's PATH, they can type the same line through their prompt's shell escape, if they have one (in Claude Code, a line starting with `!`). With no terminal there, the command stops and tells the user the one flag that says the decision is theirs. That flag is theirs to add. Never add it, never show it in a command, and never run the escaped line yourself.
- **Committing.** Enabling writes `guard.packs.done-check.enabled` into `.system1/config.yaml`. Committing that file turns the check on for everyone who clones the repo, so point that out and leave the choice to the user.

## 4. Criteria that work

Offer to help write `TASK.md` or `.system1/done.md`. Write them only after a yes.

- Make each bullet one checkable statement about the change, like "`greet` returns the greeting" or "the README documents `greet` with an example".
- A bullet that names a file sends that file along, so name the file where the evidence lives.
- Keep out what the change can't show, such as "deployed" or "the user approved". The model usually rates those unjudgeable, and an unjudgeable criterion never blocks, but it's still a call spent. Test results belong in an `evidence` file, such as a test log, not in a bullet.

## 5. Tuning and turning it off

- **Settings** live under `guard.packs.done-check` in `.system1/config.yaml`: `latencyMs`, `maxUsdPerSession`, `criteria` (a list of files) and `evidence` (for example a test log). Change them only after the user says yes to that specific change. `enabled` is set only by the enable and disable commands.
- **Turning it off:** `decide guard disable done-check`. It needs no consent, since it only stops egress. Run it only when the user asks you to, and show its output.
- **Why did it block, or skip?** The block reason names the unmet criterion. A skip says why in its message. `decide guard status --format brief` shows the pack and this repo's consent.

## Rules

- Never run `decide guard enable`, with or without any flag, and never write `enabled` into a config file.
- Run each `decide` command on its own. Don't chain it with other commands.
- Nothing here spends money: `guard list`, `guard status` and `doctor` make no decision calls.
