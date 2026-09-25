import { chmodSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { JEV_CALL_OVERHEAD_TOKENS, resolveProfile } from "../model/profiles.js"
import { useTempDirs, writeTree } from "../testkit/tmp.js"
import { assertConsent, setConsent } from "./consent.js"
import { allProfiles, findRepoRoot, loadConfig } from "./load.js"

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

  it("defaults callOverheadTokens to Jev's, and refuses one that isn't a whole number", () => {
    const base =
      "{ id: acme/judge-1, maxStateTokens: 8000, usdPerInputToken: 0.0000001, undecidedFloor: 0.2"
    const ok = setup(`profiles:\n  - ${base} }\n`)
    const [profile] = loadConfig({ cwd: ok.repo, env: {}, home: ok.home }).profiles
    expect(profile?.callOverheadTokens).toBe(JEV_CALL_OVERHEAD_TOKENS)
    const empty = setup(`profiles:\n  - ${base}, callOverheadTokens: }\n`)
    expect(loadConfig({ cwd: empty.repo, env: {}, home: empty.home }).profiles[0]).toMatchObject({
      callOverheadTokens: JEV_CALL_OVERHEAD_TOKENS,
    })
    const zero = setup(`profiles:\n  - ${base}, callOverheadTokens: 0 }\n`)
    expect(loadConfig({ cwd: zero.repo, env: {}, home: zero.home }).profiles[0]).toMatchObject({
      callOverheadTokens: 0,
    })
    for (const bad of ['"x"', "-1", "1.5"]) {
      const b = setup(`profiles:\n  - ${base}, callOverheadTokens: ${bad} }\n`)
      expect(() => loadConfig({ cwd: b.repo, env: {}, home: b.home }), bad).toThrow(
        /callOverheadTokens/,
      )
    }
  })

  it("defaults maxChoices, and refuses one that isn't a whole number of at least 2", () => {
    const base =
      "{ id: acme/judge-1, maxStateTokens: 8000, usdPerInputToken: 0.0000001, undecidedFloor: 0.2"
    const ok = setup(`profiles:\n  - ${base} }\n`)
    expect(loadConfig({ cwd: ok.repo, env: {}, home: ok.home }).profiles[0]?.maxChoices).toBe(255)
    const empty = setup(`profiles:\n  - ${base}, maxChoices: }\n`)
    expect(loadConfig({ cwd: empty.repo, env: {}, home: empty.home }).profiles[0]?.maxChoices).toBe(
      255,
    )
    for (const bad of ['"x"', "0", "1.5"]) {
      const b = setup(`profiles:\n  - ${base}, maxChoices: ${bad} }\n`)
      expect(() => loadConfig({ cwd: b.repo, env: {}, home: b.home }), bad).toThrow(/maxChoices/)
    }
  })

  it("has no warnings for a clean config", () => {
    const { repo, home } = setup("concurrency: 4\nbudget: { maxUsd: 1 }\n")
    expect(loadConfig({ cwd: repo, env: {}, home }).warnings).toEqual([])
  })

  it("ignores unknown keys and bad values, but warns about each with its file", () => {
    const { repo, home } = setup(
      [
        "concurency: 4",
        'concurrency: "4"',
        "timeoutMs: 0",
        "model: 7",
        "budget: { maxUsd: -1, maxCals: 5 }",
        "egress: { exclud: [x] }",
      ].join("\n"),
      "concurrency: 2.5\nbudget: nope\n",
    )
    const config = loadConfig({ cwd: repo, env: {}, home })
    expect(config.concurrency).toBe(8)
    expect(config.timeoutMs).toBe(5_000)
    expect(config.budget).toEqual({ maxCalls: 200, maxUsd: 0.05 })
    const repoFile = join(repo, ".system1/config.yaml")
    const userFile = join(home, ".config/system1/config.yaml")
    expect(config.warnings).toEqual(
      expect.arrayContaining([
        `${repoFile}: unknown key concurency`,
        `${repoFile}: concurrency must be a whole number of at least 1 (ignored)`,
        `${repoFile}: timeoutMs must be a number above 0 (ignored)`,
        `${repoFile}: model must be text (ignored)`,
        `${repoFile}: budget.maxUsd must be a number of at least 0 (ignored)`,
        `${repoFile}: unknown key budget.maxCals`,
        `${repoFile}: unknown key egress.exclud`,
        `${userFile}: concurrency must be a whole number of at least 1 (ignored)`,
        `${userFile}: budget must be a mapping (ignored)`,
      ]),
    )
    expect(config.warnings).toHaveLength(9)
  })

  it("warns about a bad value in a layer that loses, and treats an empty key as unset", () => {
    const { repo, home } = setup(
      "concurrency: 4\nmodel:\nbudget:\n",
      "concurrency: 2.5\negress: nope\negress2: 1\n",
    )
    const config = loadConfig({ cwd: repo, env: {}, home })
    expect(config.concurrency).toBe(4)
    const userFile = join(home, ".config/system1/config.yaml")
    expect(config.warnings).toEqual([
      `${userFile}: unknown key egress2`,
      `${userFile}: egress must be a mapping (ignored)`,
      `${userFile}: concurrency must be a whole number of at least 1 (ignored)`,
    ])
  })

  it("warns about consent in the user file, and an endpoint that isn't a URL", () => {
    const { repo, home } = setup(
      "endpoint: openrouter.ai/api/alpha/decisions\n",
      "egress: { consent: { granted: true } }\n",
    )
    const config = loadConfig({ cwd: repo, env: {}, home })
    expect(config.endpoint).toMatch(/^https:\/\//)
    expect(config.warnings).toEqual([
      expect.stringMatching(/egress.consent is read only from the repo file/),
      expect.stringMatching(/endpoint must be an http\(s\) URL \(ignored\)$/),
    ])
  })

  it("refuses .inf for a budget, which JSON output could not show", () => {
    const { repo, home } = setup("budget: { maxUsd: .inf }\n")
    const config = loadConfig({ cwd: repo, env: {}, home })
    expect(config.budget.maxUsd).toBe(0.05)
    expect(config.warnings).toEqual([expect.stringMatching(/budget.maxUsd must be a number/)])
  })

  it("treats empty lists, consent and profile fields as unset", () => {
    const { repo, home } = setup(
      "egress: { consent:, exclude: }\nprofiles:\n",
      "profiles:\n  - { id: acme/judge-1, maxStateTokens: 8000, usdPerInputToken: 0, undecidedFloor: 0.2, priceAsOf: }\n",
    )
    const config = loadConfig({ cwd: repo, env: {}, home })
    expect(config.egress).toEqual({ consent: { granted: false }, exclude: [] })
    expect(config.profiles[0]?.priceAsOf).toBe("unknown")
    expect(config.warnings).toEqual([])
  })

  it("accepts any http(s) URL as an endpoint, and nothing else", () => {
    for (const [endpoint, ok] of [
      ["http://localhost:8080/api/v1/decisions", true],
      ["HTTPS://openrouter.ai/api/alpha/decisions", true],
      ["https://open router.ai/x", false],
      ["ftp://example.test/x", false],
    ] as const) {
      const { repo, home } = setup(`endpoint: "${endpoint}"\n`)
      expect(loadConfig({ cwd: repo, env: {}, home }).warnings, endpoint).toHaveLength(ok ? 0 : 1)
    }
  })

  it("drops unknown profile fields with a warning, so they are never shown or used", () => {
    const { repo, home } = setup(
      "profiles:\n  - { id: acme/judge-1, maxStateTokens: 8000, usdPerInputToken: 0.0000001, undecidedFloor: 0.2, apiKey: sk-secret }\n",
    )
    const config = loadConfig({ cwd: repo, env: {}, home })
    expect(config.profiles[0]).not.toHaveProperty("apiKey")
    expect(config.warnings).toEqual([
      expect.stringMatching(/unknown key profiles\[0\]\.apiKey \(ignored\)$/),
    ])
    expect(JSON.stringify(config.warnings)).not.toContain("sk-secret")
  })

  it("warns about an unknown profile field even when it has no value", () => {
    const { repo, home } = setup(
      "profiles:\n  - { id: acme/judge-1, maxStateTokens: 8000, usdPerInputToken: 0.0000001, undecidedFloor: 0.2, maxChoice: }\n",
    )
    expect(loadConfig({ cwd: repo, env: {}, home }).warnings).toEqual([
      expect.stringMatching(/unknown key profiles\[0\]\.maxChoice \(ignored\)$/),
    ])
  })

  it("lets a config profile replace a built-in of the same id, repo over user", () => {
    const profile = (floor: number) =>
      `profiles:\n  - { id: typesafe/jev-1.13, maxStateTokens: 8000, usdPerInputToken: 0.0000001, undecidedFloor: ${floor} }\n`
    const { repo, home } = setup(profile(0.4), profile(0.3))
    const all = allProfiles(loadConfig({ cwd: repo, env: {}, home }))
    const jev = all.filter((p) => p.id === "typesafe/jev-1.13")
    expect(jev).toHaveLength(1)
    expect(jev[0]?.undecidedFloor).toBe(0.4)
    expect(resolveProfile("typesafe/jev-1.13", all).undecidedFloor).toBe(0.4)
    // A dated build resolves to the overriding profile too.
    expect(resolveProfile("typesafe/jev-1.13-20260917", all)).toMatchObject({
      id: "typesafe/jev-1.13-20260917",
      undecidedFloor: 0.4,
    })
    // Still first: an override keeps the built-in's place in the list.
    expect(all[0]?.id).toBe("typesafe/jev-1.13")
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

    describe("strips one matching pair of quotes", () => {
      const fromEnv = (value: string) => {
        const { repo, home } = setup()
        return loadConfig({ cwd: repo, env: { OPENROUTER_API_KEY: value }, home })
      }

      it.each([
        ['"sk-env"', "double quotes"],
        ["'sk-env'", "single quotes"],
        ['  "sk-env" ', "quotes inside whitespace"],
        ['" sk-env "', "whitespace inside quotes"],
      ])("%s (%s)", (value) => {
        expect(fromEnv(value)).toMatchObject({
          apiKey: "sk-env",
          apiKeySource: "env",
          apiKeyQuoted: true,
        })
      })

      it("leaves an unquoted key alone and says so", () => {
        expect(fromEnv("sk-env")).toMatchObject({ apiKey: "sk-env", apiKeyQuoted: false })
      })

      it.each([
        ['"sk-env', "a lone leading quote"],
        ["sk-env'", "a lone trailing quote"],
        ["\"sk-env'", "mismatched quotes"],
      ])("leaves %s unchanged (%s)", (value) => {
        expect(fromEnv(value)).toMatchObject({ apiKey: value, apiKeyQuoted: false })
      })

      it("strips only the outer pair", () => {
        expect(fromEnv(`"'sk-env'"`)).toMatchObject({ apiKey: "'sk-env'", apiKeyQuoted: true })
      })

      it.each(['""', "''", '" "', "'  '"])(
        "counts %s as no key, falling through to the credentials file",
        (value) => {
          const { repo, home } = setup()
          writeTree(home, { ".config/system1/credentials": "openrouter_api_key: sk-file\n" })
          chmodSync(join(home, ".config/system1/credentials"), 0o600)
          expect(loadConfig({ cwd: repo, env: { OPENROUTER_API_KEY: value }, home })).toMatchObject(
            { apiKey: "sk-file", apiKeySource: "credentials", apiKeyQuoted: false },
          )
          const bare = setup()
          expect(
            loadConfig({ cwd: bare.repo, env: { OPENROUTER_API_KEY: value }, home: bare.home }),
          ).toMatchObject({ apiKey: undefined, apiKeySource: undefined, apiKeyQuoted: false })
        },
      )

      it.each(["sk-a b", "sk-a\nb", '"sk-a\tb"', "sk-é"])(
        "refuses %j without echoing it",
        (value) => {
          const { repo, home } = setup()
          const load = () => loadConfig({ cwd: repo, env: { OPENROUTER_API_KEY: value }, home })
          expect(load).toThrow(/OPENROUTER_API_KEY contains a space, line break/)
          try {
            load()
          } catch (error) {
            expect(String(error)).not.toContain("sk-a")
            expect(String(error)).not.toContain("sk-é")
          }
        },
      )

      it("in the credentials file", () => {
        const { repo, home } = setup()
        const file = join(home, ".config/system1/credentials")
        // YAML removes one layer; the inner quotes are part of the string it reads.
        writeTree(home, { ".config/system1/credentials": `openrouter_api_key: "'sk-file'"\n` })
        chmodSync(file, 0o600)
        expect(loadConfig({ cwd: repo, env: {}, home })).toMatchObject({
          apiKey: "sk-file",
          apiKeySource: "credentials",
          apiKeyQuoted: true,
        })
      })
    })

    it("refuses a malformed credentials file without quoting the key", () => {
      const { repo, home } = setup()
      const file = join(home, ".config/system1/credentials")
      writeTree(home, { ".config/system1/credentials": 'openrouter_api_key: "sk-SECRET\n' })
      chmodSync(file, 0o600)
      const load = () => loadConfig({ cwd: repo, env: {}, home })
      expect(load).toThrow(/is not a valid YAML mapping/)
      expect(() => load()).not.toThrow(/SECRET/)
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

  it("explains how the user consents, and that an agent must not", () => {
    let message = ""
    try {
      assertConsent({ granted: false }, "/r")
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain("`decide config egress allow`")
    expect(message).toContain("--confirm")
    expect(message).toMatch(/an agent must not grant it/)
    expect(message).toMatch(/shell escape \(not as a chat message\)/)
    // Agents read this. In a shell, `! cmd` runs cmd, so never hand them that form.
    expect(message).not.toContain("! decide")
  })

  it("leaves unrelated files alone", () => {
    const { repo } = setup()
    writeFileSync(join(repo, "untouched"), "x")
    setConsent(repo, true)
    expect(readFileSync(join(repo, "untouched"), "utf8")).toBe("x")
  })
})
