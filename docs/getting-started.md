# Getting started

From nothing to a first live decision in your own repo. It takes four steps, and two of them are
yours alone: the API key and the consent.

## 1. Install

You need Node 22 or newer.

| Harness | Plugin | `decide` on PATH | Network |
|---|---|---|---|
| **Claude Code** | `/plugin marketplace add garygentry/system1`, then `/plugin install system1@system1` | automatic: the plugin's `bin/` is on the Bash PATH | allow `openrouter.ai` if the sandbox is on |
| **Codex** | `codex plugin marketplace add garygentry/system1`, then `codex plugin add system1@system1` | `npm i -g @garygentry/system1` (Codex does not put plugin `bin/` on PATH) | add `prefix_rule(pattern = ["decide"], decision = "allow")` to `$CODEX_HOME/rules/system1.rules`, then restart Codex |
| **Pi** | `pi install npm:@garygentry/system1-pi` | `npm i -g @garygentry/system1` | no sandbox |

Scripts, hooks and CI only need the CLI: `npm i -g @garygentry/system1`.

In Claude Code the plugin also installs one prompt hook. When a prompt asks for a closed
judgement (a batch to triage, a checklist to tick off, "is this done?"), it adds a hint to use the
`ask` skill. It is local pattern matching and sends nothing. See
[routing hints](concepts.md#routing-hints) to tune it or switch it off.

## 2. Run setup

In the agent, run the **setup** skill:

- Claude Code: `/system1:setup`
- Codex: `$system1:setup`
- Pi: `/skill:setup`

It runs `decide doctor`, then walks you through each problem one at a time and asks before it
changes anything. You can run the same check yourself:

```sh
decide doctor --format brief
```

```
decide doctor: SETUP NEEDED (key, consent) · replay only · harness claude · session claude:…
  ok   cli: decide 0.1.0 on node v22.23.2 (…)
  warn key: no API key: only replay works
       fix: set OPENROUTER_API_KEY, or write `openrouter_api_key: <key>` to ~/.config/system1/credentials (chmod 600)
  warn consent: no egress consent for /path/to/repo: live calls are refused
       fix: the user runs `decide config egress allow` in this repo, if they agree
  ok   network: typesafe/jev-1.13 reachable in 175 ms
```

The first line says what's missing. `healthy · live ready` means you're done.
[troubleshooting.md](troubleshooting.md) covers every check.

## 3. The key

Live decisions need an [OpenRouter](https://openrouter.ai) API key. Put it in one of two places:

- the `OPENROUTER_API_KEY` environment variable;
- or `~/.config/system1/credentials` (under `$XDG_CONFIG_HOME` if you set it), a YAML file with
  one line, readable only by you:

  ```sh
  mkdir -p ~/.config/system1
  printf 'openrouter_api_key: %s\n' 'sk-or-…' > ~/.config/system1/credentials
  chmod 600 ~/.config/system1/credentials
  ```

`decide` refuses a credentials file that others can read. **Don't paste the key into the
conversation.** The skills never ask for it, and `decide` never prints it. It reports only whether
a key is present.

`decide` never reads your project's `.env`, since that belongs to your project.

Without a key, `decide` still replays answers recorded earlier (see
[concepts.md](concepts.md#live-and-replay)). That's a supported mode, but a new question has
nothing to replay.

## 4. Consent, per repo

Before anything leaves your machine, the repo has to agree to it. When `decide` runs live, it
sends the text being judged (file contents, diff hunks, log lines) to the decision model through
OpenRouter. With or without consent, these always apply:

- files that look like secrets (`.env*`, keys, credentials, `secrets/`) are never sent;
- secret-shaped strings are scrubbed from everything that is sent;
- content that resolves outside the repo is withheld unless you pass `--allow-outside`;
- an item too large for the model is refused, never truncated.

If you agree, run this **yourself** at the repo root:

```sh
decide config egress allow
```

It asks you to confirm, so it needs a real terminal. In Claude Code, type
`! decide config egress allow` at the prompt: the `!` runs it in the session as you. The skills
tell agents never to grant consent. If an agent runs the command without a terminal, `decide`
refuses and tells it to ask you.

Consent is recorded in `.system1/config.yaml`. If you commit that file, everyone who clones the
repo inherits the consent. That's a team decision, so make it on purpose.

## 5. A first decision

Ask the agent something closed about your code, in your own words:

> Which files under `src/` make a network call without a timeout?

The `ask` skill picks this up and runs something like the command below. This is a real run
over this repo's own source, on 2026-09-22:

```sh
decide many --glob 'packages/core/src/**/*.ts' \
  --question 'no_timeout:noul:The code makes a network request with no timeout or abort signal.' \
  --keep 'no_timeout>=0.5' --format brief
```

```
decide many: 3 kept of 57 · 2 undecided · 52 dropped · live typesafe/jev-1.13 · $0.003521 measured · 2.6 s
kept:
  packages/core/src/decide.live.test.ts  no_timeout=0.75
  packages/core/src/ping.test.ts  no_timeout=0.71
  packages/core/src/tools/doctor.ts  no_timeout=0.66
undecided (too flat to judge; read these yourself):
  packages/core/src/decide.test.ts  no_timeout=0.43 UNDECIDED
  packages/core/src/tools/doctor.test.ts  no_timeout=0.53 UNDECIDED
redacted: 17 secret(s) in 5 item(s) before sending
```

How to read the first line:

- **`3 kept of 57`**: three items cleared the `--keep` threshold.
- **`2 undecided`**: the model couldn't call it either way (a `noul` near 0.5). Undecided items
  are listed apart and never counted as kept or dropped, so read those yourself.
- **`52 dropped`**: below the threshold.
- **`live`** or **`replay`**: whether the answers came from the model just now, or from a
  recording. A replay miss is an error, never an invented answer.
- **`$0.003521 measured`**: what the provider reported spending. A projection before a run is
  labelled `projected`.
- **`redacted: …`**: the scrubber reporting what it removed before anything was sent.

## Next

- [cookbook.md](cookbook.md): ready-made, tested specs to copy into your repo.
- [concepts.md](concepts.md): question types, thresholds, live and replay, sources, and what
  gets sent.
- The `design` skill: ask your agent to save a question that proved useful as a spec, with
  examples that test it.
- [calibration.md](calibration.md): what the probabilities mean, and which threshold to use.
