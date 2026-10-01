/**
 * `adopt`'s code templates (plan m11-adopt item 7), run as a user's repo would
 * run them: copied into a directory with no `.git`, importing the built
 * `@garygentry/system1-core/runtime` (TypeScript) or spawning the built `decide`
 * (Python), and answering from recorded fixtures. Each suite also tests from a
 * read-only root. Flipping the module's `EGRESS` line on must fail its suite.
 */
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { GRANT_CASES } from "./fixtures/grant-corpus.js"
import { ROOT } from "./generate.js"
import { templateGrants } from "./validate.js"

const DECIDE = join(ROOT, "packages/cli/dist/bundle/decide.mjs")
// The templates need Python 3.9 or later; without it the suite is skipped.
const PYTHON =
  spawnSync("python3", ["-c", "import sys; sys.exit(sys.version_info < (3, 9))"]).status === 0

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/**
 * An environment without the key or a parent harness's session: the suites
 * replay, and must pass without either.
 */
function cleanEnv(extraPath?: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/^(OPENROUTER_API_KEY|SYSTEM1_|CLAUDE|CODEX_|PI_SESSION_ID|AI_AGENT)/.test(k),
    ),
  )
  return extraPath ? { ...env, PATH: `${extraPath}:${env.PATH ?? ""}` } : env
}

/** A repo-shaped directory with no `.git` and a recorded answer (tools/smoke/adopt-repo.mjs). */
function repo(lang: "ts" | "python"): { dir: string; src: string } {
  const dir = join(mkdtempSync(join(tmpdir(), `system1-adopt-${lang}-`)), "repo")
  dirs.push(dirname(dir))
  const done = spawnSync(process.execPath, [join(ROOT, "tools/smoke/adopt-repo.mjs"), lang, dir], {
    encoding: "utf8",
  })
  expect(done.status, done.stderr).toBe(0)
  return { dir, src: join(dir, lang === "ts" ? "src" : "app") }
}

function runTs(dir: string) {
  return spawnSync(process.execPath, ["--test", "--test-reporter=tap", "src/policy.test.ts"], {
    cwd: dir,
    encoding: "utf8",
    env: cleanEnv(),
    timeout: 60_000,
  })
}

function runPython(dir: string) {
  const bin = join(dir, "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, "decide"), `#!/bin/sh\nexec "${process.execPath}" "${DECIDE}" "$@"\n`, {
    mode: 0o755,
  })
  return spawnSync("python3", ["-m", "unittest", "discover", "-s", "app"], {
    cwd: dir,
    encoding: "utf8",
    env: cleanEnv(bin),
    timeout: 60_000,
  })
}

/** The module's marked line, switched on the way a user would. */
function flipOn(file: string) {
  const text = readFileSync(file, "utf8")
  const flipped = text.replace(/^(.*EGRESS\b[^=\n]*=\s*)"off"/m, '$1"on"')
  expect(flipped).not.toBe(text)
  writeFileSync(file, flipped)
}

describe("adopt templates: TypeScript", () => {
  it("passes its offline tests from a directory with no .git", () => {
    const { dir } = repo("ts")
    const run = runTs(dir)
    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(run.stdout).toMatch(/# fail 0/)
    expect(run.stdout).toMatch(/# skipped 0/)
  })

  it("fails its tests once the EGRESS line is switched on", () => {
    const { dir, src } = repo("ts")
    flipOn(join(src, "policy.ts"))
    const run = runTs(dir)
    expect(run.status).not.toBe(0)
    expect(run.stdout).toMatch(/not ok \d+ - is off as generated/)
    expect(run.stdout).toMatch(/not ok \d+ - has no grant in the module's source/)
  })
})

describe.skipIf(!PYTHON)("adopt templates: Python", () => {
  it("passes its offline tests through decide runtime, from a directory with no .git", () => {
    const { dir } = repo("python")
    const run = runPython(dir)
    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(run.stderr).toMatch(/\nOK\n?$/)
  })

  it("fails its tests once the EGRESS line is switched on", () => {
    const { dir, src } = repo("python")
    flipOn(join(src, "policy.py"))
    const run = runPython(dir)
    expect(run.status).not.toBe(0)
    expect(run.stderr).toMatch(/FAIL: test_is_off_as_generated/)
    expect(run.stderr).toMatch(/FAIL: test_no_grant_in_the_module_source/)
  })
})

/**
 * The grant scan exists three times (validate.ts, grants.ts, grants.py), and
 * a gap in one is a gap in a generated module's own test: the three must give
 * the same verdict on every case, and the right one.
 */
describe("the grant scan's three copies", () => {
  const TEMPLATES = join(ROOT, "plugins/system1/skills/adopt/references/templates")
  const input = JSON.stringify(GRANT_CASES)
  const expected = GRANT_CASES.map(({ text, python }) => templateGrants(text, python).length === 0)

  it("agree with each other and with the corpus", () => {
    expect(expected).toEqual(GRANT_CASES.map((c) => c.ok))
    const ts = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { grantProblems } from ${JSON.stringify(join(TEMPLATES, "ts/grants.ts"))}
         import { readFileSync } from "node:fs"
         const cases = JSON.parse(readFileSync(0, "utf8"))
         console.log(JSON.stringify(cases.map((c) => grantProblems(c.text, c.python ?? false).length === 0)))`,
      ],
      { input, encoding: "utf8" },
    )
    expect(ts.stderr).toBe("")
    expect(JSON.parse(ts.stdout)).toEqual(expected)
  })

  it.skipIf(!PYTHON)("agree in Python too", () => {
    const py = spawnSync(
      "python3",
      [
        "-c",
        `import json, sys
sys.path.insert(0, ${JSON.stringify(join(TEMPLATES, "python"))})
from grants import grant_problems
cases = json.load(sys.stdin)
print(json.dumps([not grant_problems(c["text"], c.get("python", False)) for c in cases]))`,
      ],
      { input, encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
    )
    expect(py.stderr).toBe("")
    expect(JSON.parse(py.stdout)).toEqual(expected)
  })
})
