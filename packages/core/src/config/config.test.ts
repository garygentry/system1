import { chmodSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { useTempDirs, writeTree } from "../testkit/tmp.js"
import { assertConsent, setConsent } from "./consent.js"
import { findRepoRoot, loadConfig } from "./load.js"

const temp = useTempDirs()

function setup(repoConfig?: string, userConfig?: string) {
  const repo = temp({ ".git/HEAD": "ref: refs/heads/main\n", "src/a.ts": "x" })
  const home = temp()
  if (repoConfig !== undefined) writeTree(repo, { ".system1/config.yaml": repoConfig })
  if (userConfig !== undefined) writeTree(home, { ".config/system1/config.yaml": userConfig })
  return { repo, home }
}

describe("loadConfig", () => {
  it("uses defaults with no files", () => {
    const { repo, home } = setup()
    const config = loadConfig({ cwd: join(repo, "src"), env: {}, home })
    expect(config).toMatchObject({
      repoRoot: repo,
      model: "typesafe/jev-1.13",
      budget: { maxCalls: 200, maxUsd: 0.05 },
      egress: { consent: { granted: false }, exclude: [] },
      apiKey: undefined,
    })
  })

  it("layers user under repo under env", () => {
    const { repo, home } = setup(
      "concurrency: 4\nbudget: { maxUsd: 1 }\negress: { exclude: ['fixtures/**'] }\n",
      "concurrency: 2\nbudget: { maxCalls: 50 }\nmodel: typesafe/jev-1.13-20260917\negress: { exclude: ['**/*.log'] }\n",
    )
    const config = loadConfig({ cwd: repo, env: { SYSTEM1_MODEL: "typesafe/jev-1.13" }, home })
    expect(config.concurrency).toBe(4)
    expect(config.budget).toEqual({ maxCalls: 50, maxUsd: 1 })
    expect(config.model).toBe("typesafe/jev-1.13")
    expect(config.egress.exclude).toEqual(["**/*.log", "fixtures/**"])
  })

  it("ignores consent granted at user level (consent is per repo)", () => {
    const { repo, home } = setup(undefined, "egress: { consent: { granted: true } }\n")
    expect(loadConfig({ cwd: repo, env: {}, home }).egress.consent.granted).toBe(false)
  })

  it("rejects malformed files as config-error", () => {
    const { repo, home } = setup("egress: { consent: yes }\n")
    expect(() => loadConfig({ cwd: repo, env: {}, home })).toThrow(
      expect.objectContaining({ code: "config-error" }),
    )
    const other = setup("- just\n- a list\n")
    expect(() => loadConfig({ cwd: other.repo, env: {}, home: other.home })).toThrow(/mapping/)
  })

  it("adds config profiles with safe defaults", () => {
    const { repo, home } = setup(
      "profiles:\n  - { id: acme/judge-1, maxStateTokens: 8000, usdPerInputToken: 0.0000001, undecidedFloor: 0.2 }\n",
    )
    const [profile] = loadConfig({ cwd: repo, env: {}, home }).profiles
    expect(profile).toMatchObject({
      id: "acme/judge-1",
      transport: "openrouter-decisions",
      priceAsOf: "unknown",
    })
  })

  it("defaults maxChoices, and refuses one that isn't a whole number of at least 2", () => {
    const base =
      "{ id: acme/judge-1, maxStateTokens: 8000, usdPerInputToken: 0.0000001, undecidedFloor: 0.2"
    const ok = setup(`profiles:\n  - ${base} }\n`)
    expect(loadConfig({ cwd: ok.repo, env: {}, home: ok.home }).profiles[0]?.maxChoices).toBe(255)
    for (const bad of ['"x"', "null", "0", "1.5"]) {
      const b = setup(`profiles:\n  - ${base}, maxChoices: ${bad} }\n`)
      expect(() => loadConfig({ cwd: b.repo, env: {}, home: b.home }), bad).toThrow(/maxChoices/)
    }
  })

  describe("API key", () => {
    it("prefers the environment", () => {
      const { repo, home } = setup()
      expect(loadConfig({ cwd: repo, env: { OPENROUTER_API_KEY: "sk-env" }, home })).toMatchObject({
        apiKey: "sk-env",
        apiKeySource: "env",
      })
    })

    it("reads a mode-600 credentials file", () => {
      const { repo, home } = setup()
      const file = join(home, ".config/system1/credentials")
      writeTree(home, { ".config/system1/credentials": "openrouter_api_key: sk-file\n" })
      chmodSync(file, 0o600)
      expect(loadConfig({ cwd: repo, env: {}, home })).toMatchObject({
        apiKey: "sk-file",
        apiKeySource: "credentials",
      })
    })

    it.skipIf(process.platform === "win32")("refuses a credentials file others can read", () => {
      const { repo, home } = setup()
      writeTree(home, { ".config/system1/credentials": "openrouter_api_key: sk-file\n" })
      chmodSync(join(home, ".config/system1/credentials"), 0o644)
      expect(() => loadConfig({ cwd: repo, env: {}, home })).toThrow(/chmod 600/)
    })

    it("honours XDG_CONFIG_HOME", () => {
      const { repo } = setup()
      const xdg = temp({ "system1/config.yaml": "concurrency: 3\n" })
      expect(
        loadConfig({ cwd: repo, env: { XDG_CONFIG_HOME: xdg }, home: temp() }).concurrency,
      ).toBe(3)
    })
  })
})

describe("findRepoRoot", () => {
  it("walks up to .git or .system1, else stays put", () => {
    const repo = temp({ ".system1/config.yaml": "", "a/b/c.txt": "" })
    expect(findRepoRoot(join(repo, "a/b"))).toBe(repo)
  })
})

describe("consent", () => {
  it("grants into the repo config, preserving other content and comments", () => {
    const { repo, home } = setup("# keep me\nconcurrency: 4\n")
    setConsent(repo, true, "test", new Date("2026-09-22T00:00:00Z"))
    const text = readFileSync(join(repo, ".system1/config.yaml"), "utf8")
    expect(text).toContain("# keep me")
    expect(text).toContain("concurrency: 4")
    const config = loadConfig({ cwd: repo, env: {}, home })
    expect(config.egress.consent).toEqual({
      granted: true,
      at: "2026-09-22T00:00:00.000Z",
      by: "test",
    })
    expect(() => assertConsent(config.egress.consent, repo)).not.toThrow()
  })

  it("creates the config with an explanatory header, and can revoke", () => {
    const { repo, home } = setup()
    setConsent(repo, true)
    expect(readFileSync(join(repo, ".system1/config.yaml"), "utf8")).toMatch(/^# decisions/)
    setConsent(repo, false)
    const { consent } = loadConfig({ cwd: repo, env: {}, home }).egress
    expect(() => assertConsent(consent, repo)).toThrow(
      expect.objectContaining({ code: "egress-refused" }),
    )
  })

  it("explains how to consent when refusing", () => {
    expect(() => assertConsent({ granted: false }, "/r")).toThrow(/decide config egress allow/)
  })

  it("leaves unrelated files alone", () => {
    const { repo } = setup()
    writeFileSync(join(repo, "untouched"), "x")
    setConsent(repo, true)
    expect(readFileSync(join(repo, "untouched"), "utf8")).toBe("x")
  })
})
