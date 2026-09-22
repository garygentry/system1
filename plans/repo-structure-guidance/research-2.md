As of **September 21, 2026**, the ecosystem has converged enough that I would **not** build this as five independent integrations, but it has **not** converged enough to force everything through one universal schema.

The strongest architecture is:

> **Standards-first portable core + generated native adapters + intentionally platform-specific extensions.**

That gives you one source of truth where genuine standards exist, while still letting Claude Code feel like Claude Code, Pi feel like Pi, Cursor use its richer plugin model, etc.

The biggest recent development supporting this approach is **Agent Plugins 1.0**, published in 2026. It standardizes a portable plugin root with `plugin.json`, Agent Skills under `skills/`, and optional MCP configuration. It explicitly provides extension namespaces for client-specific functionality rather than attempting to standardize everything. ([Agent Plugins][1])

## The ecosystem has effectively settled into four layers

There are now two genuinely useful cross-platform standards:

**Agent Skills / `SKILL.md`** has become the strongest interoperability layer. The standard defines a skill as a directory containing `SKILL.md`, with optional `scripts/`, `references/`, and `assets/`. It is intentionally progressive-disclosure: name and description are cheap discovery metadata, full instructions load only when the skill activates, and supporting material loads as needed. ([GitHub][2])

**`AGENTS.md`** has become the closest thing to a universal repository instruction file. It is deliberately just Markdown rather than a complex manifest, supports nested project instructions, and is now stewarded by the Agentic AI Foundation under the Linux Foundation. ([Agents][3])

The convergence stops after that. **Subagents, hooks, rules, commands, permission systems, UI features, and executable extensions are still meaningfully harness-specific.** Agent Plugins 1.0 acknowledges that directly: its portable core is skills + MCP, while clients can add namespaced extensions. ([Agent Plugins][1])

That distinction should drive your repository architecture.

### Current platform landscape

| Harness            | Always-on instructions                         | Portable skills                          | Specialized agents                                | Best native distribution      |
| ------------------ | ---------------------------------------------- | ---------------------------------------- | ------------------------------------------------- | ----------------------------- |
| **Claude Code**    | `CLAUDE.md`, `.claude/rules/`                  | `.claude/skills/*/SKILL.md`              | `.claude/agents/*.md`                             | Claude plugin                 |
| **Codex**          | `AGENTS.md`                                    | Agent Skills / `.agents/skills/`         | Codex agent configuration                         | Plugin / Agent Plugin         |
| **GitHub Copilot** | `AGENTS.md`, `.github/copilot-instructions.md` | `.agents/skills`, `.github/skills`, etc. | `.github/agents/*.md`                             | Agent Plugins 1.0             |
| **Cursor**         | `AGENTS.md`, Cursor rules                      | `.agents/skills` / `.cursor/skills`      | `.cursor/agents/*.md`                             | Agent Plugin or Cursor Plugin |
| **Pi**             | `AGENTS.md`                                    | `.agents/skills` / `.pi/skills`          | Generally implemented through extensions/packages | Pi package via npm/git        |

Claude explicitly distinguishes always-loaded `CLAUDE.md`, on-demand Skills, isolated subagents, hooks, and plugins as different mechanisms, and recommends plugins once configuration is reused across multiple repositories. ([Claude][4]) Codex likewise describes customization as cooperating layers of `AGENTS.md`, skills, MCP, memory, and subagents. ([OpenAI Developers][5])

GitHub now supports Agent Plugins 1.0 directly and uses `com.github.copilot/` for Copilot-specific agents, commands, rules, hooks, and LSP configuration inside an otherwise portable plugin. That is almost exactly the architecture I would emulate. ([GitHub Docs][6]) Cursor has made the same architectural distinction: Agent Plugins provide portable Skills/MCP, while the Cursor Plugin format adds rules, agents, commands, hooks, and variables. ([Cursor][7])

Pi is slightly different philosophically. It implements the Agent Skills standard, but deliberately keeps its core small and expects richer functionality such as subagent orchestration to come from TypeScript extensions and Pi packages. ([Pi][8])

---

# Recommended repository architecture

I would make this a **monorepo of capability packages**, not a repository divided first by harness.

Something close to this:

