---
name: setup
description: Set up or troubleshoot System 1, the decision-model toolkit. Checks the `decide` CLI, API key, repo egress consent and network access from this shell, and walks the user through fixing each problem with their consent. Use only when the user explicitly asks to set up, configure, check or troubleshoot decisions.
disable-model-invocation: true
---

# Set up System 1

Take the user from "installed" to "live-ready", or tell them exactly what's missing. **You make each change to the machine only after the user has said yes to that specific change.** Two things are never yours to do: granting egress consent, and handling the API key.

## 1. Diagnose

```sh
decide doctor --format brief
```

- **`decide: command not found`:** the CLI isn't on PATH. Tell the user the System 1 CLI isn't installed for this shell.
  - A plugin install puts `decide` on PATH in some hosts, but not all.
  - Where the plugin doesn't, the user installs it globally: `npm i -g @garygentry/system1`. If the package isn't published yet, the user puts `plugins/system1/bin` from a checkout of the decisions repo on PATH instead.
  - Offer to run that install. Run it only after a yes, then run `doctor` again.
- **Otherwise:** the first line gives the overall state, then `live ready` or `replay only`. The state is `healthy`, `SETUP NEEDED (…)` naming the checks that stand between this shell and a live decision, or `PROBLEMS FOUND` when a check failed. Each check follows as `ok`, `warn` or `fail`, with a `fix:` line for each problem.
  - Show the user the output as printed.
  - Then work through each `warn` or `fail` in the order below, one at a time.

## 2. Fix, one problem at a time

### `path` or `path-version`

`decide` is missing from PATH, or the one on PATH is a different version from the one running.

1. Show the `fix:` line.
2. If it's an install command, ask the user whether to run it.
3. Run it only after a yes.

### `network` with a `prefix_rule` fix (the Codex sandbox)

The shell has no network access for `decide`.

1. Explain this, and show the exact rule line and file path from the `fix:` line.
2. Ask the user whether to add it.
3. On a yes:
   - create the `rules` directory if it's missing;
   - if the file already contains that exact line, leave it alone;
   - otherwise append the line to the file.
4. Change nothing else in the Codex configuration.
5. Tell the user to restart Codex for the rule to take effect.
6. Tell the user the rule only covers commands that start with `decide`: a pipe into `decide` still runs without network.

### `network`, anything else

Show the `fix:` line. Sandbox allowlists, proxies and firewalls are the user's settings, so don't edit them.

### `key`

1. Tell the user where the key goes, in whichever form they prefer:
   - the `OPENROUTER_API_KEY` environment variable;
   - `~/.config/system1/credentials`, a YAML file containing one line, `openrouter_api_key: <the key>`, and set to `chmod 600`. They may need to create `~/.config/system1` first. Any other format makes every `decide` command fail with a config error.
2. **Never ask for the key in the conversation, and never print, echo or write it yourself.**
3. Without a key, only replay of recorded answers works. That's a supported mode, not an error.

### `consent`

Egress consent is the user's decision, given once per repo.

1. **Explain what it allows.** When `decide` runs live, it sends the text of the items being judged (file contents, diff hunks, piped output) to the decision model on openrouter.ai.
2. **Explain what always applies**, with or without consent:
   - files that look like secrets (`.env*`, keys, credentials) are excluded;
   - secret-shaped strings are scrubbed from everything sent;
   - oversized items are refused, never truncated.
3. **Give them the command to type themselves.** Show it; don't run it.
   - **In a terminal at this repo's root,** if `decide` is on that shell's PATH. Typing it there is the decision:

     ```text
     decide config egress allow
     ```

   - **Through your prompt's shell escape,** if they have one (in Claude Code, a line starting with `!`). Use this when `decide` isn't on their own shell's PATH. The escape has no terminal, so `decide` needs `--confirm` to know the decision is theirs, and they type it themselves:

     ```text
     ! decide config egress allow --confirm
     ```

     `--confirm` is theirs to type, never yours to add.

   Consent is recorded in `.system1/config.yaml`. Committing that file shares the consent with everyone who clones the repo. That's the team's call, so point it out and don't decide it for them.

4. **Never run `decide config egress allow` yourself, with or without `--confirm`.** Don't run the `!` line either: in a shell, a leading `!` only inverts the exit status, so it would grant consent and then report failure.

### `config`

Show the problem and its `fix:` line. The user corrects the file or variable named there.

## 3. Housekeeping (optional)

If this repo has a `.system1/` directory, suggest adding these lines to `.gitignore`:

```
.system1/fixtures/adhoc/
.system1/usage.jsonl
```

- **Why:** one-off answers and the spend ledger are per-machine.
- **Stays committed:** each saved spec's `.system1/fixtures/<spec>/` directory is its offline test data.
- **Warn them:** a fixture contains the exact text that was sent to the provider. Committing one shares that text with everyone who has the repo, so it deserves the same look as any test fixture.
- Edit `.gitignore` only after a yes.

## 4. Confirm

Always finish with these two commands, even if you changed nothing and problems remain for the user to fix:

```sh
decide doctor --format brief
decide ping --format brief
```

Report both first lines as printed. Say whether the repo is now `live ready` or `replay only`, and name anything the user still has to do themselves.

## Rules

- Run each `decide` command on its own. Don't chain it with other commands, since a sandbox rule may cover only commands that start with `decide`.
- Make one change per yes. Don't bundle several changes into one question.
- If a command fails, report its one-line error and move on to the next problem. Don't try workarounds.
- Don't spend money here: `doctor` and `ping` make no decision calls.
