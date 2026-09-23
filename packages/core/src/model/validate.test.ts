import { describe, expect, it } from "vitest"
import { DecisionsError, ProviderError } from "../errors.js"
import { guardrailQuestions, guardrailResponse } from "../testdata/index.js"
import { assertQuestionSet, parseDecisionResponse } from "./validate.js"

const MODEL = "typesafe/jev-1.13"

describe("parseDecisionResponse (real recorded output)", () => {
  it("accepts a genuine Jev response and keeps its metadata", () => {
    const parsed = parseDecisionResponse(guardrailResponse(), guardrailQuestions(), MODEL)
    expect(parsed.model).toBe("typesafe/jev-1.13-20260917")
    expect(parsed.answers.blast_radius).toMatchObject({
      type: "choice",
      choice: "read_only",
      confidence: 1,
    })
    expect(parsed.answers.reversibility).toMatchObject({ type: "score", score: 0 })
    expect(parsed.answers.touches_secrets).toEqual({ type: "noul", noul: 0.05 })
    expect(parsed.usage).toEqual({ input_tokens: 685, output_tokens: 148, cost: 2.877e-5 })
    expect(parsed.id).toMatch(/^gen-dec-/)
  })

  it("drops answers nobody asked for", () => {
    const raw = guardrailResponse()
    ;(raw.answers as Record<string, unknown>).extra = { type: "noul", noul: 1 }
    expect(
      Object.keys(parseDecisionResponse(raw, guardrailQuestions(), MODEL).answers),
    ).not.toContain("extra")
  })

  type Answers = Record<string, Record<string, unknown>>
  const set = (name: string, field: string, value: unknown) => (a: Answers) => {
    ;(a[name] as Record<string, unknown>)[field] = value
  }
  const broken: Array<[string, (answers: Answers) => void]> = [
    ["a missing answer", (a) => delete a.network_egress],
    ["a type mismatch", set("touches_secrets", "type", "choice")],
    ["a noul outside 0–1", set("touches_secrets", "noul", 1.5)],
    ["a non-numeric confidence", set("blast_radius", "confidence", "high")],
    ["an empty distribution", set("blast_radius", "probabilities", {})],
    ["a non-finite score", set("reversibility", "score", null)],
  ]
  it.each(broken)("rejects %s as malformed-response", (_, mutate) => {
    const raw = guardrailResponse()
    mutate(raw.answers as Answers)
    const attempt = () => parseDecisionResponse(raw, guardrailQuestions(), MODEL)
    expect(attempt).toThrow(ProviderError)
    try {
      attempt()
    } catch (error) {
      expect((error as ProviderError).code).toBe("malformed-response")
    }
  })

  it("rejects bodies without answers", () => {
    expect(() => parseDecisionResponse({ error: "nope" }, guardrailQuestions(), MODEL)).toThrow(
      /no answers/,
    )
    expect(() => parseDecisionResponse("text", guardrailQuestions(), MODEL)).toThrow(
      /not a JSON object/,
    )
  })

  it("falls back to the requested model, and marks omitted usage as not reported", () => {
    const raw = guardrailResponse()
    delete raw.model
    delete raw.usage
    const parsed = parseDecisionResponse(raw, guardrailQuestions(), MODEL)
    expect(parsed.model).toBe(MODEL)
    // Zeroes mean "unknown" here, never "free": `reported: false` says so.
    expect(parsed.usage).toEqual({ input_tokens: 0, output_tokens: 0, cost: 0, reported: false })
  })

  it("marks usage as not reported when a field is missing or unreadable", () => {
    const raw = guardrailResponse()
    raw.usage = { input_tokens: 10, cost: "free" }
    expect(parseDecisionResponse(raw, guardrailQuestions(), MODEL).usage).toEqual({
      input_tokens: 10,
      output_tokens: 0,
      cost: 0,
      reported: false,
    })
  })
})

describe("assertQuestionSet", () => {
  it("accepts the real guardrail set", () => {
    expect(() => assertQuestionSet(guardrailQuestions())).not.toThrow()
  })

  it("refuses an unknown key in a question, such as a misspelled criteria", () => {
    expect(() =>
      assertQuestionSet({
        q: { type: "noul", instructions: "Is it?", critera: { true: "a", false: "b" } },
      }),
    ).toThrow(/q: unknown key\(s\) critera/)
  })

  it("reports every problem at once, as invalid-request", () => {
    try {
      assertQuestionSet({
        a: { type: "choice", instructions: "x", criteria: { only: "one option" } },
        b: { type: "score", instructions: "", criteria: ["one"] },
        c: { type: "maybe", instructions: "x" },
        d: { type: "noul", instructions: "x", criteria: { true: "yes" } },
      })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(DecisionsError)
      expect((error as DecisionsError).code).toBe("invalid-request")
      expect((error as DecisionsError).details.problems).toHaveLength(5)
    }
  })

  it("rejects an empty set", () => {
    expect(() => assertQuestionSet({})).toThrow(/non-empty/)
  })
})
