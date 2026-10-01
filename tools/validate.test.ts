import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { drift, loadCatalog, ROOT, render } from "./generate.js"
import { GRANT_CASES } from "./grant-corpus.js"
import {
  checkRepository,
  checkSkill,
  consentFlag,
  noRootManifest,
  templateGrants,
} from "./validate.js"

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

  it("lets only the adopt templates spawn decide runtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-"))
    mkdirSync(join(dir, "references/templates/python"), { recursive: true })
    writeFileSync(join(dir, "SKILL.md"), skill("name: adopt\ndescription: x"))
    writeFileSync(
      join(dir, "references/templates/python/policy.py"),
      'subprocess.run(["decide", "runtime", "--module", __file__])\n# decide runtime --module\n',
    )
    expect(consentFlag(dir, "adopt")).toEqual([])
    for (const text of [
      "Then run `decide  runtime --module x`.\n",
      'spawn(["decide", "runtime"])\n',
      "decide \\\n  runtime --module x\n",
    ]) {
      writeFileSync(join(dir, "references/run.md"), text)
      expect(consentFlag(dir, "adopt"), text).toEqual([
        "adopt: references/run.md must not run decide runtime (an adopted module's, outside adopt's references/templates/)",
      ])
    }
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

describe("templateGrants", () => {
  const MARK = "system1: runtime egress"
  it("allows what the templates do and finds every grant in the corpus", () => {
    for (const { text, ok, python } of GRANT_CASES)
      expect(templateGrants(text, python).length === 0, text).toBe(ok)
  })

  it("scans every file under references/templates/, and the shipped ones pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-"))
    mkdirSync(join(dir, "references/templates/ts"), { recursive: true })
    writeFileSync(join(dir, "SKILL.md"), skill("name: adopt\ndescription: x"))
    writeFileSync(
      join(dir, "references/templates/ts/policy.ts"),
      `const EGRESS = "on" // ${MARK}\n`,
    )
    expect(consentFlag(dir, "adopt")).toEqual([
      'adopt: references/templates/ts/policy.ts grants runtime egress: line 1: the marked line isn\'t a constant EGRESS set to "off"',
    ])
    expect(consentFlag(join(ROOT, "plugins/system1/skills/adopt"), "adopt")).toEqual([])
  })

  it("exempts only adopt's templates from the decide runtime rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-"))
    mkdirSync(join(dir, "references/templates"), { recursive: true })
    writeFileSync(join(dir, "SKILL.md"), skill("name: ask\ndescription: x"))
    writeFileSync(join(dir, "references/templates/run.sh"), "decide runtime --module x\n")
    expect(consentFlag(dir, "ask")).toEqual([
      "ask: references/templates/run.sh must not run decide runtime (an adopted module's, outside adopt's references/templates/)",
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
