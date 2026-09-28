import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { drift, loadCatalog, render } from "./generate.js"
import { checkRepository, checkSkill, consentFlag } from "./validate.js"

const skill = (front: string) => `---\n${front}\n---\n\n# Body\n`

describe("checkSkill", () => {
  it("accepts a spec-compliant skill", () => {
    expect(
      checkSkill("/nowhere", "ping", skill("name: ping\ndescription: Checks things.")),
    ).toEqual([])
  })

  it("requires the name to match the directory", () => {
    expect(checkSkill("/nowhere", "ping", skill("name: pong\ndescription: x"))).toHaveLength(1)
  })

  it("requires a description", () => {
    expect(checkSkill("/nowhere", "ping", skill("name: ping"))).toEqual([
      "ping: description is required",
    ])
  })

  it("rejects missing frontmatter", () => {
    expect(checkSkill("/nowhere", "ping", "# no frontmatter")).toHaveLength(1)
  })
})

describe("consentFlag", () => {
  it("finds the guard consent flag in any file a skill ships", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-"))
    mkdirSync(join(dir, "references"))
    writeFileSync(join(dir, "SKILL.md"), skill("name: ping\ndescription: x"))
    expect(consentFlag(dir, "ping")).toEqual([])
    writeFileSync(join(dir, "references/enable.md"), "decide guard enable done-check --i-consent\n")
    expect(consentFlag(dir, "ping")).toEqual([
      "ping: references/enable.md must not contain --i-consent (the user's flag)",
    ])
  })
})

describe("generate", () => {
  it("is deterministic and matches what is committed", () => {
    const outputs = render(loadCatalog())
    expect(render(loadCatalog())).toEqual(outputs)
    expect(drift(outputs)).toEqual([])
  })

  it("pins the shim to the catalog version", () => {
    const catalog = loadCatalog()
    const shim = render(catalog).find((o) => o.path.endsWith("bin/decide"))
    expect(shim?.content).toContain(`@garygentry/system1@${catalog.version}`)
  })
})

describe("checkRepository", () => {
  const url = "git+https://github.com/garygentry/system1.git"

  it("accepts the exact url", () => {
    expect(checkRepository("p", { repository: { type: "git", url } }, url)).toEqual([])
  })

  it("rejects a url npm would only normalise", () => {
    const bare = { repository: { url: "https://github.com/garygentry/system1" } }
    expect(checkRepository("p", bare, url)).toHaveLength(1)
    expect(checkRepository("p", {}, url)).toHaveLength(1)
  })
})
