import { describe, expect, it } from "vitest"
import {
  confidenceOf,
  isUndecided,
  noulConfidence,
  rankedProbabilities,
  undecidedNames,
} from "./answers.js"
import { projectCost, resolveProfile } from "./profiles.js"

describe("answers", () => {
  it("treats the live 0.38/0.40/0.22 case (confidence 0.09) as undecided", () => {
    expect(isUndecided({ type: "score", score: 0.84, probabilities: {}, confidence: 0.09 })).toBe(
      true,
    )
  })

  it("keeps a weakly held two-way contest (0.34) decided", () => {
    expect(isUndecided({ type: "choice", choice: "a", probabilities: {}, confidence: 0.34 })).toBe(
      false,
    )
  })

  it("maps noul distance from 0.5 onto 0–1", () => {
    expect(noulConfidence({ type: "noul", noul: 0.5 })).toBe(0)
    expect(noulConfidence({ type: "noul", noul: 0 })).toBe(1)
    expect(confidenceOf({ type: "noul", noul: 0.75 })).toBeCloseTo(0.5)
  })

  it("names undecided answers of every type", () => {
    const names = undecidedNames({
      flat: { type: "choice", choice: "a", probabilities: { a: 0.5, b: 0.5 }, confidence: 0 },
      coin: { type: "noul", noul: 0.52 },
      clear: { type: "noul", noul: 0.98 },
    })
    expect(names).toEqual(["flat", "coin"])
  })

  it("ranks a distribution highest first", () => {
    expect(rankedProbabilities({ a: 0.1, b: 0.7, c: 0.2 }).map((e) => e.key)).toEqual([
      "b",
      "c",
      "a",
    ])
  })
})

describe("profiles", () => {
  it("resolves the family profile for a dated build, keeping the requested id", () => {
    const profile = resolveProfile("typesafe/jev-1.13-20260917")
    expect(profile.id).toBe("typesafe/jev-1.13-20260917")
    expect(profile.maxStateTokens).toBe(32_000)
  })

  it("refuses unknown models with the known list", () => {
    expect(() => resolveProfile("someone/else")).toThrow(/Known: typesafe\/jev-1.13/)
    expect(() => resolveProfile("typesafe/jev-1.13-latest")).toThrow(/No profile/)
  })

  it("projects cost from the listed price, with the per-call overhead", () => {
    // 1000 calls × (700 + 250 overhead) tokens × $0.042 per million
    expect(projectCost(resolveProfile("typesafe/jev-1.13"), 1000, 700)).toBeCloseTo(0.0399)
  })
})
