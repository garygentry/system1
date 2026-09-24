import { describe, expect, it } from "vitest"
import type { Answers, QuestionSet } from "../model/types.js"
import { matches, parseFilter, parseSort, project, verdictOf } from "./project.js"

const questions: QuestionSet = {
  relevant: { type: "noul", instructions: "x" },
  kind: { type: "choice", instructions: "x", criteria: { fix: "a", feature: "b", none: "c" } },
  risk: { type: "score", instructions: "x", criteria: ["a", "b", "c"] },
}
const answers = (relevant: number, kind: string, risk: number): Answers => ({
  relevant: { type: "noul", noul: relevant },
  kind: {
    type: "choice",
    choice: kind,
    probabilities: { fix: kind === "fix" ? 0.9 : 0.05, feature: 0.05, none: 0.05 },
    confidence: 0.8,
  },
  risk: { type: "score", score: risk, probabilities: {}, confidence: 0.7 },
})

const noul = (n: number) => ({ type: "noul" as const, noul: n })
const score = (n: number, confidence: number) => ({
  type: "score" as const,
  score: n,
  probabilities: {},
  confidence,
})

describe("parseFilter", () => {
  it.each([
    ["relevant>=0.7", { question: "relevant", field: "noul", op: ">=", value: 0.7 }],
    ["kind=fix", { question: "kind", field: "choice", op: "=", value: "fix" }],
    [
      "kind in fix, feature",
      { question: "kind", field: "choice", op: "in", value: ["fix", "feature"] },
    ],
    ["risk.score>1", { question: "risk", field: "score", op: ">", value: 1 }],
    [
      "kind.probabilities.fix>=0.5",
      { question: "kind", field: "probabilities.fix", op: ">=", value: 0.5 },
    ],
    ["risk != 2", { question: "risk", field: "score", op: "!=", value: 2 }],
  ])("parses %s", (text, expected) => {
    expect(parseFilter(text, questions)).toMatchObject(expected)
  })

  it("rejects unknown questions, bad syntax and non-numeric comparisons", () => {
    expect(() => parseFilter("nope>1", questions)).toThrow(/not in the question set/)
    expect(() => parseFilter("relevant", questions)).toThrow(/Cannot parse/)
    expect(() => parseFilter("kind>fix", questions)).toThrow(/needs a number/)
  })
})

describe("matches", () => {
  const a = answers(0.8, "fix", 1.5)
  it.each([
    ["relevant>=0.7", true],
    ["relevant<0.7", false],
    ["kind=fix", true],
    ["kind in feature,none", false],
    ["kind.probabilities.fix>=0.5", true],
    ["kind.confidence>0.5", true],
    ["risk>1", true],
    ["risk!=1.5", false],
  ])("%s → %s", (text, expected) => {
    expect(matches(a, parseFilter(text, questions))).toBe(expected)
  })
})

describe("project", () => {
  const rows = [
    { id: "a", answers: answers(0.9, "fix", 0) },
    { id: "b", answers: answers(0.3, "fix", 2) },
    { id: "c", answers: answers(0.75, "feature", 1) },
    { id: "d", answers: answers(0.5, "none", 1), flat: ["relevant"] },
    { id: "e", answers: answers(0.95, "none", 1), flat: ["kind"] },
  ]
  const undecidedOf = (r: (typeof rows)[number]) => r.flat ?? []

  it("routes undecided before thresholds, but only for referenced questions", () => {
    const out = project({ rows, keep: [parseFilter("relevant>=0.7", questions)], undecidedOf })
    expect(out.kept.map((r) => r.id)).toEqual(["a", "c", "e"]) // e is flat on kind, which keep ignores
    expect(out.undecided.map((u) => [u.row.id, u.questions])).toEqual([["d", ["relevant"]]])
    expect(out.dropped).toBe(1)
  })

  it("treats any flat answer as undecided when there is no keep", () => {
    expect(project({ rows, undecidedOf }).undecided.map((u) => u.row.id)).toEqual(["d", "e"])
  })

  it("sorts, limits (reporting the pre-limit total) and selects fields", () => {
    const out = project({
      rows,
      keep: [parseFilter("relevant>=0.7", questions)],
      sort: parseSort("relevant", questions),
      limit: 2,
      fields: ["relevant"],
      undecidedOf,
    })
    expect(out.kept.map((r) => r.id)).toEqual(["e", "a"])
    expect(out.keptTotal).toBe(3)
    expect(Object.keys(out.kept[0]?.answers ?? {})).toEqual(["relevant"])
  })

  it("sorts choices by confidence and supports ascending", () => {
    expect(parseSort("kind", questions)).toEqual({
      question: "kind",
      field: "confidence",
      direction: "desc",
    })
    const out = project({ rows, sort: parseSort("risk:asc", questions), undecidedOf: () => [] })
    expect(out.kept.map((r) => r.id)).toEqual(["a", "c", "d", "e", "b"])
  })

  it("counts the question `sort` ranks by, not only the ones `keep` filters on", () => {
    const questions = {
      relevant: { type: "noul" as const, instructions: "r" },
      risk: { type: "score" as const, instructions: "x", criteria: ["a", "b", "c"] },
    }
    const rows = [
      { id: "certain", answers: { relevant: noul(0.9), risk: score(0.2, 0.9) }, flat: [] },
      { id: "uncertain", answers: { relevant: noul(0.9), risk: score(1.1, 0.05) }, flat: ["risk"] },
    ]
    const out = project({
      rows,
      keep: [parseFilter("relevant>=0.7", questions)],
      sort: parseSort("risk:desc", questions),
      limit: 1,
      undecidedOf: (r) => r.flat,
    })
    expect(out.kept.map((r) => r.id)).toEqual(["certain"])
    expect(out.undecided.map((u) => u.row.id)).toEqual(["uncertain"])
  })
})

describe("verdictOf with keepAny", () => {
  const qs: QuestionSet = {
    a: { type: "noul", instructions: "x" },
    b: { type: "noul", instructions: "x" },
    test: { type: "noul", instructions: "x" },
  }
  const n = (a: number, b: number, test = 0.05): Answers => ({
    a: { type: "noul", noul: a },
    b: { type: "noul", noul: b },
    test: { type: "noul", noul: test },
  })
  const any = [parseFilter("a>=0.3", qs), parseFilter("b>=0.3", qs)]
  const all = [parseFilter("test<0.7", qs)]

  it("keeps on any decided match, even when another keepAny answer is flat", () => {
    expect(verdictOf(n(0.9, 0.5), ["b"], [], any)).toEqual({ verdict: "kept", questions: [] })
  })

  it("is undecided only when a flat keepAny answer could still change the outcome", () => {
    expect(verdictOf(n(0.05, 0.5), ["b"], [], any)).toEqual({
      verdict: "undecided",
      questions: ["b"],
    })
    expect(verdictOf(n(0.05, 0.1), [], [], any)).toEqual({ verdict: "dropped", questions: [] })
  })

  it("applies keep first: a decided keep failure drops, a flat keep answer is undecided", () => {
    expect(verdictOf(n(0.9, 0.9, 0.95), [], all, any).verdict).toBe("dropped")
    expect(verdictOf(n(0.9, 0.9, 0.5), ["test"], all, any)).toEqual({
      verdict: "undecided",
      questions: ["test"],
    })
  })

  it("leaves projection unchanged without keepAny", () => {
    const rows = [{ answers: n(0.9, 0.1) }, { answers: n(0.1, 0.1) }]
    const out = project({ rows, keepAny: any, undecidedOf: () => [] })
    expect(out.kept).toHaveLength(1)
    expect(out.dropped).toBe(1)
  })
})
