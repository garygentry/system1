import { describe, expect, it } from "vitest"
import { resolveProfile } from "./model/profiles.js"
import { prepare } from "./prepare.js"
import { checkBudget, project } from "./run/budget.js"
import { useTempDirs } from "./testkit/tmp.js"

const temp = useTempDirs()
const profile = resolveProfile("typesafe/jev-1.13")
const questions = {
  relevant: { type: "noul" as const, instructions: "The file handles authentication." },
}

describe("prepare", () => {
  it("reads, splits, excludes, scrubs and projects, reporting everything withheld", async () => {
    const cwd = temp({
      "src/auth.ts": "export const login = () => {}\nconst API_SECRET = 'abcdefgh12345678'\n",
      "src/util.ts": "export const add = (a: number, b: number) => a + b\n",
      ".env": "OPENROUTER_API_KEY=sk-or-v1-whatever",
    })
    const prepared = await prepare({
      sources: [{ kind: "glob", patterns: ["**/*"] }],
      split: { kind: "file" },
      questions,
      profile,
      cwd,
    })
    expect(prepared.items.map((i) => i.id)).toEqual(["src/auth.ts", "src/util.ts"])
    expect(prepared.items[0]?.state).toContain("[REDACTED:assigned-secret]")
    expect(prepared.skipped).toEqual([{ path: ".env", reason: "excluded", detail: "**/.env" }])
    expect(prepared.redactions).toEqual({ total: 1, byKind: { "assigned-secret": 1 }, items: 1 })
    expect(prepared.projection).toMatchObject({
      basis: "projected",
      calls: 2,
      priceAsOf: "2026-09-19",
    })
    expect(prepared.projection.projectedUsd).toBeGreaterThan(0)
  })

  it("leaves out --exclude matches as filtered, apart from egress excludes", async () => {
    const cwd = temp({
      "src/a.ts": "export const a = 1\n",
      "src/a.test.ts": "test('a', () => {})\n",
      "fixtures/b.ts": "export const b = 2\n",
      ".env": "X=1",
    })
    const prepared = await prepare({
      sources: [
        { kind: "glob", patterns: ["**/*"] },
        { kind: "file", path: "fixtures/b.ts" },
      ],
      split: { kind: "file" },
      questions,
      profile,
      cwd,
      filter: ["**/*.test.ts", "fixtures/**"],
    })
    expect(prepared.items.map((i) => i.id)).toEqual(["src/a.ts"])
    expect(prepared.skipped).toEqual(
      expect.arrayContaining([
        { path: "src/a.test.ts", reason: "filtered", detail: "**/*.test.ts" },
        { path: "fixtures/b.ts", reason: "filtered", detail: "fixtures/**" },
        { path: ".env", reason: "excluded", detail: "**/.env" },
      ]),
    )
    expect(prepared.projection.calls).toBe(1)
  })

  it("labels a path both rules drop as excluded, and reports each path once (review of #10)", async () => {
    const cwd = temp({ "secrets/k.txt": "key", "src/a.test.ts": "t", "src/a.ts": "a" })
    const prepared = await prepare({
      sources: [
        { kind: "glob", patterns: ["**/*"] },
        { kind: "file", path: "src/a.test.ts" },
      ],
      split: { kind: "file" },
      questions,
      profile,
      cwd,
      filter: ["secrets/**", "src/a.test.ts"],
    })
    expect(prepared.items.map((i) => i.id)).toEqual(["src/a.ts"])
    expect(prepared.skipped).toHaveLength(2)
    expect(prepared.skipped).toEqual(
      expect.arrayContaining([
        { path: "secrets/k.txt", reason: "excluded", detail: "**/secrets/**" },
        { path: "src/a.test.ts", reason: "filtered", detail: "src/a.test.ts" },
      ]),
    )
  })

  it("skips an oversize item with the fix when asked, and throws by default", async () => {
    const cwd = temp({ "big.ts": "x ".repeat(200_000), "small.ts": "y" })
    const base = {
      sources: [{ kind: "glob" as const, patterns: ["*.ts"] }],
      split: { kind: "file" as const },
      questions,
      profile,
      cwd,
    }
    await expect(prepare(base)).rejects.toMatchObject({ code: "state-too-large" })
    const prepared = await prepare({ ...base, oversize: "skip" })
    expect(prepared.items.map((i) => i.id)).toEqual(["small.ts"])
    expect(prepared.skipped).toEqual([
      {
        path: "big.ts",
        reason: "too-large",
        detail: expect.stringMatching(/--split lines:400\/40$/),
      },
    ])
    expect(prepared.projection.calls).toBe(1)
  })

  it("validates the question set before reading anything", async () => {
    await expect(
      prepare({
        sources: [{ kind: "file", path: "missing" }],
        split: { kind: "file" },
        questions: {},
        profile,
        cwd: temp(),
      }),
    ).rejects.toMatchObject({ code: "invalid-request" })
  })
})

