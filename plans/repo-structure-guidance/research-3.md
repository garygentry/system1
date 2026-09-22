## Where things stand (September 2026)

**Skills are the stable layer.** The Agent Skills format (a folder containing a `SKILL.md` with at least `name` and `description`) was originally developed by Anthropic, released as an open standard, and has been adopted by a growing number of agent products. The same file works everywhere, but behavior doesn't always match. A Claude Code field such as dynamic command injection or an invocation-control key is not automatically valid in Codex, and Codex plugin metadata is not automatically valid in another host.

**Skill directories are almost unified, except for Claude Code.** Codex searches `.agents/skills` from the current directory up through the repo root and `$HOME/.agents/skills`. Cursor reads `.agents/skills/` and `.cursor/skills/`, plus compatibility reads for Claude/Codex skill locations. Claude Code shipped AGENTS.md support last week: in a project with no CLAUDE.md, Claude Code reads AGENTS.md instead — but this does not include .agents/skills. For loose (non-plugin) skills, Claude Code still needs `.claude/skills`.

**Plugins are the real distribution unit, and there is a new neutral format.** Agent Plugins Specification 1.0.0 is the current published release; 1.1.0 is a working draft. AWS is a founding member of its Technical Steering Committee along with Cursor, Microsoft, OpenAI, and Vercel. Anthropic is not on that list. Copilot already supports the format: skills are discovered from `skills/` and MCP config from `mcp.json` at the plugin root; other components (agents, hooks, commands, LSP) are client-specific, and Copilot reads them from the `com.github.copilot` directory, which other clients ignore.

Each vendor still has its own native plugin format:
- **Codex:** each plugin lives under `plugins/<name>/` with a required `.codex-plugin/plugin.json`, and the marketplace lives at `.agents/plugins/marketplace.json`. OpenAI recommends plugins, not copied community registries, as the distribution layer for reusable skills.
- **Cursor:** each plugin has a `.cursor-plugin/plugin.json` alongside `skills/`, `rules/`, and `mcp.json`, with a root `.cursor-plugin/marketplace.json`.
- **Copilot CLI:** it helps you here, because it also looks for marketplace.json in the `.claude-plugin/` directory.
- **Tooling gaps:** Agent Plugins alone doesn't reach Claude Code yet, and tooling support is uneven. In Microsoft's APM, for example, a package that selects the Agent Plugins layout reaches Copilot only; its skills are never deployed to claude, cursor, codex, gemini, opencode or windsurf.

**Subagents are fully divergent:**
- Claude uses Markdown with frontmatter.
- Copilot uses `*.agent.md` files.
- Codex uses TOML: `name`, `description`, `model`, `model_reasoning_effort`, `sandbox_mode`, `developer_instructions`. Codex does not auto-spawn custom subagents, so you have to delegate to them explicitly.
- Cursor uses `.cursor/agents/` with compatibility for `.claude/agents/` and `.codex/agents/`.

**Pi uses npm/git packages.** Pi packages bundle extensions, skills, prompt templates and themes; `package.json.pi` supplies root-relative resource paths, and you install with `pi install git:…` or `npm:…`. Agent Plugins support in Pi comes only through a community extension, which describes itself as a community-maintained client implementation, not an official release.

## Recommended structure

The key point is that every harness finds skills in `skills/` at the plugin root. That lets each plugin have one authored skills tree plus one small manifest per harness. Several production repos already use this pattern, supporting the open Agent Plugins 1.0 format while retaining native manifests for Codex and Claude Code.

```
agent-toolkit/
├── AGENTS.md                         # contributor guidance for this repo (Claude now falls back to it)
├── catalog.yaml                      # SOURCE OF TRUTH: plugins, versions, descriptions, categories
├── src/agents/<name>.md              # canonical subagent definitions (superset frontmatter)
├── plugins/
│   └── <plugin>/
│       ├── skills/<skill>/           # AUTHORED — shared verbatim by every harness
│       │   ├── SKILL.md
│       │   ├── scripts/ references/ assets/
│       │   └── agents/openai.yaml    # optional Codex-only sidecar
│       ├── mcp.json                  # AUTHORED — portable MCP config
│       ├── plugin.json               # generated: Agent Plugins 1.0 (Copilot, Kiro, VS Code…)
│       ├── .claude-plugin/plugin.json    # generated
│       ├── .codex-plugin/plugin.json     # generated
│       ├── .cursor-plugin/plugin.json    # generated
│       ├── .mcp.json                 # generated from mcp.json (Claude/Codex)
│       ├── claude/agents/*.md        # generated from src/agents (Cursor can share)
│       ├── com.github.copilot/agents/*.agent.md   # generated
│       └── codex/agents/*.toml       # generated
├── .claude-plugin/marketplace.json   # generated (Claude Code + Copilot CLI)
├── .agents/plugins/marketplace.json  # generated (Codex — different schema)
├── .cursor-plugin/marketplace.json   # generated
├── package.json                      # generated: "pi": { "skills": ["./plugins/*/skills"], "prompts": [...] }
└── tools/  build · validate · smoke-test
```

