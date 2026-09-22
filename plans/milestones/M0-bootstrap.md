# M0 — Bootstrap and packaging proof

**Status:** done (2026-09-22)
**Goal:** a green, generated, validated repo. One placeholder skill runs the `decide` CLI from a headless session in Claude Code, Codex and Pi. This session carries the packaging risk up front, before any engine work.

## Scope

1. **Toolchain**
   - git, a pnpm workspace, TypeScript (NodeNext, emitting to `dist/`), vitest and biome.
   - Node ≥ 22.
2. **Repo docs**
   - `AGENTS.md` is canonical. `CLAUDE.md` is `@AGENTS.md`.
   - Also: `README.md`, `LICENSE`, `.gitignore`.
3. **Packages**
   - `@garygentry/decisions-core` holds `ping()`, plus config resolution for endpoint, model and key.
   - `@garygentry/decisions` holds the `decide` CLI, with `ping`, `version` and `help`. Output is a JSON envelope, and exit codes follow the ROADMAP.
4. **Plugin root** (`plugins/decisions/`)
   - `skills/ping/SKILL.md`, plus an `agents/openai.yaml` sidecar.
   - Generated: the `bin/decide` shim and the manifests.
5. **`catalog.yaml` and `tools/generate.ts`** (`--check` mode for CI). The generator emits:
   - `plugins/decisions/.claude-plugin/plugin.json` (Claude Code)
   - `plugins/decisions/.codex-plugin/plugin.json` (Codex; the format proven in shipped OpenAI plugins)
   - `plugins/decisions/plugin.json` (Agent Plugins 1.0, for best-effort hosts)
   - `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`
   - `plugins/decisions/bin/decide`
   - version stamps in each `packages/*/package.json` and in `packages/core/src/version.ts`
6. **`tools/validate.ts`**
   - SKILL.md frontmatter follows the spec: the name matches the directory, and a description is present and at most 1024 characters.
   - Versions are in lockstep.
   - The Agent Plugins `plugin.json` has the required fields.
   - `claude plugin validate --strict`, when `claude` is available.
7. **Pi:** the root `package.json` carries `pi.skills: ["./plugins/decisions/skills"]`. We test it with a local-path install. Git install is deferred (open question 6).
8. **Smoke tests:** `tools/smoke/{claude,codex,pi}.sh` run headless. Each asks the agent to use the ping skill and asserts that the output contains the ping marker.
9. **CI:** `.github/workflows/ci.yml` runs install, build, typecheck, lint, test, `generate --check` and validate. The smoke tests stay local-only.

## Findings recorded during M0

- **Pi**
  - It honours `disable-model-invocation` (`docs/skills.md`). That answers the Pi half of open question 3.
  - It reads skills through the root `package.json` `pi` key, and `pi install -l <path>` works. A git install runs `npm install` when a `package.json` is present, which would pull the root devDependencies (open question 6 stays open).
  - It has no sandbox and does not add plugin `bin/` to PATH.
- **Codex 0.152**
  - Its shipped plugins use `.codex-plugin/plugin.json` (`skills: "./skills/"`, `interface{…}`) plus the per-skill `agents/openai.yaml`. It accepted our plugin, which also has a root Agent Plugins `plugin.json` next to it, and installed it without complaint.
  - It **copies the plugin into its cache and does not put plugin `bin/` on PATH**, so Codex users need `decide` installed globally.
  - **The default `exec` sandbox (read-only) blocks DNS** (`getaddrinfo EAI_AGAIN openrouter.ai`). Two fixes both worked:
    - (a) `-s workspace-write -c sandbox_workspace_write.network_access=true`, which is broad;
    - (b) **a rules file with `prefix_rule(pattern = ["decide"], decision = "allow")`**, which is narrow, keeps the default sandbox, and is the recommended route for `setup` to offer. It is unknown whether a plugin can ship rules itself.
  - `CODEX_HOME` under `/tmp` breaks the sandbox helper ("Refusing to create helper binaries under temporary dir"). The smoke tests use `.smoke/` instead.
  - Codex echoes the SKILL.md text into its log. The smoke marker must match something only the CLI prints, or the test passes falsely (this happened once).
- **Claude Code 2.1.278**
  - Plugin `bin/` is on the Bash PATH, so the shim resolves to the working-tree build. `claude plugin validate --strict` passes for both the plugin and the marketplace.
- **Endpoint**
  - The model listing (`/api/v1/models/<id>/endpoints`) needs no key and answers in about 200 ms, so `ping` is free.
- **Toolchain**
  - TypeScript 7.0 (`tsc -b` with project references), vitest 5 and biome 2.5 all work together.
  - Biome must ignore the generated JSON and `.smoke/`.

## Acceptance

- [x] `pnpm check` passes (build, typecheck, lint, 16 tests, `generate --check`, validate including `claude plugin validate --strict`).
- [x] Claude smoke: `claude -p --plugin-dir plugins/decisions` ran `decide ping` through the skill.
- [x] Codex smoke: local marketplace and `codex exec` in the default sandbox, using the `decide` allow rule. Without the rule it fails with the DNS error, and the skill reported that correctly.
- [x] Pi smoke: a project-scoped install and `pi -p` ran `decide ping` through the skill.
- [x] Findings written back into the ROADMAP.

## Left for later

- There's no commit yet (the user has not asked for one). CI hasn't been run on GitHub; the repo has not been pushed.
- The shim's `npx` fallback cannot work until the package is published (M6). Only the dev path and `DECISIONS_CLI` override are exercised.
- The `ping` skill is a placeholder. It folds into `setup` in M5.