```text
agent-toolkit/
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
│
├── packages/
│   ├── engineering-core/
│   │   ├── plugin.json
│   │   │
│   │   ├── skills/
│   │   │   ├── plan-change/
│   │   │   │   ├── SKILL.md
│   │   │   │   ├── references/
│   │   │   │   └── scripts/
│   │   │   ├── review-code/
│   │   │   │   └── SKILL.md
│   │   │   └── investigate-bug/
│   │   │       └── SKILL.md
│   │   │
│   │   ├── mcp.json
│   │   │
│   │   ├── src/
│   │   │   ├── agents/
│   │   │   │   ├── reviewer/
│   │   │   │   │   ├── prompt.md
│   │   │   │   │   └── agent.yaml
│   │   │   │   └── investigator/
│   │   │   │       ├── prompt.md
│   │   │   │       └── agent.yaml
│   │   │   │
│   │   │   ├── instructions/
│   │   │   └── hooks/
│   │   │
│   │   ├── com.github.copilot/
│   │   │   └── ...
│   │   │
│   │   └── platform/
│   │       ├── claude/
│   │       ├── codex/
│   │       ├── cursor/
│   │       └── pi/
│   │
│   ├── infrastructure/
│   │   ├── plugin.json
│   │   ├── skills/
│   │   └── ...
│   │
│   └── research/
│       ├── plugin.json
│       ├── skills/
│       └── ...
│
├── scripts/
│   ├── build.ts
│   ├── validate.ts
│   ├── install.ts
│   └── smoke-test.ts
│
├── schemas/
│   └── agent.schema.json
│
├── evals/
│   ├── skills/
│   └── agents/
│
└── dist/
    ├── claude/
    ├── codex/
    ├── cursor/
    ├── copilot/
    └── pi/
```

There is an important distinction in this tree:

**`skills/` is not an abstraction. It is the real artifact.**

**`src/agents/` is an abstraction. It exists because there is not yet a satisfactory universal custom-agent format.**

That distinction will save you considerable maintenance trouble.

---

# 1. Make Agent Skills the canonical format whenever something can reasonably be a Skill

This is probably the most consequential design decision.

Do **not** write:

```text
claude/skills/review.md
codex/skills/review.md
cursor/skills/review.mdc
copilot/skills/review.md
pi/skills/review.md
```

Write:

```text
skills/
└── review-code/
    ├── SKILL.md
    ├── references/
    ├── scripts/
    └── assets/
```

and use that same directory everywhere.

The standard requires only `name` and `description`; supporting scripts and references are portable concepts as well. ([GitHub][2])

This works particularly well now because adoption has gone well beyond Claude. Cursor explicitly implements Agent Skills and loads `.agents/skills/`; GitHub Copilot accepts `.github/skills`, `.claude/skills`, and `.agents/skills`; Pi implements the standard; OpenAI has incorporated skills into its plugin model. ([Cursor][9])

### Keep canonical `SKILL.md` clean

I would be fairly strict here.

The canonical skill should contain only fields that are part of the Agent Skills standard or that you have explicitly decided are harmless across clients.

Avoid doing this:

```yaml
---
name: review-code
description: Review an implementation for correctness and maintainability.
model: opus
cursor-model: composer
codex-reasoning: high
copilot-tools:
  - ...
pi-extension: ...
---
```

That turns a portable format into your own proprietary format.

Instead:

```yaml
---
name: review-code
description: >
  Review completed implementation work for correctness, regressions,
  maintainability, and adherence to repository conventions.
---
```

Platform behavior belongs somewhere else.

This also protects you against a subtle problem: the **description is effectively routing logic**. Cursor explicitly says its agent uses the description to decide when to load the skill; Pi exposes skill descriptions during discovery; the Agent Skills specification describes the same progressive-disclosure model. ([Cursor][9])

So descriptions should be treated almost like API contracts and tested accordingly.

---

# 2. Make each logical bundle an Agent Plugin 1.0 package

This is the development I would take advantage of most aggressively.

Rather than having one giant root plugin:

```text
everything/
    190 skills
    27 agents
    12 MCP servers
```

create coherent capability packs:

```text
packages/
    engineering-core/
    frontend/
    infrastructure/
    database/
    research/
    release-management/
```

Each can be a valid Agent Plugin:

```text
engineering-core/
├── plugin.json
├── skills/
│   ├── review-code/
│   │   └── SKILL.md
│   └── investigate-bug/
│       └── SKILL.md
└── mcp.json
```

