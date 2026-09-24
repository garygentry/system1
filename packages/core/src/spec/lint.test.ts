import { describe, expect, it } from "vitest"
import type { QuestionSet } from "../model/types.js"
import { LINT_CHECKS, LINT_SEVERITY, lintQuestions, lintSpec, lintStatement } from "./lint.js"

const checks = (questions: QuestionSet) => lintQuestions(questions).map((f) => f.check)

describe("lint", () => {
  it("passes a well-posed set", () => {
    expect(
      lintQuestions({
        kind: {
          type: "choice",
          instructions: "What kind of change the commit makes.",
          criteria: { fix: "fixes a bug", feature: "adds behaviour", none: "None of these" },
        },
        risk: {
          type: "score",
          instructions: "How far a mistake in this change would reach.",
          criteria: [
            "affects one non-critical file",
            "affects one feature",
            "affects every request",
          ],
        },
        auth: {
          type: "noul",
          instructions: "The file reads or writes session tokens.",
          criteria: { true: "it handles tokens", false: "it never touches them" },
        },
      }),
    ).toEqual([])
  })

  it("flags a choice with no way out, and accepts one in the key or the description", () => {
    const q = (criteria: Record<string, string>) => ({
      c: { type: "choice" as const, instructions: "Pick the area this touches.", criteria },
    })
    expect(checks(q({ ui: "the UI", api: "the API" }))).toEqual(["no-way-out"])
    expect(checks(q({ ui: "the UI", api: "the API", other: "something else" }))).toEqual([])
    expect(checks(q({ ui: "the UI", x: "None of these apply" }))).toEqual([])
  })

  it("flags adjective score levels but not situations", () => {
    const q = (criteria: string[]) => ({
      s: { type: "score" as const, instructions: "How severe the bug is.", criteria },
    })
    expect(checks(q(["low", "medium", "high"]))).toEqual(["abstract-levels"])
    expect(checks(q(["cosmetic only", "breaks one feature", "loses user data"]))).toEqual([])
  })

  it("flags counting, dates and images wherever they appear, once per kind", () => {
    const findings = lintQuestions({
      n: {
        type: "noul",
        instructions: "The function has more than 3 callers.",
        criteria: { true: "more than 3 callers", false: "fewer than 4" },
      },
      d: { type: "noul", instructions: "The ticket is older than a week." },
      i: { type: "noul", instructions: "The screenshot shows an error dialog." },
    })
    expect(findings.map((f) => [f.question, f.check, f.message])).toEqual([
      ["n", "unsupported-task", '"n" asks for counting or arithmetic ("more than 3")'],
      ["d", "unsupported-task", '"d" asks for dates ("older than")'],
      ["i", "unsupported-task", '"i" asks for images ("screenshot")'],
    ])
  })

  it("flags two sentences, and/or, and either…or, but not a plain and", () => {
    const q = (instructions: string) => ({ m: { type: "noul" as const, instructions } })
    expect(checks(q("The file handles auth. It also logs secrets."))).toEqual(["merged-question"])
    expect(checks(q("The file reads and/or writes the cache."))).toEqual(["merged-question"])
    expect(checks(q("Either the goal is unclear or material is missing."))).toEqual([
      "merged-question",
    ])
    expect(checks(q("The command reads and writes files in the repo."))).toEqual([])
    expect(checks(q("The file calls fetch, e.g. for the API."))).toEqual([])
  })

  it("checks a spec's thresholds: unknown names are errors, unjustified keeps warn", () => {
    const questions: QuestionSet = {
      a: { type: "noul", instructions: "The file touches billing." },
      b: { type: "noul", instructions: "The file has tests." },
    }
    const findings = lintSpec({
      questions,
      keep: ["a>=0.7", "b<0.5", "b!=0"],
      policy: {
        thresholds: { a: { value: 0.7, why: "a miss costs more" }, c: { value: 1, why: "x" } },
      },
    })
    expect(findings.map((f) => [f.check, f.severity, f.question])).toEqual([
      ["unknown-threshold", "error", undefined],
      ["unjustified-threshold", "warning", "b"],
    ])
  })

  it("lints a bare statement for unsupported tasks only", () => {
    expect(lintStatement("All tests pass. The README is updated.")).toEqual([])
    expect(lintStatement("Ship it before Friday, dated today").map((f) => f.check)).toEqual([
      "unsupported-task",
    ])
  })

  it("gives every check a severity, and only certain checks are errors", () => {
    expect(Object.keys(LINT_SEVERITY).sort()).toEqual([...LINT_CHECKS].sort())
    expect(LINT_CHECKS.filter((c) => LINT_SEVERITY[c] === "error")).toEqual(["unknown-threshold"])
  })
})
