# Session P? — observation sheet

Copy this file to `plans/m12/sessions/P<n>.md` for each session and fill it in as you watch.
Use the pseudonym only: no partner name, repo name, file names or code unless the partner said
that's fine. Errors are copied **verbatim**; if one names a private path, replace only that part
with `<path>`.

The rule for the session is [D3](../milestones/M12-design-partners.md#decisions-2026-10-07): docs
only, and you don't help. When the partner would have asked you something, write it down as a
stall, and don't answer it. If they say they're stuck and move on, that's a stall too.

## Before the session

- [ ] `sh tools/partners/fresh-check.sh` passed on the release they'll install today. Paste its
      last block:

  ```text
  ```

- [ ] The invite went out with the current figures ([invite](../../docs/partners/invite.md)), and
      they have the [task sheet](../../docs/partners/first-hour.md).
- [ ] They agreed to being watched or recorded, and to the notes below.

## Who and what

| | |
|---|---|
| Pseudonym | P? |
| Date | YYYY-MM-DD |
| Harness and version | (`claude --version`, `codex --version`, `pi --version`) |
| Model in the harness | |
| OS and version | |
| Node and npm | (`node --version`, `npm --version`) |
| `decide version` | |
| Plugin version, if shown | |
| Repo (kind, not name) | e.g. "TypeScript monorepo, ~400 files" |
| Key | had one already / made one during the session / none |
| Watched how | screen share / their recording |

## Timeline

One line per step, with the clock time. Mark the moments that matter for the gate:

| Time | What happened |
|---|---|
| hh:mm | started, on the README |
| hh:mm | CLI installed |
| hh:mm | plugin installed |
| hh:mm | setup skill run (or skipped) |
| hh:mm | key in place |
| hh:mm | consent granted (how: terminal / `!` prompt / not granted) |
| hh:mm | **first live decision** (task?) |
| hh:mm | **first useful decision** (task?, see below) |
| hh:mm | stopped |

## Stalls

A stall is any point where they would have asked you, stopped to search outside the docs, or
gave up on a step. One block per stall. Each becomes a row in the
[findings log](findings.md).

### S1

- **When / where:** hh:mm · task ? · which doc or command they were on
- **What they were trying to do:**
- **What they tried:** (each attempt, in order)
- **What they would have asked:** (their words if they said it)
- **What got them past it:** found it in the docs / guessed / an error message / gave up
- **Minutes lost:**

## Errors, verbatim

Every error or surprising output they saw, from `decide` or the harness, exactly as printed.

```text
```

## `decide doctor`

Ask for `decide doctor --format brief` in their repo at the end (and at the first stall involving
setup, if it helps you understand it without helping them). Paste it.

```text
```

## Cost

At the end, in their repo: `decide usage --format brief`, and in the harness session,
`decide usage --session current --format brief`. The ledger holds counts, tokens and cost, no
content. Paste the lines; these are the measured figures.

```text
```

## The tasks

| Task | Tried? | Live decision? | Useful? (their words) | Spot-check: agreed with |
|---|---|---|---|---|
| 1 Get it working | | | | — |
| 2 A batch | | | | of 3 kept, of 3 dropped |
| 3 One out of many | | | | |
| 4 Is it done? / Where would it pay off? | | | | |

**Useful decision, for the gate:** a live decision on their own repo that they say they'd act on,
reached without help. Record yes or no, and which task.

## Debrief (15 minutes)

Ask these in order, and write down the answers in their words.

1. What did you expect System 1 to do before you started? Did it do that?
2. Where did you lose the most time?
3. Was there a point where you'd have given up if this weren't a test?
4. Of the answers you got, which would you act on? Which didn't you trust, and why?
5. Was it clear what would leave your machine before you agreed to it? What, if anything, made
   you hesitate?
6. Was the cost what you expected?
7. What did you think `undecided` meant when you saw it (if you did)?
8. Would you use it again next week, without us asking? For what?
9. What's the one thing you'd change first?
10. Anything you were surprised by, good or bad?

## Your notes

Anything else: what the agent did on its own, where it chose not to use `decide`, whether the
routing hint fired, hook trust prompts, things that worked better than expected.
