The ecosystem for AI coding agents has rapidly converged to solve the exact fragmentation problem you are facing. Rather than maintaining duplicated logic across `.cursorrules`, `CLAUDE.md`, and `.github/copilot-instructions.md`, the industry standard in 2026 relies on two open, cross-platform specifications: **`AGENTS.md`** (for static context and rules) and the **Agent Skills Standard** (for executable workflows and dynamic tools).

By structuring your repository around these two standards, you can create a single source of truth that is natively ingested by Claude Code, Cursor, GitHub Copilot, Codex, and others, without diluting the capabilities of any specific harness.

Here is the recommended architecture and best practices for establishing your universal agent repository.

## 1. The Repository Architecture

Structure your centralized repository to separate executable capabilities (Skills) from static project guidelines (Rules).

```text
agent-capabilities-repo/
├── AGENTS.md                      # Instructions for agents operating on THIS repo
├── skills/                        # The universal Agent Skills library
│   ├── code-review/
│   │   ├── SKILL.md               # Required: YAML metadata + Markdown instructions
│   │   ├── scripts/               # Optional: Executable tools (Python, Bash, etc.)
│   │   └── references/            # Optional: Deep-dive docs loaded on demand
│   ├── db-migration/
│   │   └── SKILL.md
│   └── secure-refactor/
│       └── SKILL.md
├── rules/                         # Reusable context blocks for target projects
│   ├── base-engineering.md
│   ├── react-conventions.md
│   └── python-conventions.md
├── platform-pointers/             # Thin wrappers for specific harnesses
│   ├── CLAUDE.md
│   ├── copilot-instructions.md
│   └── cursor-rule-templates/     
└── install.sh                     # Setup script to link files into target repos

```

## 2. Implement the Agent Skills Standard

The **Agent Skills Standard** (agentskills.io) is a lightweight, folder-based specification adopted across major platforms to package domain-specific knowledge and workflows. Instead of bloating system prompts, skills use **progressive disclosure** to protect context windows.

Platforms like Cursor and Claude Code natively look for a `skills/` directory (e.g., `.cursor/skills/` or `.claude/skills/`).

### How to Structure a Skill

Every skill is an isolated folder containing a `SKILL.md` file.

* **YAML Frontmatter:** The file must begin with a metadata block containing a `name` (using a verb-noun pattern like `analyzing-metrics`) and a `description`. At startup, agents load *only* this metadata (roughly 30-50 tokens) to decide if the skill is relevant.
* **Markdown Instructions:** The body of the file contains step-by-step instructions. Keep this under 500 lines.
* **The `references/` Directory:** Move detailed edge cases, API documentation, or extensive code templates here. The agent will only load these files if the core skill is triggered.
* **The `scripts/` Directory:** Bundle executable utilities (like an AST parser or a linter wrapper) that the agent can execute via its terminal tool.

**Example `SKILL.md`:**

```markdown
---
name: generate-database-migration
description: Use this skill whenever the user asks to modify the database schema, add tables, or alter columns. Do not use for querying data.
---
# Database Migration Workflow

1. Read the current schema state from `references/schema-state.md`.
2. Generate the SQL migration using the exact syntax rules defined in `references/sql-conventions.md`.
3. Run `scripts/validate-migration.sh` to ensure no destructive drops are executed without approval.

```

## 3. Handle Static Context with AGENTS.md and Pointers

While Skills handle *actions*, you still need a way to impart static project rules (e.g., "Always use TypeScript," "Never use v1 API endpoints").

The **`AGENTS.md`** file, placed in the root of a project repository, acts as a "README for machines" and is a recognized standard stewarded by the Agentic AI Foundation. It should be kept concise (100–150 lines) and serve as the universal foundation.

To support harnesses that still look for proprietary files, use **Thin Pointers** rather than duplicating instructions:

| Harness | Native File | The "Thin Pointer" Strategy |
| --- | --- | --- |
| **Universal** | `AGENTS.md` | Your single source of truth. Contains the core architectural guidelines and boundaries. |
| **Claude Code** | `CLAUDE.md` | Create a one-line file containing `@AGENTS.md` to force Claude to import the universal standard into its context. |
| **Copilot** | `.github/copilot-instructions.md` | Use this file purely to reference `AGENTS.md`. |
| **Cursor** | `.cursor/rules/*.mdc` | Legacy `.cursorrules` are deprecated. Use Cursor's `.mdc` files **only** for path-scoped, UI-specific triggers (e.g., `globs: ["*.tsx"]`), and have the rule body defer to the universal instructions or skills. |

## 4. Distribution and Installation Strategy

To make this repository easily consumable by multiple engineering teams without manual copying, treat it as a distributable package.

Create an installation script (e.g., `install.sh` or an NPX executable) that developers can run in their target project repositories. This script should:

1. Clone or pull the latest version of your central capabilities repository.
2. Concatenate your `rules/` blocks into a tailored `AGENTS.md` file for their specific project.
3. Symlink the `skills/` directory into the specific subdirectories expected by their installed harnesses:
* `ln -s ../agent-capabilities-repo/skills .cursor/skills`
* `ln -s ../agent-capabilities-repo/skills .claude/skills`


4. Drop in the thin pointer files (`CLAUDE.md`, `.mdc` files) to ensure immediate recognition by their chosen IDE.

This ensures that when your centralized team updates a workflow script or refines a prompt in `SKILL.md`, the improvements propagate across Copilot, Cursor, and Claude Code users simultaneously, maintaining native performance for everyone.