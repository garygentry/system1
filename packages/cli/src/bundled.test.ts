import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { bundledSpecsDir } from "./bundled.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tree(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "decide-bundled-"))
  dirs.push(root)
  for (const f of files) {
    mkdirSync(join(root, f, ".."), { recursive: true })
    if (f.endsWith("/")) mkdirSync(join(root, f), { recursive: true })
    else
      writeFileSync(
        join(root, f),
        f.endsWith("package.json") ? JSON.stringify({ name: "@garygentry/system1" }) : "",
      )
  }
  return root
}

describe("bundledSpecsDir", () => {
  it("uses a published package's own specs/", () => {
    const root = tree(["pkg/package.json", "pkg/specs/", "pkg/dist/bundle/chunks/x.mjs"])
    expect(bundledSpecsDir(join(root, "pkg/dist/bundle/chunks/x.mjs"))).toBe(
      join(root, "pkg/specs"),
    )
  })

  it("uses the plugin's specs in a checkout, from tsc or bundle output", () => {
    const root = tree([
      "catalog.yaml",
      "plugins/system1/specs/",
      "packages/cli/package.json",
      "packages/cli/dist/bin.js",
    ])
    const want = join(root, "plugins/system1/specs")
    expect(bundledSpecsDir(join(root, "packages/cli/dist/bin.js"))).toBe(want)
    expect(bundledSpecsDir(join(root, "packages/cli/dist/bundle/chunks/x.mjs"))).toBe(want)
  })

  it("ignores a look-alike folder next to an installed package", () => {
    // node_modules/@garygentry/system1 → ../.. is node_modules, which has no catalog.yaml.
    const root = tree([
      "node_modules/plugins/system1/specs/",
      "node_modules/@garygentry/system1/package.json",
    ])
    const from = join(root, "node_modules/@garygentry/system1/dist/bundle/chunks/x.mjs")
    expect(bundledSpecsDir(from)).toBeUndefined()
  })
})
