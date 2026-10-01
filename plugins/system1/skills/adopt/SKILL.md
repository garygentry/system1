---
name: adopt
description: Replace a closed judgement in this codebase (a chat-model call parsed to an enum or yes/no, or a keyword rule) with a decision-model policy module, wired in behind the existing mechanism and inert until the user switches it on. Use only when the user explicitly asks to adopt a scouted opportunity.
disable-model-invocation: true
---

# adopt

**Not usable yet.** This version ships only the code templates `adopt` will copy, under `references/templates/` (`ts/` and `python/`). The workflow that drafts the spec, captures, generates the module and wires it in comes with the next release.

If the user invoked this skill, tell them that, point them at `references/templates/README.md`, and stop. Change no files.
