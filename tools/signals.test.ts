import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parse } from "yaml"
import { main } from "../packages/cli/src/main.js"
import { undecidedNames } from "../packages/core/src/model/answers.js"
import { parseFilter, verdictOf } from "../packages/core/src/project/project.js"
import { ROOT } from "./cookbook.js"

/**
 * Scout's signal tables (M9 §4): specs shipped with the skill, and their
 * recorded answers in `tools/scout/fixtures/`, replayed offline. A wording
 * change that breaks an example, or makes the keepAny/keep policy keep or
 * drop the wrong example, fails `pnpm test`.
 *
 * Re-record after changing a table (live; needs a key and this repo's consent):
 *   rm -rf .system1/fixtures/<name>
 *   node packages/cli/dist/bundle/decide.mjs spec check plugins/system1/skills/scout/references/<name>.yaml --live
 *   mv .system1/fixtures/<name> tools/scout/fixtures/
 */
const REFERENCES = join(ROOT, "plugins/system1/skills/scout/references")
const FIXTURES = join(ROOT, "tools/scout/fixtures")
const TABLES = ["signals-code", "signals-agents"]

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface Table {
  questions: Record<string, unknown>
  keep?: string[]
  keepAny?: string[]
  meta: { screen: { kept: string[]; dropped: string[] } }
  examples: Array<{ id: string }>
}

async function run(args: string[], name: string) {
  const repo = mkdtempSync(join(tmpdir(), "signals-"))
  const home = mkdtempSync(join(tmpdir(), "signals-home-"))
  dirs.push(repo, home)
  mkdirSync(join(repo, ".system1/specs"), { recursive: true })
  cpSync(join(REFERENCES, `${name}.yaml`), join(repo, ".system1/specs", `${name}.yaml`))
  cpSync(join(FIXTURES, name), join(repo, ".system1/fixtures", name), { recursive: true })
  const out: string[] = []
  // No key, no consent: offline, from the fixtures alone.
  const code = await main(args, {
    out: (t) => out.push(t),
    err: () => {},
    env: {},
    cwd: repo,
    home,
  })
  return { code, envelope: JSON.parse(out.at(-1) ?? "null") }
}

describe.each(TABLES)("%s", (name) => {
  const table = parse(readFileSync(join(REFERENCES, `${name}.yaml`), "utf8")) as Table

  it("passes spec lint --strict", async () => {
    const { code, envelope } = await run(["spec", "lint", name, "--strict"], name)
    expect(envelope.result.specs[0].findings).toEqual([])
    expect(code).toBe(0)
  })

  it("replays every example, passing", async () => {
    const { code, envelope } = await run(["spec", "check", name, "--strict"], name)
    expect(envelope.result).toMatchObject({ source: "replay", passed: true })
    expect(code).toBe(0)
  })

  it("keeps and drops exactly the examples meta.screen says", async () => {
    const { envelope } = await run(["spec", "check", name], name)
    const questions = table.questions as Parameters<typeof parseFilter>[1]
    const keep = (table.keep ?? []).map((k) => parseFilter(k, questions))
    const keepAny = (table.keepAny ?? []).map((k) => parseFilter(k, questions))
    const verdicts: Record<string, string> = {}
    for (const e of envelope.result.examples) {
      // Flat as `many` sees it: every answer at or under the floor, not only
      // the ones an example happens to expect.
      verdicts[e.id] = verdictOf(e.answers, undecidedNames(e.answers), keep, keepAny).verdict
    }
    const expected = Object.fromEntries([
      ...table.meta.screen.kept.map((id) => [id, "kept"]),
      ...table.meta.screen.dropped.map((id) => [id, "dropped"]),
    ])
    expect(Object.keys(expected).sort()).toEqual(table.examples.map((e) => e.id).sort())
    expect(verdicts).toEqual(expected)
  })
})
