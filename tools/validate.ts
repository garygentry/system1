/**
 * Structural checks the harnesses would otherwise only report at install time.
 *
 *   pnpm validate
 *
 * Covers: Agent Skills frontmatter, no guard consent flag in a skill, version lockstep across every manifest, the
 * repository url npm trusted publishing matches on, no root plugin.json (Codex drops hooks), and `claude plugin validate --strict` when the
 * `claude` CLI is on PATH.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { loadCatalog, npmRepository, ROOT } from "./generate.js"

const PLUGIN_DIR = join(ROOT, "plugins/system1")
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
/**
 * What only the user may run, so no skill may spell it out: the guard consent
 * flag (M10 X6), and allowing an emulated baseline to receive the repo's
 * content (M11, plan m11-adopt D2).
 */
const USER_ONLY = ["--i-consent", "allow-profile", "allowProfiles"]

/**
 * `decide runtime` is what an adopted Python module spawns, never an agent
 * (plan m11-adopt D7): skills may ship it only inside the code templates
 * `adopt` copies into a repo.
 */
const MODULE_ONLY = /\bdecide(?:\.mjs)?(?:["',\s\\]|\]\s*)+runtime\b/
const TEMPLATES = /(^|\/)references\/templates\//

/**
 * A grant of runtime egress in a code template (0020, plan m11-adopt item 7).
 * `adopt` copies these files into a repo, and its output must never turn
 * egress on: the one marked `EGRESS` line says "off", and switching it is the
 * user's edit. Each generated module's own test runs the same scan over the
 * module as written.
 *
 * An allowlist for the name, read one line at a time:
 * - the marked line is a `const` (TS) or `Final` (Python) set to "off";
 * - every other `EGRESS` in code is a comparison, a one-line import, an
 *   `(EGRESS, "off")` assertion, or the runtime's `egress: EGRESS` as the last
 *   property, closing its object, in the file that declares it;
 * - a Unicode line separator is refused, since TypeScript ends a line there.
 *
 * Comment lines and string contents are skipped. It reads text, not what
 * runs: a computed key or code it doesn't parse can still pass it, so the
 * user's review of the diff is the control (0020).
 */
export function templateGrants(text: string, python = false): string[] {
  const problems: string[] = []
  if (/[\u2028\u2029]/.test(text)) problems.push("a Unicode line separator (U+2028/U+2029)")
  const lines = text.split(/\r\n|[\r\n\u2028\u2029]/)
  const marked = lines.filter((line) => line.includes(MARKER))
  if (marked.length > 1) problems.push(`${marked.length} lines carry the egress marker, not one`)
  const declares = marked.length === 1 && OFF_LINE.test(marked[0] as string)
  const comment = python ? /^\s*#/ : /^\s*(?:\/\/|\/\*|\*)/
  for (const [i, line] of lines.entries()) {
    const at = `line ${i + 1}`
    if (line.includes(MARKER)) {
      if (!OFF_LINE.test(line))
        problems.push(`${at}: the marked line isn't a constant EGRESS set to "off"`)
      continue
    }
    if (comment.test(line)) continue
    const code = line
      .replace(/(?<![fF])"(?:[^"\\]|\\.)*"|(?<![fF])'(?:[^'\\]|\\.)*'/g, '""')
      .replace(/`EGRESS`/g, "")
    for (const m of code.matchAll(/\bEGRESS\b/g)) {
      const before = code.slice(0, m.index)
      const after = code.slice((m.index ?? 0) + m[0].length)
      const allowed =
        /^\s*[!=]==?(?!=)/.test(after) ||
        /[!=]==?\s*$/.test(before) ||
        /^\s*(?:import\s*(?:type\s*)?\{[^}]*\}\s*from\s|from\s+[\w.]+\s+import\s+[\w\s,]*$)/.test(
          code,
        ) ||
        (/\(\s*$/.test(before) && /^\s*,\s*""\s*\)/.test(after)) ||
        inImportList(lines, i) ||
        /\begress\s*:\s*$/.test(before)
      if (!allowed) problems.push(`${at}: EGRESS used other than as allowed`)
    }
    for (const m of code.matchAll(/\begress\b(?!-)/g)) {
      const rest = code.slice((m.index ?? 0) + m[0].length)
      if (/^\s*[:=](?!=)/.test(rest)) {
        const closes = /^\s*:\s*EGRESS\s*[})]/.test(rest)
        const last =
          /^\s*:\s*EGRESS\s*,?\s*$/.test(rest) &&
          /^\s*\}/.test(lines.slice(i + 1).find((l) => l.trim() !== "") ?? "")
        if (!closes && !last)
          problems.push(`${at}: egress given anything but EGRESS, last, closing its object`)
        else if (!declares) problems.push(`${at}: egress given an EGRESS this file doesn't declare`)
      } else if (/^\s*[,})]/.test(rest)) problems.push(`${at}: egress passed as a variable`)
    }
    if (/["']egress["']|\.egress\b/.test(line)) problems.push(`${at}: egress set by name`)
    if (/egressConsent/i.test(line)) problems.push(`${at}: an egress consent option`)
    if (/\bsetattr\s*\(|\bglobals\s*\(|\b__dict__\b|Object\.defineProperty|Reflect\.set/.test(code))
      problems.push(`${at}: a binding set by reflection`)
    if (/\bEGRESS\b/.test(line) && /process\.env|os\.environ|getenv/.test(line))
      problems.push(`${at}: EGRESS read from the environment`)
  }
  return problems
}

/** Is line `i` a bare `EGRESS,` item of a multi-line import (TS `import {…} from`, Python `from … import (…)`)? */
function inImportList(lines: string[], i: number): boolean {
  if (!/^\s*EGRESS\s*,?\s*$/.test(lines[i] as string)) return false
  const item = /^\s*(?:type\s+)?\w+(?:\s+as\s+\w+)?\s*,?\s*$/
  let start = i - 1
  while (start >= 0 && item.test(lines[start] as string)) start--
  let end = i + 1
  while (end < lines.length && item.test(lines[end] as string)) end++
  const open = lines[start] ?? ""
  const close = lines[end] ?? ""
  return (
    (/^\s*import\s*(?:type\s*)?\{\s*$/.test(open) && /^\s*\}\s*from\s/.test(close)) ||
    (/^\s*from\s+[\w.]+\s+import\s*\(\s*$/.test(open) && /^\s*\)\s*$/.test(close))
  )
}

const MARKER = "system1: runtime egress"
/** The one form the marked line may take in a template: a constant, "off". */
const OFF_LINE =
  /^(?:(?:export\s+)?const\s+EGRESS\s*(?::\s*[\w.[\]|,"' ]+?\s*)?=\s*(["'])off\1\s*(?:(?:as|satisfies)\s+[\w.]+\s*)?;?\s*\/\/|EGRESS\s*:\s*Final\s*=\s*(["'])off\2\s*#)\s*system1: runtime egress/

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
    return [
      ...checkSkill(dir, entry.name, readFileSync(file, "utf8")),
      ...consentFlag(dir, entry.name),
    ]
  })
}

