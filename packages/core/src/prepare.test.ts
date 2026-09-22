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
})
