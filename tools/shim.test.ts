import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadCatalog } from "./generate.js"

// The generated plugin shim, run from outside the repo (so it finds no checkout
// bundle) with a PATH that holds node and sh but no decide and no npx.
const SHIM = join(import.meta.dirname, "../plugins/system1/bin/decide")
const { version } = loadCatalog()
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/**
 * A scratch plugin and npm cache holding npx copies of the CLI at `versions`.
 * The cache sits at `$HOME/.npm` (npm's default) or at a configured path.
 */
function setup(versions: string[], where: "home" | "configured" = "configured") {
  const root = mkdtempSync(join(tmpdir(), "system1-shim-"))
  dirs.push(root)
  const bin = join(root, "a/b/c/bin")
  mkdirSync(bin, { recursive: true })
  copyFileSync(SHIM, join(bin, "decide"))
  chmodSync(join(bin, "decide"), 0o755)
  const tools = join(root, "tools")
  mkdirSync(tools)
  for (const tool of ["node", "sh", "grep", "dirname", "readlink"]) {
    const found = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim()
    writeFileSync(join(tools, tool), `#!/bin/sh\nexec ${found} "$@"\n`)
    chmodSync(join(tools, tool), 0o755)
  }
  const cache = join(root, where === "home" ? ".npm" : "npm-cache")
  versions.forEach((v, i) => {
    const pkg = join(cache, `_npx/hash${i}/node_modules/@garygentry/system1`)
    mkdirSync(join(pkg, "dist/bundle"), { recursive: true })
    writeFileSync(
      join(pkg, "package.json"),
      `${JSON.stringify({ name: "@garygentry/system1", version: v }, null, 2)}\n`,
    )
    writeFileSync(
      join(pkg, "dist/bundle/decide.mjs"),
      `console.log("cached ${v} " + process.argv.slice(2).join(" "))\n`,
    )
  })
  return (env: Record<string, string> = {}) =>
    spawnSync(join(bin, "decide"), ["route", "--hook"], {
      env: {
        PATH: tools,
        HOME: root,
        ...(where === "configured" ? { npm_config_cache: cache } : {}),
        ...env,
      },
      encoding: "utf8",
    })
}

describe("plugin shim", () => {
  it("runs the pinned version from npx's cache, even when it may not download", () => {
    const run = setup(["0.0.1", version])
    expect(run({ SYSTEM1_NO_NPX: "1" })).toMatchObject({
      status: 0,
      stdout: `cached ${version} route --hook\n`,
    })
  })

  it("ignores other cached versions", () => {
    const r = setup(["0.0.1", `${version}9`])({ SYSTEM1_NO_NPX: "1" })
    expect(r.status).toBe(127)
    expect(r.stderr).toContain(`npm i -g @garygentry/system1@${version}`)
  })

  it("looks in ~/.npm when no cache is configured", () => {
    const r = setup([version], "home")({ SYSTEM1_NO_NPX: "1" })
    expect(r).toMatchObject({ status: 0, stdout: `cached ${version} route --hook\n` })
  })
})
