import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { setConsent, setGuardEnabled } from "../config/consent.js"
import { loadConfig } from "../config/load.js"
import { useTempDirs } from "../testkit/tmp.js"
import { PACKS } from "./packs.js"

const temp = useTempDirs()

function setup(repoConfig?: string, userConfig?: string) {
  const repo = temp({
    ".git/HEAD": "ref: refs/heads/main\n",
    ...(repoConfig ? { ".system1/config.yaml": repoConfig } : {}),
  })
  const home = temp(userConfig ? { ".config/system1/config.yaml": userConfig } : {})
  const load = () => loadConfig({ cwd: repo, env: {}, home })
  return { repo, home, load }
}

describe("guard config", () => {
  it("defaults every pack to dormant, with its default options", () => {
    const { guard, warnings } = setup().load()
    expect(guard.packs["done-check"]).toEqual({
      enabled: false,
      ...PACKS["done-check"].defaults,
    })
    expect(warnings).toEqual([])
  })

  it("reads enabled from the repo file", () => {
    const { guard } = setup("guard:\n  packs:\n    done-check:\n      enabled: true\n").load()
    expect(guard.packs["done-check"].enabled).toBe(true)
  })

  it("ignores enabled in the user file, with a warning", () => {
    const user = "guard:\n  packs:\n    done-check:\n      enabled: true\n      enabledBy: me\n"
    const { guard, warnings } = setup(undefined, user).load()
    expect(guard.packs["done-check"].enabled).toBe(false)
    expect(guard.packs["done-check"].enabledBy).toBeUndefined()
    expect(warnings).toEqual([
      expect.stringMatching(/guard\.packs\.done-check\.enabled is read only from the repo file/),
      expect.stringMatching(/guard\.packs\.done-check\.enabledBy is read only from the repo file/),
    ])
  })

  it("reads askAboutMessage from the repo file only, off by default", () => {
    expect(setup().load().guard.packs["done-check"].askAboutMessage).toBe(false)
    const repo = "guard:\n  packs:\n    done-check:\n      askAboutMessage: true\n"
    expect(setup(repo).load().guard.packs["done-check"].askAboutMessage).toBe(true)
    const { guard, warnings } = setup(undefined, repo).load()
    expect(guard.packs["done-check"].askAboutMessage).toBe(false)
    expect(warnings).toEqual([
      expect.stringMatching(/done-check\.askAboutMessage is read only from the repo file/),
    ])
  })

  it("layers the other options, repo over user over default; lists whole", () => {
    const user =
      "guard:\n  packs:\n    done-check:\n      latencyMs: 3000\n      maxUsdPerSession: 0.5\n      criteria: [A.md]\n"
    const repo =
      "guard:\n  packs:\n    done-check:\n      latencyMs: 2000\n      criteria: [B.md, C.md]\n"
    const pack = setup(repo, user).load().guard.packs["done-check"]
    expect(pack).toMatchObject({
      latencyMs: 2000,
      maxUsdPerSession: 0.5,
      criteria: ["B.md", "C.md"],
      evidence: [],
    })
  })

  it("ignores wrong types and unknown keys and packs, with warnings", () => {
    const repo = [
      "guard:",
      "  mode: strict",
      "  packs:",
      "    lint-check: { enabled: true }",
      "    done-check:",
      "      enabled: yes please",
      "      latencyMs: -1",
      "      criteria: TASK.md",
      "      colour: blue",
      "",
    ].join("\n")
    const { guard, warnings } = setup(repo).load()
    expect(guard.packs["done-check"]).toMatchObject({
      enabled: false,
      latencyMs: 5000,
      criteria: ["TASK.md", ".system1/done.md"],
    })
    expect(warnings).toHaveLength(6)
    expect(warnings.join("\n")).toMatch(/unknown key guard\.mode/)
    expect(warnings.join("\n")).toMatch(/unknown guard pack lint-check/)
    expect(warnings.join("\n")).toMatch(/done-check\.enabled must be true or false/)
    expect(warnings.join("\n")).toMatch(/done-check\.latencyMs must be a number above 0/)
    expect(warnings.join("\n")).toMatch(/done-check\.criteria must be a list of file paths/)
    expect(warnings.join("\n")).toMatch(/unknown key guard\.packs\.done-check\.colour/)
  })

  it("warns about a guard section that isn't a mapping", () => {
    expect(setup("guard: on\n").load().warnings).toEqual([
      expect.stringMatching(/guard must be a mapping/),
    ])
  })
})

describe("setGuardEnabled", () => {
  it("writes the repo file, keeping its comments and consent", () => {
    const { repo, load } = setup("# keep me\nconcurrency: 4\n")
    setConsent(repo, true, "test")
    const now = new Date("2026-09-27T00:00:00Z")
    expect(setGuardEnabled(repo, "done-check", true, "decide guard", now)).toEqual({
      enabled: true,
      enabledAt: "2026-09-27T00:00:00.000Z",
      enabledBy: "decide guard",
    })
    const text = readFileSync(join(repo, ".system1/config.yaml"), "utf8")
    expect(text).toContain("# keep me")
    const config = load()
    expect(config.egress.consent.granted).toBe(true)
    expect(config.guard.packs["done-check"]).toMatchObject({
      enabled: true,
      enabledBy: "decide guard",
    })
    setGuardEnabled(repo, "done-check", false)
    expect(load().guard.packs["done-check"]).toMatchObject({ enabled: false })
    expect(load().guard.packs["done-check"].enabledBy).toBeUndefined()
  })
})

describe("setGuardEnabled and setConsent on awkward files", () => {
  it.each([
    ["guard:\n", "an empty guard section"],
    ["guard:\n  packs:\n", "an empty packs section"],
    ["guard:\n  packs:\n    done-check:\n      # latencyMs: 2000\n", "options all commented out"],
    ["guard: { packs: { done-check: { latencyMs: 2000 } } }\n", "flow style"],
    ["", "an empty file"],
    ["# only a comment\n", "a comment-only file"],
  ])("writes over %j (%s)", (text) => {
    const { repo, load } = setup("# placeholder\n")
    writeFileSync(join(repo, ".system1/config.yaml"), text)
    setGuardEnabled(repo, "done-check", true, "t")
    expect(load().guard.packs["done-check"].enabled).toBe(true)
  })

  it.each([
    ["guard: [1]\n", /guard must be a mapping/],
    ["guard:\n  packs: 3\n", /guard\.packs must be a mapping/],
    ["guard:\n  packs:\n    done-check: true\n", /guard\.packs\.done-check must be a mapping/],
    ["guard: {\n", /is not valid YAML/],
    ["- a\n- list\n", /must be a YAML mapping/],
  ])("refuses %j with a config-error, leaving the file alone", (text, message) => {
    const { repo } = setup("# placeholder\n")
    const file = join(repo, ".system1/config.yaml")
    writeFileSync(file, text)
    expect(() => setGuardEnabled(repo, "done-check", true)).toThrow(message)
    expect(readFileSync(file, "utf8")).toBe(text)
  })

  it("setConsent writes over an empty egress section", () => {
    const { repo, load } = setup("egress:\n")
    setConsent(repo, true, "t")
    expect(load().egress.consent.granted).toBe(true)
  })
})
