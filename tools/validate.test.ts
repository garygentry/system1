import { describe, expect, it } from "vitest"
import { drift, loadCatalog, render } from "./generate.js"
import { checkSkill } from "./validate.js"

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

describe("generate", () => {
  it("is deterministic and matches what is committed", () => {
    const outputs = render(loadCatalog())
    expect(render(loadCatalog())).toEqual(outputs)
    expect(drift(outputs)).toEqual([])
  })

  it("pins the shim to the catalog version", () => {
    const catalog = loadCatalog()
    const shim = render(catalog).find((o) => o.path.endsWith("bin/decide"))
    expect(shim?.content).toContain(`@garygentry/decisions@${catalog.version}`)
  })
})