For example:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "engineering-core",
  "version": "1.3.0",
  "description": "Core software-engineering workflows"
}
```

That package is inherently portable to clients implementing Agent Plugins 1.0. ([Agent Plugins][1])

This is preferable to inventing an installer as your foundational abstraction. Your installer should be a **convenience layer over standards**, not the thing holding the architecture together.

---

# 3. Do not attempt to create a universal custom-agent file format for consumers

This is where I would deliberately **not** chase maximum portability.

Claude:

```text
.claude/agents/reviewer.md
```

Cursor:

```text
.cursor/agents/reviewer.md
```

Copilot:

```text
.github/agents/reviewer.md
```

Codex has its own agent configuration semantics.

Pi doesn't really have the same built-in abstraction at all; its philosophy is that capabilities such as subagent orchestration belong in extensions/packages. Pi's own documentation explicitly describes subagents as functionality that can be built with extensions rather than a built-in primitive. ([Pi][10])

Trying to declare that these are “the same thing” will produce the dilution you're worried about.

Instead, maintain an **internal authoring model**.

For example:

```text
src/agents/reviewer/
├── prompt.md
└── agent.yaml
```

`agent.yaml` might look something like:

```yaml
id: reviewer

description: >
  Independently review completed implementation work for defects,
  regressions, unnecessary complexity, and missing tests.

capabilities:
  - read
  - search
  - shell

skills:
  - review-code

targets:
  claude:
    enabled: true
    model: inherit

  codex:
    enabled: true
    reasoning_effort: high

  cursor:
    enabled: true
    model: inherit

  copilot:
    enabled: true

  pi:
    enabled: true
    implementation: extension
```

Then:

```text
pnpm build
```

renders whatever each harness actually wants.

The key is that **`agent.yaml` belongs to your build system, not to the agents**.

That gives you one canonical semantic definition while preserving platform-native output.

---

# 4. Treat target-specific configuration as a feature, not as technical debt

This is another place I would resist “DRY at all costs.”

Suppose Claude supports an especially useful tool permission model that Codex does not, or Cursor gains a new isolated-agent option, or Pi lets you write a TUI around an orchestration workflow.

Use it.

Your abstraction should support:

```yaml
targets:
  claude:
    tools:
      - Read
      - Grep
      - Bash

  cursor:
    model: inherit

  pi:
    extension: ./extensions/reviewer.ts
```

rather than forcing:

```yaml
tools:
  - generic-read-ish-thing
  - generic-search-ish-thing
```

and then endlessly translating approximations.

The right objective isn't:

> Every capability produces identical behavior everywhere.

It is:

> Every capability has one conceptual source, while each harness receives the strongest idiomatic implementation it supports.

That is a much healthier compatibility contract.

---

# 5. Use platform namespaces/directories as “native islands”

Agent Plugins 1.0 effectively blesses this pattern.

GitHub's implementation is an especially good example:

```text
plugin/
├── plugin.json
├── skills/
├── mcp.json
└── com.github.copilot/
    ├── agents/
    ├── commands/
    ├── rules/
    ├── hooks/
    └── lsp.json
```

Copilot consumes its directory; other conforming clients simply ignore it. ([GitHub Docs][6])

I would conceptually apply that pattern across your repository even where the exact namespace isn't standardized.

Thus:

```text
engineering-core/
├── plugin.json
├── skills/
├── mcp.json
│
├── com.github.copilot/
│
└── platform/
    ├── claude/
    ├── codex/
    ├── cursor/
    └── pi/
