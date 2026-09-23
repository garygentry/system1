import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parse } from "yaml"
import { main } from "../packages/cli/src/main.js"
import { adopt, COOKBOOK, recipeNames } from "./cookbook.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface Recipe {
  questions: Record<string, { type: string }>
  policy?: { thresholds?: Record<string, { value: number; why: string }> }
  meta?: { threshold_basis?: string }
  examples?: Array<{ id: string; expect?: Record<string, unknown> }>
}

const load = (name: string) => parse(readFileSync(join(COOKBOOK, `${name}.yaml`), "utf8")) as Recipe

/** Replay a recipe in a fresh repo, adopted the way the docs tell a user to. */
async function check(name: string) {
  const repo = mkdtempSync(join(tmpdir(), "cookbook-"))
  const home = mkdtempSync(join(tmpdir(), "cookbook-home-"))
  dirs.push(repo, home)
  adopt(name, repo)
  const out: string[] = []
  // No key and no consent: this must work offline, from the fixtures alone.
  const code = await main(["spec", "check", name], {
    out: (t) => out.push(t),
    err: () => {},
    env: {},
    cwd: repo,
    home,
  })
  return { code, envelope: JSON.parse(out.at(-1) ?? "null") }
}

const names = recipeNames()

describe("cookbook", () => {
  it("has recipes", () => {
    expect(names.length).toBeGreaterThanOrEqual(6)
  })

  describe.each(names)("%s", (name) => {
    const recipe = load(name)

    it("says where each threshold comes from, and why", () => {
      expect(["calibration", "unmeasured"]).toContain(recipe.meta?.threshold_basis)
      for (const q of Object.keys(recipe.questions)) {
        expect(recipe.policy?.thresholds?.[q]?.why, `${q} threshold`).toBeTruthy()
      }
      // Calibration covers noul only (docs/calibration.md).
      const types = Object.values(recipe.questions).map((q) => q.type)
      if (types.some((t) => t !== "noul")) expect(recipe.meta?.threshold_basis).toBe("unmeasured")
    })

    it("has a clear yes, a clear no and a borderline case with no expect", () => {
      const examples = recipe.examples ?? []
      expect(examples.some((e) => !e.expect)).toBe(true)
      for (const [q, { type }] of Object.entries(recipe.questions)) {
        const expected = examples.map((e) => e.expect?.[q]).filter((v) => v !== undefined)
        if (type === "noul") {
          expect(expected, q).toContain(true)
          expect(expected, q).toContain(false)
        } else {
          expect(new Set(expected).size, q).toBeGreaterThanOrEqual(2)
        }
      }
    })

    it("passes on replay, and each clear case falls on its side of the threshold", async () => {
      const { code, envelope } = await check(name)
      expect(code).toBe(0)
      expect(envelope.result).toMatchObject({ source: "replay", passed: true })
      expect(envelope.result.counts).toMatchObject({ fail: 0, undecided: 0, withheld: 0 })
      // `expect: true|false` compares at 0.5. The recipe's own keep line must
      // agree, or a clear "no" would be kept by the filter it ships with.
      for (const example of recipe.examples ?? []) {
        const got = envelope.result.examples.find((e: { id: string }) => e.id === example.id)
        for (const [q, want] of Object.entries(example.expect ?? {})) {
          const line = recipe.policy?.thresholds?.[q]?.value
          if (typeof want !== "boolean" || line === undefined) continue
          const noul = got.answers[q].noul as number
          expect(noul >= line, `${example.id} ${q}=${noul} vs ${line}`).toBe(want)
        }
      }
    })
  })
})