The marketplace files can't be a single symlinked file because the schemas differ. Codex entries need extra fields, for example a source object, `policy.installation`/`policy.authentication`, and `category`, which the other harnesses ignore.

## Practices that keep it native without watering it down

**1. Keep SKILL.md strictly spec-compliant.** The directory name must match the `name` field. Claude-specific frontmatter is acceptable because other hosts ignore it (`disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `context`). Put Codex-specific policy in a sidecar instead of the frontmatter, because `agents/openai.yaml` may declare invocation policy and MCP dependencies.

**2. Keep skill bodies harness-neutral.** Describe intent ("read the file", "run the tests") rather than naming a harness's tools. Reference scripts by relative path, and write them in Python, Node, or POSIX shell. When a harness truly needs different behavior, write a separate harness-only skill. Place it outside `skills/` and add it only through manifests that accept custom paths (Claude, Codex, Cursor). Don't add conditional branches inside the shared skill.

**3. Give each skill exactly one plugin.** Installers copy only the plugin directory. As one guide notes, there is no symlink, no shared pool, no cross-plugin import; if two plugins need the same skill, the skill file is duplicated. Draw plugin boundaries by domain so this rarely happens. Don't rely on plugin dependencies: `dependencies` is understood only by Claude Code; the Agent Plugins manifest is closed and doesn't admit the field. Keep plugin names short, because they prefix the skill names (`/plugin:skill`).

**4. Commit the generated files and check for drift in CI.** Installers read straight from git, so nothing can be built at install time. A small generator (a few hundred lines) reads `catalog.yaml` and emits all manifests, marketplaces, `.mcp.json`, per-harness subagent files, and the Pi `package.json`. CI then:
- runs the generator and fails if `git diff` shows changes;
- validates every SKILL.md against the spec;
- runs `claude plugin validate .`;
- validates `plugin.json` against the Agent Plugins schema;
- keeps versions in lockstep across all manifests.

Keeping versions in sync is a known pain point: when touching a plugin's version, bump it in all four manifests. For smoke tests, use headless checks per harness, for example `codex exec` asking whether a named skill is in the skill list.

**5. Write your own small generator for now.** Tools like APM, agent-bundle, and agent-connector are converging on this problem, but they're young and each one covers a different subset of targets. Your own generator keeps you in control, and you can swap it out later.

**6. Put hooks, commands, and rules under per-harness namespaces.** No shared format exists for these yet. The Agent Plugins committee is already considering how hooks, sub-agents, and other extension types might join in future versions. Because everything besides skills is generated, adopting 1.1 later means changing the generator, not rewriting your content.

## Installation paths to document

| Harness | Native install |
|---|---|
| Claude Code | `/plugin marketplace add org/repo` → `/plugin install x@repo` |
| Codex | `codex plugin marketplace add org/repo` |
| Copilot CLI | `copilot plugin marketplace add org/repo` (reads `.claude-plugin/`); for cloud agent, add to `enabledPlugins` in `.github/copilot/settings.json` |
| Cursor | Team marketplace import of the repo (`.cursor-plugin/marketplace.json`) |
| Pi | `pi install git:github.com/org/repo` |
| Anything else | `npx skills add org/repo` (falls back to finding SKILL.md files) |

One caveat on the `skills` CLI fallback: with `-g`, it has been known to write to `~/.agents/skills/` for Codex and Antigravity, which neither agent reads. Recommend project-scoped installs, or verify the install location.

## What to watch

- Claude Code adding `.agents/skills` or Agent Plugins support. Either would let you drop generated files.
- Agent Plugins 1.1 adding subagents or hooks.
- Codex self-serve publishing to its plugin directory.
- Copilot moving from its legacy plugin format to Agent Plugins 1.0.

A quarterly review of these against the generator is probably enough. The weekly-changing parts all live in generated manifests, while your authored content (SKILL.md files, scripts, references, MCP config) stays on the most stable standard available.

I can scaffold this repo if that's useful: the catalog schema, the generator, the CI workflow, and one example plugin wired up for all six harnesses.