```

Your generator can turn `platform/claude` into the Claude-native plugin structure and `platform/pi` into a Pi package.

That makes deviations obvious rather than hiding them.

---

# 6. `AGENTS.md` should be your canonical *repository-instruction* language

For repositories consuming your toolkit, I would standardize on:

```text
AGENTS.md
```

for general project guidance.

This now has enough ecosystem support to justify doing so. Codex has especially strong native semantics around hierarchical `AGENTS.md`; Cursor supports the format; GitHub Copilot recognizes nested agent instruction files; Pi supports it as well. ([OpenAI Developers][11])

Claude remains the important exception because its first-class mechanism is `CLAUDE.md`. ([Claude][4])

I would therefore keep the Claude file intentionally tiny. Conceptually:

```text
AGENTS.md       # canonical instructions
CLAUDE.md       # Claude bridge + only true Claude-specific instructions
```

Do **not** maintain two independent 300-line instruction manuals.

The same principle applies when your toolkit installs into another project: the portable instructions should originate from one source, and the Claude adapter should produce whatever bridge/native representation Claude requires.

---

# 7. Keep “always-on instructions” aggressively small

This has become a best practice across the products, not just prompt-engineering taste.

Claude now explicitly recommends keeping `CLAUDE.md` relatively small and moving occasional reference/workflow material into Skills. ([Claude][12])

Skills exist precisely because putting every procedure into every context becomes expensive and decreases relevance. The Agent Skills specification recommends progressive disclosure and keeping large supporting material outside the main `SKILL.md`. ([GitHub][2])

So a good rule for the repo is:

**Instruction:** behavior that should apply almost all the time.

**Skill:** knowledge/process that should become available when relevant.

**Agent:** work that benefits from independent context, delegation, specialization, or parallelism.

**Hook/extension:** deterministic runtime behavior the LLM should not have to remember to perform.

**MCP:** access to an external capability or system.

That separation is more important architecturally than which directory names you ultimately choose.

Cursor's documentation now makes almost exactly the same skill-vs-subagent distinction: use subagents for context isolation/parallel work, and skills for reusable single-purpose capability. ([Cursor][13])

---

# 8. Prefer Skills over old-style slash-command duplication

Another 2026 trend worth designing around is that “commands” are increasingly collapsing into skills.

Cursor's migration tooling explicitly converts suitable dynamic rules and slash commands into Agent Skills; manually invoked skills can be configured to behave like traditional commands. ([Cursor][9])

Claude similarly treats commands and skills as closely related mechanisms. ([Claude][4])

So rather than maintaining:

```text
commands/review.md
skills/review/SKILL.md
```

make `/review` invoke the review skill where supported.

Only retain a native prompt/command artifact where that platform gives it materially different semantics.

Pi is a good example where prompt templates remain their own useful native primitive, so a Pi adapter may legitimately produce one. Pi packages can bundle extensions, skills, prompt templates, and themes together. ([Pi][14])

---

# 9. Do not use symlinks as your primary distribution architecture

Symlinks are attractive:

```text
.claude/skills -> ../../agent-tools/skills
.cursor/skills -> ../../agent-tools/skills
.agents/skills -> ../../agent-tools/skills
```

They're useful during development.

I would **not** base team distribution around them.

They become awkward with Windows, cloud coding agents, remote execution, isolated worktrees, plugin caches, and packaging. Cursor specifically notes that machine-local skills aren't automatically available to its cloud agents unless synchronized or packaged appropriately. ([Cursor][9]) Agent Plugins also has containment rules preventing plugin paths from resolving outside the plugin root. ([Agent Plugins][1])

Use native package/plugin installation for normal consumption.

Use symlinks only as an optional local-development mode.

---

# 10. Commit generated adapters, but make them impossible to edit manually

This is one case where generated duplication is useful.

Your principle should be:

> **No authored duplication. Generated duplication is fine.**

For example:

```text
src/agents/reviewer/*
              │
              ├──> dist/claude/.../reviewer.md
              ├──> dist/codex/.../reviewer.toml
              ├──> dist/cursor/.../reviewer.md
              ├──> dist/copilot/.../reviewer.agent.md
              └──> dist/pi/.../reviewer.ts/config
```

Depending on how marketplaces/installers work, having installable artifacts in Git can make consumption dramatically simpler.

Put a header in generated files:

```text
# GENERATED FILE — DO NOT EDIT
# Source: src/agents/reviewer/
```

and enforce:

```bash
pnpm generate
git diff --exit-code dist/
```

in CI.

That gives users native artifacts without creating multiple sources of truth.

---

# 11. Make Pi a real adapter, not a second-class compatibility target

This matters given your Pi use case.

Pi's design is intentionally more programmable than the others. Its packages can bundle Skills, TypeScript extensions, prompt templates and themes and can be installed directly from npm or Git. ([Pi][14])

So don't make Pi consume some fake generated “agent prompt” and call the job done.

A Pi package might look like:

```text
dist/pi/engineering-core/
├── package.json
├── skills/
│   ├── review-code/
│   └── investigate-bug/
├── extensions/
│   └── agents/
│       └── index.ts
└── prompts/
```

with:

```json
{
  "name": "@your-org/engineering-core-pi",
  "keywords": ["pi-package"],
  "pi": {
    "skills": ["./skills"],
    "extensions": ["./extensions"],
    "prompts": ["./prompts"]
  }
}
```

Then:

```bash
pi install git:github.com/your-org/agent-toolkit@v1.4.0
```

or npm packaging can be genuinely native.

Pi packages execute with full host permissions, so treat extensions as code requiring review, signing/provenance, and version pinning rather than as harmless prompts. Pi's documentation specifically warns that extensions execute arbitrary code and Skills may instruct models to run executables. ([Pi][14])

---

# 12. Distribution should be native first, universal installer second

I would support installations roughly like this:

| Platform                 | Preferred install artifact                                               |
| ------------------------ | ------------------------------------------------------------------------ |
| Claude Code              | Claude-native plugin / marketplace package                               |
| Codex                    | Agent Plugin / Codex plugin                                              |
| Cursor                   | Agent Plugin where possible; Cursor Plugin when using agents/hooks/rules |
| GitHub Copilot           | Agent Plugin 1.0 with `com.github.copilot` extensions                    |
| Pi                       | Pi package via Git or npm                                                |
| Generic compatible agent | `skills/` / Agent Plugin directly                                        |

Then provide:

```bash
npx @your-org/agents install
```

only as convenience.

The installer can detect:

```text
claude
codex
cursor
copilot
pi
```

and install the appropriate native package.

But your actual assets should remain installable without that CLI.

GitHub's new `gh skill` functionality is another indication that Skill distribution itself is becoming standardized enough that your own installer shouldn't own that layer. It can install Skills for specific supported hosts and preserve provenance/version metadata. ([GitHub Docs][15])

---

# What I would avoid

The most dangerous design would be a root like:

```text
skills/
agents/
commands/
rules/
hooks/
```

and then declaring that every object in those directories is “universal.”

Only `skills/` currently deserves that assumption.

An `agent` in Claude, Cursor, Copilot, Codex, and Pi is **not yet sufficiently standardized** to make its native configuration incidental. Agent Plugins 1.0 itself is strong evidence of this: the standards group standardized the pieces with genuine interoperability—Skills and MCP—and deliberately left client extensions to clients. ([Agent Plugins][1])

Similarly, I would avoid organizing the source as:

```text
claude/
codex/
cursor/
copilot/
pi/
```

because that guarantees drift and makes cross-platform support the organizing principle of the repository rather than the capabilities themselves.

Your primary taxonomy should be **what the capability does**, not **which agent happens to run it**.

---

# A practical architecture rule

I would adopt this as the core maintainer rule:

> **Standardize artifacts where the ecosystem has standardized semantics. Generate adapters where semantics are equivalent but formats differ. Keep separate native implementations where semantics genuinely differ.**

That produces three categories:

| Category      | Examples                                                                          | Source strategy                                  |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Portable**  | Skills, much of MCP, general repo guidance                                        | Author once                                      |
| **Adaptable** | reviewer agent, planner agent, researcher agent                                   | Canonical definition + generated native adapters |
| **Native**    | Pi TUI extension, Claude hook behavior, Cursor-specific rules, Copilot LSP config | Platform-specific implementation                 |

This prevents both kinds of failure: five copies of everything **and** lowest-common-denominator abstractions.

---

# Testing is more important here than it appears

I would treat the repository like a real software product rather than a prompt collection.

The first implementation should build around these checks:

1. **Schema validation.** Validate every Skill against the Agent Skills specification and every `plugin.json` against Agent Plugins 1.0. The Agent Skills project provides a reference validator. ([GitHub][2])

2. **Reproducible generation.** Generate every native adapter in CI and fail if `git diff` shows uncommitted output.

3. **Install smoke tests.** Have containers or CI jobs install the release into supported versions of Claude Code, Codex, Cursor CLI where feasible, Copilot CLI, and Pi, and verify discovery.

4. **Routing evals.** For every Skill and agent, maintain positive prompts that should invoke it and negative prompts that should not. This matters because descriptions increasingly determine automatic routing.

5. **Capability tests.** Test semantic outcomes rather than exact prompts. “Reviewer can read/search but shouldn't modify files,” “researcher delegates without modifying code,” etc.

6. **Security/release controls.** Pin releases, review changes to executable scripts/extensions, maintain provenance, and publish semver tags rather than having users track `main`.

That eval layer is likely to become one of the highest-value parts of the repository as the underlying harnesses change.

---

# My recommended starting implementation

If I were establishing the repository now, I would build **v1 around four concepts only**:

```text
agent-toolkit/
├── packages/
│   ├── engineering-core/
│   │   ├── plugin.json        # Agent Plugins 1.0
│   │   ├── skills/            # real Agent Skills; canonical
│   │   ├── src/agents/        # canonical agent definitions
│   │   └── platform/          # genuine native additions
│   │
│   └── ...
│
├── scripts/                   # generators + validators
├── schemas/
├── evals/
└── dist/                      # generated native packages
```

Then I would get **Claude + Codex + Pi working extremely well first**, because those give you three useful architectural extremes: Claude's rich native customization model, Codex's strong embrace of `AGENTS.md`/Skills/plugins, and Pi's programmable extension/package model. Once those abstractions feel clean, Cursor and Copilot should be relatively straightforward because both now have good Agent Skills and plugin support.

The thing I **would not** do yet is build a huge “universal agent framework.” Keep the translation layer deliberately small. Every custom abstraction you create becomes something you have to maintain while Claude, OpenAI, Cursor, GitHub, and Pi are all changing their formats underneath you.

### Bottom line

The repository should **not** be a compatibility repository.

It should be a **capability repository with multiple distribution targets**.

Agent Skills should be first-class source artifacts. `AGENTS.md` should be the default shared instruction language. Agent Plugins 1.0 should be your portable packaging baseline. Custom agents should have a small canonical semantic definition from which native agent configurations are generated. Hooks, rules, extensions and advanced orchestration should remain native when that produces a materially better implementation.

That architecture gives you a very strong property:

```text
                 canonical capabilities
                         │
         ┌───────────────┼────────────────┐
         │               │                │
   open standards   adaptable source   native source
         │               │                │
   SKILL.md/MCP      agent.yaml +      Pi extension
   AGENTS.md         prompt.md          Claude hook
         │               │             Cursor rule
         └───────┬───────┘                │
                 │                        │
             build/package ───────────────┘
                 │
     ┌───────────┼───────────┬───────────┬───────────┐
     │           │           │           │           │
   Claude      Codex       Cursor      Copilot       Pi
   native      native      native      native       native
```

That is the architecture I think is most likely to remain sane as this ecosystem changes over the next year.

Because this area is moving extremely quickly—Agent Plugins 1.0 alone materially changes the answer from what I would have recommended earlier in 2026—I can also monitor the standards and these five harnesses and flag meaningful changes to this architecture as they land.

[1]: https://agent-plugins.org/specification?utm_source=chatgpt.com "Agent Plugins Specification | Agent Plugins"
[2]: https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx?utm_source=chatgpt.com "agentskills/docs/specification.mdx at main · agentskills/agentskills · GitHub"
[3]: https://agents.md/?_bhlid=112c503025748ad09688b8967efa0392a203a6cb&utm_source=chatgpt.com "AGENTS.md"
[4]: https://code.claude.com/docs/fr/claude-directory?utm_source=chatgpt.com "Explorez le répertoire .claude - Claude Code Docs"
[5]: https://developers.openai.com/es-419/docs/customization/overview?utm_source=chatgpt.com "Personalización | ChatGPT Learn"
[6]: https://docs.github.com/en/copilot/concepts/agents/about-plugins?utm_source=chatgpt.com "About GitHub Copilot plugins - GitHub Docs"
[7]: https://prod.cursor.com/docs/reference/plugins?utm_source=chatgpt.com "Plugins Reference | Cursor Docs"
[8]: https://pi.dev/docs/latest/skills?utm_source=chatgpt.com "Skills · Documentation · Pi"
[9]: https://prod.cursor.com/docs/skills?utm_source=chatgpt.com "Agent Skills | Cursor Docs"
[10]: https://pi.dev/?utm_source=chatgpt.com "Pi"
[11]: https://developers.openai.com/api/docs/guides/latest-model?gallery=open&galleryItem=trivia-quiz-game&model=gpt-5.3-codex&translationFallback=de-DE&utm_source=chatgpt.com "Model guidance | OpenAI API"
[12]: https://code.claude.com/docs/id/features-overview?utm_source=chatgpt.com "Perluas Claude Code - Claude Code Docs"
[13]: https://prod.cursor.com/docs/subagents?utm_source=chatgpt.com "Subagents | Cursor Docs"
[14]: https://pi.dev/docs/latest/packages?utm_source=chatgpt.com "Pi Packages · Documentation · Pi"
[15]: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills?utm_source=chatgpt.com "Adding agent skills for GitHub Copilot - GitHub Docs"