describe("budget", () => {
  const budget = { maxCalls: 200, maxUsd: 0.05 }

  it("adds the profile's per-call overhead to every call", () => {
    const projection = project(profile, [10, 20])
    expect(projection.estimatedInputTokens).toBe(30 + 2 * profile.callOverheadTokens)
    expect(projection.projectedUsd).toBe(projection.estimatedInputTokens * profile.usdPerInputToken)
  })

  it("passes within limits", () => {
    expect(() => checkBudget(project(profile, Array(200).fill(700)), budget, false)).not.toThrow()
  })

  it("stops above the call limit, handing back the projection", () => {
    const projection = project(profile, Array(201).fill(700))
    expect(() => checkBudget(projection, budget, false)).toThrow(
      expect.objectContaining({
        code: "budget-exceeded",
        details: expect.objectContaining({ projection }),
      }),
    )
  })

  it("stops above the dollar limit", () => {
    expect(() => checkBudget(project(profile, [2_000_000]), budget, false)).toThrow(
      /projected \$0\.0840 > \$0\.05/,
    )
  })

  it("lets an explicit confirmation through", () => {
    expect(() => checkBudget(project(profile, Array(500).fill(700)), budget, true)).not.toThrow()
  })

  it("refuses a choice with more options than the model accepts, before reading anything", async () => {
    const criteria = Object.fromEntries(
      Array.from({ length: 256 }, (_, i) => [`o${i}`, `Option ${i}`]),
    )
    await expect(
      prepare({
        sources: [{ kind: "text", text: "x" }],
        split: { kind: "file" },
        questions: { pick: { type: "choice", instructions: "Which?", criteria } },
        profile,
        cwd: temp(),
      }),
    ).rejects.toMatchObject({ code: "invalid-request", details: { options: 256, maxChoices: 255 } })
  })

  it("join: one state from every source, after excludes, each part headed by its id", async () => {
    const cwd = temp({ "a.ts": "alpha", "b.log": "beta", ".env.production": "SECRET=1" })
    const r = await prepare({
      sources: [{ kind: "glob", patterns: ["**/*"] }],
      split: { kind: "join" },
      questions,
      profile,
      cwd,
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]?.state).toBe("--- a.ts ---\nalpha\n\n--- b.log ---\nbeta")
    expect(r.skipped.map((s) => [s.path, s.reason])).toEqual([[".env.production", "excluded"]])
  })

  it("scrubs whole documents before splitting, so a key cut across lines is still caught", async () => {
    const pem = [
      "-----BEGIN PRIVATE KEY-----",
      "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
      "-----END PRIVATE KEY-----",
    ].join("\n")
    const cwd = temp({ "key.txt": pem })
    const r = await prepare({
      sources: [{ kind: "file", path: "key.txt" }],
      split: { kind: "row" },
      questions,
      profile,
      cwd,
    })
    expect(r.items.map((i) => i.state).join(" ")).not.toContain("BEGIN PRIVATE KEY")
    expect(r.redactions.byKind["private-key"]).toBe(1)
  })

  it("redacts a structured field whose name says it holds a secret", async () => {
    const cwd = temp({ "rows.jsonl": `${JSON.stringify({ password: "correct-horse-battery" })}\n` })
    const r = await prepare({
      sources: [{ kind: "jsonl", path: "rows.jsonl" }],
      split: { kind: "row" },
      questions,
      profile,
      cwd,
    })
    expect(JSON.stringify(r.items[0]?.state)).toContain("[REDACTED:assigned-secret]")
  })
})
