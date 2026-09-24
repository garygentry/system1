import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { DECIDE_OPTIONS } from "../packages/cli/src/args.js"
import { CONFIG_OPTIONS } from "../packages/cli/src/commands/config.js"
import { USAGE_OPTIONS } from "../packages/cli/src/commands/misc.js"
import { ROUTE_OPTIONS } from "../packages/cli/src/commands/route.js"
import { SPEC_OPTIONS } from "../packages/cli/src/commands/spec.js"
import { BY_CODE, EXIT } from "../packages/cli/src/exit-codes.js"
import { HELP } from "../packages/cli/src/main.js"
import { DEFAULTS } from "../packages/core/src/config/load.js"
import { SpecSchema } from "../packages/core/src/spec/spec.js"
import { DOCTOR_CHECKS } from "../packages/core/src/tools/doctor.js"
import { ROOT } from "./cookbook.js"

/**
 * The docs promise to match the code. These checks make the promise hold:
 * a new command, flag, error code or doctor check fails here until it is
 * documented, and a renamed heading fails every link that pointed at it.
 */
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")
const cli = read("docs/cli.md")
const troubleshooting = read("docs/troubleshooting.md")
const configuration = read("docs/configuration.md")
const specFormat = read("docs/spec-format.md")

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-")
}

function anchors(markdown: string): Set<string> {
  const out = new Set<string>()
  const seen = new Map<string, number>()
  let fenced = false
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced
    const m = fenced ? null : /^#{1,6} (.+)$/.exec(line)
    if (!m?.[1]) continue
    const base = slug(m[1])
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    out.add(n === 0 ? base : `${base}-${n}`)
  }
  return out
}

describe("docs/cli.md", () => {
  it("documents every command in `decide help`", () => {
    const block = HELP.slice(HELP.indexOf("Commands:"), HELP.indexOf("Questions:"))
    const commands = [...block.matchAll(/^ {2}([a-z]+) {2,}/gm)].map((m) => m[1])
    expect(commands.length).toBeGreaterThan(5)
    for (const command of commands) expect(cli, command).toContain(`\`decide ${command}`)
  })

  it("documents every flag", () => {
    const flags = [
      ...Object.keys(DECIDE_OPTIONS),
      ...Object.keys(SPEC_OPTIONS),
      ...Object.keys(CONFIG_OPTIONS),
      ...Object.keys(USAGE_OPTIONS),
      ...Object.keys(ROUTE_OPTIONS),
      "format",
    ]
    for (const flag of flags) expect(cli, `--${flag}`).toMatch(new RegExp(`--${flag}\\b`))
  })

  it("has the exit-code table decide uses", () => {
    const section = cli.slice(cli.indexOf("## Exit codes"))
    const rows = [...section.matchAll(/^\| (\d) \| [^|]+ \| ([^|]+) \|$/gm)]
    const documented: Record<string, number> = {}
    for (const [, exit, codes] of rows) {
      for (const code of codes?.match(/`([a-z-]+)`/g) ?? []) {
        documented[code.slice(1, -1)] = Number(exit)
      }
    }
    expect(documented).toEqual({ ...BY_CODE, error: EXIT.failure })
    expect(rows.map((r) => Number(r[1]))).toEqual(Object.values(EXIT))
  })
})

describe("docs/troubleshooting.md", () => {
  it("covers every error code, with its exit code", () => {
    for (const [code, exit] of Object.entries({ ...BY_CODE, error: EXIT.failure })) {
      expect(troubleshooting, code).toContain(`### \`${code}\` · exit ${exit}\n`)
    }
  })

  it("covers every doctor check", () => {
    for (const check of DOCTOR_CHECKS) {
      expect(troubleshooting, check).toContain(`### doctor: \`${check}\`\n`)
    }
  })
})

describe("docs/configuration.md", () => {
  it("documents every config key, nested ones as `section.key`", () => {
    const keys = Object.entries(DEFAULTS).flatMap(([key, value]) =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value).map((sub) => `${key}.${sub}`)
        : [key],
    )
    // `route.message` is optional, so it has no default to list it.
    keys.push("route.message")
    expect(keys).toContain("budget.maxCalls")
    for (const key of keys) expect(configuration, key).toContain(`\`${key}\``)
  })
})

describe("docs/spec-format.md", () => {
  it("documents every top-level spec field", () => {
    const fields = Object.keys(SpecSchema.properties)
    expect(fields).toContain("examples")
    for (const field of fields) expect(specFormat, field).toContain(`| \`${field}\` |`)
  })
})

describe("docs/tutorial.md", () => {
  const tutorial = read("docs/tutorial.md")
  // The lab downloads tools/evals/fixture-repo from main. Moving or renaming it,
  // or the files the exercises use, would break the lab for every reader.
  const lab = "tools/evals/fixture-repo"

  it("downloads the lab from where it lives", () => {
    expect(tutorial).toContain(`--strip-components=4 system1-main/${lab}`)
    expect(lab.split("/").length + 1).toBe(4)
  })

  it.each([
    "tickets.jsonl",
    "test-output.log",
    "cleanup-plan.sh",
    "src/billing/charge.ts",
    ".system1/specs/timeouts.yaml",
  ])("uses %s, which the lab repo has", (file) => {
    expect(tutorial).toContain(file.replace(/^.*\//, ""))
    expect(existsSync(join(ROOT, lab, file)), file).toBe(true)
  })
})

/** Every markdown file under `dir`, relative to the repo root. */
function markdownUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) return markdownUnder(path)
    return entry.name.endsWith(".md") ? [path] : []
  })
}

describe("links", () => {
  const pages = ["README.md", ...markdownUnder("docs")]

  it.each(pages)("%s: every local link and anchor resolves", (page) => {
    const text = read(page)
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (!target || /^[a-z]+:/.test(target)) continue
      const [path, hash] = target.split("#") as [string, string | undefined]
      const file = path ? resolve(dirname(join(ROOT, page)), path) : join(ROOT, page)
      expect(existsSync(file), `${page} → ${target}`).toBe(true)
      if (hash && file.endsWith(".md")) {
        expect(anchors(readFileSync(file, "utf8")).has(hash), `${page} → ${target}`).toBe(true)
      }
    }
  })
})
