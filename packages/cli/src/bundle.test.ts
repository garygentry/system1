import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"

/**
 * The esbuild bundle is what `bin` and the plugin shim run, while the other
 * tests exercise the TypeScript sources. This runs the built bundle itself, so
 * a chunking, banner or tree-shaking regression fails CI (`pnpm check` builds
 * first). Locally, without a build, it is skipped.
 */
const BUNDLE = fileURLToPath(new URL("../dist/bundle/decide.mjs", import.meta.url))
const built = existsSync(BUNDLE)
const cwd = mkdtempSync(join(tmpdir(), "decide-bundle-"))
const home = mkdtempSync(join(tmpdir(), "decide-bundle-home-"))
mkdirSync(join(cwd, ".git"))
afterAll(() => {
  for (const d of [cwd, home]) rmSync(d, { recursive: true, force: true })
})

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [BUNDLE, ...args], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
  })
  return { code: r.status, out: r.stdout.trim(), err: r.stderr }
}

describe.skipIf(!built && !process.env.CI)("the built bundle", () => {
  it("starts and prints the version and help", () => {
    expect(run("version")).toMatchObject({ code: 0, out: expect.stringMatching(/^\d+\.\d+\.\d+/) })
    expect(run("help").out).toMatch(/^decide .* typed, calibrated decisions/)
  })

  it("keeps the contract's error envelopes and exit codes", () => {
    const unknown = run("nope")
    expect(unknown.code).toBe(2)
    expect(JSON.parse(unknown.out)).toMatchObject({ ok: false, error: { code: "invalid-request" } })
    // No key: a live-looking ask can only replay, and there is no fixture.
    const miss = run("ask", "--text", "x", "--question", "q:noul:Is it x?")
    expect(miss.code).toBe(6)
    expect(JSON.parse(miss.out)).toMatchObject({ ok: false, error: { code: "replay-miss" } })
  })

  it("loads the heavy chunks (yaml, TypeBox, globbing)", () => {
    expect(run("schema", "usage").code).toBe(0)
    expect(run("config", "--format", "brief").out).toMatch(/^repo: /)
    const dry = run("many", "--text", "a", "--question", "q:noul:Is it a?", "--dry-run")
    expect(dry.code).toBe(0)
    expect(JSON.parse(dry.out)).toMatchObject({ ok: true, result: { dryRun: true } })
  })
})
