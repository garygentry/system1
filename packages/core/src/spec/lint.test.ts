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
      d: { type: "noul", instructions: "The ticket is older than 7 days." },
      i: { type: "noul", instructions: "The screenshot shows an error dialog." },
    })
    expect(findings.map((f) => [f.question, f.check, f.message])).toEqual([
      ["n", "unsupported-task", '"n" asks for counting or arithmetic ("more than 3")'],
      ["d", "unsupported-task", '"d" asks for dates ("older than 7 days")'],
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

  it("doesn't flag well-posed questions that merely name a date, image or number (review of #10)", () => {
    for (const instructions of [
      "The Dockerfile pins its base image to a digest.",
      "The component renders an image without alt text.",
      "The function validates the date format of its input.",
      "The code checks token expiry before using the token.",
      "The package supports Node versions older than 18.",
      "The function accepts any number of arguments.",
      "The tax is a percentage of the subtotal.",
      "The loop counts the retries and gives up after the limit.",
      "Consider only the added lines. The change alters error handling.",
      "Is the error swallowed? Answer true if the catch block neither rethrows nor logs.",
      "The letter is addressed to Mr. Smith as a customer.",
      "The code calls https://api.example.com. without TLS pinning.",
    ]) {
      expect(lintQuestions({ q: { type: "noul", instructions } }), instructions).toEqual([])
    }
    const choice = { fix: "a fix", other_change: "Any other change" }
    expect(
      checks({ c: { type: "choice", instructions: "The kind of change.", criteria: choice } }),
    ).toEqual([])
  })

  it("catches counting, dates and exact facts phrased as criteria (review of #10)", () => {
    for (const text of [
      "All tests pass",
      "Merged before Friday",
      "The file is longer than 300 lines",
      "The commit was made before 2024",
      "The function takes over 5 parameters",
      "Changed within the last 30 days",
      "Coverage is above 80 percent",
      "Count TODO comments",
    ]) {
      expect(
        lintStatement(text).map((f) => f.check),
        text,
      ).toEqual(["unsupported-task"])
    }
  })

  it("asks only numeric keeps for a threshold", () => {
    const findings = lintSpec({
      questions: {
        kind: {
          type: "choice",
          instructions: "The kind.",
          criteria: { fix: "a fix", none: "None" },
        },
      },
      keep: ["kind=fix", "kind in fix,none"],
    })
    expect(findings).toEqual([])
  })

  it("lints a bare statement for unsupported tasks only", () => {
    expect(lintStatement("The README explains how to install the CLI.")).toEqual([])
    expect(lintStatement("Ship it before Friday, dated today").map((f) => f.check)).toEqual([
      "unsupported-task",
    ])
  })

  it("gives every check a severity, and only certain checks are errors", () => {
    expect(Object.keys(LINT_SEVERITY).sort()).toEqual([...LINT_CHECKS].sort())
    expect(LINT_CHECKS.filter((c) => LINT_SEVERITY[c] === "error")).toEqual(["unknown-threshold"])
  })
})
