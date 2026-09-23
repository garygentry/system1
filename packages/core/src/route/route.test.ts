import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"
import { useTempDirs, writeTree } from "../testkit/tmp.js"
import { runRoute } from "../tools/route.js"
import { BUILTIN_TRIGGERS, ROUTE_DEFAULTS, type RouteConfig, route } from "./route.js"

const cfg = (over: Partial<RouteConfig> = {}): RouteConfig => ({ ...ROUTE_DEFAULTS, ...over })

// The tuning set. The held-out set (routing-holdout.yaml) is deliberately not
// read here: it judges the triggers, so they must not be fitted to it.
const tuning = parse(
  readFileSync(join(import.meta.dirname, "../../../../tools/evals/routing.yaml"), "utf8"),
) as { ask: { positive: string[]; negative: string[] } }

describe("built-in triggers on the tuning set", () => {
  it.each(tuning.ask.positive)("hints: %s", (prompt) => {
    expect(route(prompt, cfg()).matched).toBe(true)
  })
  it.each(tuning.ask.negative)("stays quiet: %s", (prompt) => {
    expect(route(prompt, cfg()).triggers).toEqual([])
  })
})

describe("near misses stay quiet", () => {
  it.each([
    "Check the build passes before I commit.",
    "Is the dev server done starting?",
    "Route all /api requests to the new handler.",
    "Add a --verbose flag to every command.",
    "List every test file under src/.",
    "Write acceptance criteria for the export feature.",
    "Review what changed in the last commit and summarise it.",
    "Sort these lines alphabetically.",
    "Fix the failing test in test-output.log.",
  ])("%s", (prompt) => {
    expect(route(prompt, cfg()).triggers).toEqual([])
  })
})

describe("route", () => {
  const prompt = "Triage every CI failure in failures.jsonl."

  it("names the triggers in the hint", () => {
    const r = route(prompt, cfg())
    expect(r.triggers.map((t) => t.name)).toEqual(["batch-judgement"])
    expect(r.message).toContain("(batch-judgement)")
    expect(r.message).toContain("system1:ask")
  })

  it("enabled: false never hints", () => {
    expect(route(prompt, cfg({ enabled: false }))).toEqual({
      enabled: false,
      matched: false,
      triggers: [],
    })
  })

  it("disable drops a built-in; an unknown name is a config error", () => {
    expect(route(prompt, cfg({ disable: ["batch-judgement"] })).matched).toBe(false)
    expect(() => route(prompt, cfg({ disable: ["nope"] }))).toThrow(/unknown built-in/)
  })

  it("builtin: false leaves only config triggers", () => {
    const own = cfg({
      builtin: false,
      triggers: [{ name: "pr", pattern: "\\breview (this|the) PR\\b" }],
    })
    expect(route(prompt, own).matched).toBe(false)
    expect(route("Please REVIEW THE PR for style", own)).toMatchObject({
      matched: true,
      triggers: [{ name: "pr", source: "config", text: "REVIEW THE PR" }],
    })
  })

  it("ignore vetoes a match, and says which pattern did", () => {
    const r = route(prompt, cfg({ ignore: ["\\bCI\\b"] }))
    expect(r).toMatchObject({ matched: false, ignoredBy: "\\bCI\\b" })
    expect(r.triggers).toHaveLength(1)
  })

  it("a user opting out in words is ignored by default", () => {
    expect(route(`${prompt} Don't use System 1 for this.`, cfg()).matched).toBe(false)
  })

  it("message replaces the hint and expands {triggers}", () => {
    expect(route(prompt, cfg({ message: "use ask ({triggers})" })).message).toBe(
      "use ask (batch-judgement)",
    )
  })

  it("an invalid pattern is a config error even when disabled", () => {
    const bad = cfg({ enabled: false, ignore: ["(unclosed"] })
    expect(() => route(prompt, bad)).toThrow(/route.ignore: invalid regular expression/)
  })

  it("every built-in compiles and has a unique name", () => {
    expect(new Set(BUILTIN_TRIGGERS.map((t) => t.name)).size).toBe(BUILTIN_TRIGGERS.length)
    for (const t of BUILTIN_TRIGGERS) expect(() => new RegExp(t.pattern, "i")).not.toThrow()
  })
})

describe("runRoute (config layers)", () => {
  const temp = useTempDirs()

  it("merges user and repo route config, and SYSTEM1_ROUTE=off wins", () => {
    const repo = temp({ ".git/HEAD": "x" })
    const home = temp()
    writeTree(home, {
      ".config/system1/config.yaml":
        "route:\n  message: from user\n  triggers:\n    - { name: u, pattern: 'zebra' }\n",
    })
    writeTree(repo, {
      ".system1/config.yaml":
        "route:\n  message: from repo {triggers}\n  triggers:\n    - { name: r, pattern: 'giraffe' }\n",
    })
    const r = runRoute({ cwd: repo, env: {}, home }, { prompt: "zebra and giraffe" })
    expect(r.triggers.map((t) => t.name)).toEqual(["u", "r"])
    expect(r.message).toBe("from repo u, r")
    expect(r.files.repo).toBe(join(repo, ".system1/config.yaml"))
    const off = runRoute({ cwd: repo, env: { SYSTEM1_ROUTE: "off" }, home }, { prompt: "zebra" })
    expect(off.enabled).toBe(false)
  })

  it("rejects unknown keys and malformed triggers", () => {
    const repo = temp({ ".git/HEAD": "x", ".system1/config.yaml": "route:\n  enable: false\n" })
    expect(() => runRoute({ cwd: repo, env: {}, home: temp() }, { prompt: "x" })).toThrow(
      /unknown route key\(s\) enable/,
    )
    const repo2 = temp({
      ".git/HEAD": "x",
      ".system1/config.yaml": "route:\n  triggers: [{ name: a }]\n",
    })
    expect(() => runRoute({ cwd: repo2, env: {}, home: temp() }, { prompt: "x" })).toThrow(
      /needs a name and a pattern/,
    )
  })

  it("rejects input without a prompt", () => {
    const repo = temp({ ".git/HEAD": "x" })
    expect(() => runRoute({ cwd: repo, env: {}, home: temp() }, {})).toThrow(/Invalid route input/)
  })
})