/** Every file a skill ships (SKILL.md, references, the Codex sidecar) that spells out what only the user may run. */
export function consentFlag(dir: string, name: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .flatMap((path) => {
      const text = readFileSync(join(dir, path), "utf8")
      return [
        ...USER_ONLY.filter((word) => text.includes(word)).map(
          (word) => `${name}: ${path} must not contain ${word} (the user's to run)`,
        ),
        ...(MODULE_ONLY.test(text) && !(name === "adopt" && TEMPLATES.test(path))
          ? [
              `${name}: ${path} must not run decide runtime (an adopted module's, outside adopt's references/templates/)`,
            ]
          : []),
        // Code only: a README describes the grant, it can't make one.
        ...(TEMPLATES.test(path) && !path.endsWith(".md")
          ? templateGrants(text, path.endsWith(".py")).map(
              (p) => `${name}: ${path} grants runtime egress: ${p}`,
            )
          : []),
      ]
    })
}

function versions(): string[] {
  const { version } = loadCatalog()
  const manifests = [
    "package.json",
    "packages/core/package.json",
    "packages/cli/package.json",
    "packages/pi/package.json",
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

/** Trusted publishing refuses a package whose repository.url is not the repo's exact url (0022). */
export function checkRepository(path: string, manifest: { repository?: unknown }, url: string) {
  const found = (manifest.repository as { url?: unknown } | undefined)?.url
  return found === url ? [] : [`${path}: repository.url ${String(found)} ≠ ${url}`]
}

function repositories(): string[] {
  const { url } = npmRepository(loadCatalog(), "")
  return ["core", "cli", "pi"].flatMap((pkg) => {
    const path = `packages/${pkg}/package.json`
    return checkRepository(path, JSON.parse(readFileSync(join(ROOT, path), "utf8")), url)
  })
}

/**
 * No root `plugin.json` (Agent Plugins 1.0). With one there, Codex reads it as
 * the manifest and loads none of the plugin's hooks, silently (0007, amended).
 */
export function noRootManifest(pluginDir: string = PLUGIN_DIR): string[] {
  return existsSync(join(pluginDir, "plugin.json"))
    ? [
        `${relative(ROOT, join(pluginDir, "plugin.json"))}: must not exist: Codex then ignores the plugin's hooks (0007)`,
      ]
    : []
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
  const problems = [
    ...skills(),
    ...versions(),
    ...repositories(),
    ...noRootManifest(),
    ...claudeValidate(),
  ]
  if (problems.length > 0) {
    console.error(`validate: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`)
    process.exit(1)
  }
  console.log("validate: ok")
}
