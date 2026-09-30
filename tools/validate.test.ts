import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { drift, loadCatalog, render } from "./generate.js"
import { checkRepository, checkSkill, consentFlag, noRootManifest } from "./validate.js"

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
      "ping: references/enable.md must not contain --i-consent (the user's to run)",
    ])
  })

  it("finds the emulated baseline's opt-in, which only the user may grant", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-"))
    writeFileSync(join(dir, "SKILL.md"), skill("name: compare\ndescription: x"))
    writeFileSync(
      join(dir, "notes.md"),
      "decide config egress allow-profile emulated:anthropic/claude-haiku-4.5\n",
    )
    expect(consentFlag(dir, "compare")).toEqual([
      "compare: notes.md must not contain allow-profile (the user's to run)",
    ])
    writeFileSync(join(dir, "notes.md"), "Add it to egress.allowProfiles in .system1/config.yaml\n")
    expect(consentFlag(dir, "compare")).toEqual([
      "compare: notes.md must not contain allowProfiles (the user's to run)",
    ])
  })
})

describe("noRootManifest", () => {
  it("passes the plugin as generated, and fails on a root plugin.json", () => {
    expect(noRootManifest()).toEqual([])
    const dir = mkdtempSync(join(tmpdir(), "plugin-"))
    writeFileSync(join(dir, "plugin.json"), "{}")
    expect(noRootManifest(dir)).toEqual([expect.stringMatching(/must not exist: Codex/)])
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
