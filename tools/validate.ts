/**
 * Structural checks the harnesses would otherwise only report at install time.
 *
 *   pnpm validate
 *
 * Covers: Agent Skills frontmatter, version lockstep across every manifest, the
 * Agent Plugins required fields, and `claude plugin validate --strict` when the
 * `claude` CLI is on PATH.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { loadCatalog, ROOT } from "./generate.js"

const PLUGIN_DIR = join(ROOT, "plugins/system1")
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function checkSkill(dir: string, name: string, text: string): string[] {
  const problems: string[] = []
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!match?.[1]) return [`${name}: SKILL.md has no YAML frontmatter`]
  const front = parse(match[1]) as Record<string, unknown>
  if (front.name !== name)
    problems.push(`${name}: frontmatter name "${String(front.name)}" must match directory`)
  if (!SKILL_NAME.test(name) || name.length > 64)
    problems.push(`${name}: name must be lowercase-hyphenated, ≤64 chars`)
  const description = front.description
  if (typeof description !== "string" || description.trim() === "") {
    problems.push(`${name}: description is required`)
  } else if (description.length > 1024) {
    problems.push(`${name}: description is ${description.length} chars (max 1024)`)
  }
  const sidecar = join(dir, "agents/openai.yaml")
  if (existsSync(sidecar)) {
    try {
      parse(readFileSync(sidecar, "utf8"))
    } catch (error) {
      problems.push(`${name}: agents/openai.yaml does not parse: ${String(error)}`)
    }
  }
  return problems
}

function skills(): string[] {
  const root = join(PLUGIN_DIR, "skills")
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return []
    const dir = join(root, entry.name)
    const file = join(dir, "SKILL.md")
    if (!existsSync(file)) return [`${entry.name}: missing SKILL.md`]
    return checkSkill(dir, entry.name, readFileSync(file, "utf8"))
  })
}

function versions(): string[] {
  const { version } = loadCatalog()
  const manifests = [
    "package.json",
    "packages/core/package.json",
    "packages/cli/package.json",
    "packages/pi/package.json",
    "plugins/system1/plugin.json",
    "plugins/system1/.claude-plugin/plugin.json",
    "plugins/system1/.codex-plugin/plugin.json",
  ]
  const problems = manifests.flatMap((path) => {
    const found = (JSON.parse(readFileSync(join(ROOT, path), "utf8")) as { version?: string })
      .version
    return found === version ? [] : [`${path}: version ${found} ≠ catalog ${version}`]
  })
  const market = JSON.parse(
    readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8"),
  ) as {
    plugins: Array<{ version?: string }>
  }
  for (const entry of market.plugins) {
    if (entry.version !== version)
      problems.push(`.claude-plugin/marketplace.json: entry version ${entry.version} ≠ ${version}`)
  }
  return problems
}

function agentPlugin(): string[] {
  const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, "plugin.json"), "utf8")) as Record<
    string,
    unknown
  >
  const problems: string[] = []
  if (typeof manifest.$schema !== "string")
    problems.push("plugin.json: $schema is required (Agent Plugins 1.0)")
  if (typeof manifest.name !== "string" || !/^[A-Za-z0-9.-]{1,64}$/.test(manifest.name)) {
    problems.push("plugin.json: name must be 1–64 of [A-Za-z0-9.-]")
  }
  return problems
}

function claudeValidate(): string[] {
  const which = spawnSync("sh", ["-c", "command -v claude"], { encoding: "utf8" })
  if (which.status !== 0) {
    console.log("validate: claude CLI not found; skipping `claude plugin validate`")
    return []
  }
  const problems: string[] = []
  for (const target of [PLUGIN_DIR, ROOT]) {
    const run = spawnSync("claude", ["plugin", "validate", target, "--strict"], {
      encoding: "utf8",
    })
    if (run.status !== 0) {
      problems.push(
        `claude plugin validate ${relative(ROOT, target) || "."}:\n${run.stdout}${run.stderr}`,
      )
    }
  }
  return problems
}

if (process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === "") {
  const problems = [...skills(), ...versions(), ...agentPlugin(), ...claudeValidate()]
  if (problems.length > 0) {
    console.error(`validate: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`)
    process.exit(1)
  }
  console.log("validate: ok")
}
