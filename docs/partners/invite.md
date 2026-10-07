# Design partner invite

The text the maintainer sends to a possible design partner (M12). Copy everything under the line,
fill in the brackets, and send it as is. Every figure in it is measured, and each one says where
it comes from; if a release changes a figure, change it here first.

---

**Subject: an hour with System 1, on your own code?**

Hi [name],

I'm looking for 3–5 people to try **System 1** on their own code before it goes any wider, and
I'd like you to be one of them.

**What it is.** System 1 is a command-line tool, `decide`, plus a plugin for Claude Code, Codex
and Pi. It lets your coding agent hand a *closed* judgement (yes or no, pick one, rate this) to a
small decision model instead of reading everything itself: which of these 200 files breaks a
rule, which CI failures are flaky, is this command destructive, is "done" actually done. Each
answer is a probability, back in about 300 ms. On yes/no questions that the text settles, those
probabilities are measured to be close to right; elsewhere they are best read as a ranking. The
README says exactly where it stands: <https://github.com/garygentry/system1#readme>.

**What I'm asking for.**

- **About 90 minutes:** an hour using it, then 15–20 minutes of questions.
- **One of your own git repos,** one you're happy to point a tool at, and the agent you already
  use: Claude Code, Codex or Pi. A Mac is especially welcome; nobody has tried the agents with it
  on macOS yet.
- **Node 22 or newer,** and an **[OpenRouter](https://openrouter.ai) API key with a little
  credit.** You pay for your own calls. They are small: a check over 5 small files cost about
  $0.00008, and over 57 files $0.0035 (measured, in our own release checks). The whole hour should
  come to well under $0.10 (projected). `decide` stops any single run projected above $0.05 or 200
  calls until you confirm it, and you can put a credit limit on the key itself.
- **Doing it from the docs alone.** You get the README link and a short task sheet. I'll watch,
  on a screen share or from a recording you make, and I won't help. That isn't me being difficult:
  every point where you'd have asked me is the thing I most need to find and fix. If you're truly
  stuck, say so out loud and move on to the next task.

**What leaves your machine, and when.** Nothing, until you say so in that repo.

- **Live decisions need your consent, per repo.** You grant it yourself by running a command; an
  agent that tries is refused. Until then, `decide` only replays answers it recorded earlier.
- **Once you consent, it sends only the items being judged,** with the question: a file's text, a
  diff hunk, some log lines, a row. When several items are joined into one, each part is headed by
  its path. The model doesn't see your conversation with the agent, or anything you didn't point
  it at. (One opt-in stop-hook setting, off by default, also sends the agent's last message.)
- **Always, consent or not:** files that look like secrets (`.env*`, keys, credentials,
  `secrets/`) are never read; secret-shaped strings are scrubbed from what is sent, and the output
  says how many; content outside the repo is withheld; an item too large is refused, never cut
  short.
- **Where it goes:** to OpenRouter, with your key, and on to the model's provider (the model is
  Jev, `typesafe/jev-1.13`), under their terms, as for any model call you make through OpenRouter.
- **Nothing comes to me.** `decide` keeps a spend ledger in the repo (`.system1/usage.jsonl`):
  counts, tokens and cost, no content. At the end I'll ask you to read me its one-line summary.
- **Hooks stay quiet.** In Claude Code, a prompt hook may suggest the tool to the agent; it's local
  pattern matching and sends nothing. The plugin's stop hook does nothing unless you turn it on in
  a repo.

**What I keep.** My notes, under a pseudonym (P1, P2, …): what you tried, where you stalled, error
messages as printed, versions, and the cost. No code or file names from your repo unless you say
it's fine. You can stop at any point. Afterwards, `decide config egress deny` in the repo withdraws
the consent, and removing the npm package and the plugin removes the rest.

If you're up for it, reply with your harness and OS, and a time that suits you.

Thanks,
[maintainer]
