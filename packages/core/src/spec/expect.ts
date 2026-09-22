import { DecisionsError } from "../errors.js"
import type { Answer, Question, QuestionSet } from "../model/types.js"
import { type Filter, matches, parseFilter } from "../project/project.js"

/**
 * What an example expects of one question. Written in a spec's
 * `examples[].expect`:
 *
 *   noul:    true | false          compared at 0.5
 *   choice:  <option key>          compared with the winner
 *   score:   <level> | [lo, hi]    the weighted mean rounds to the level, or lies in the range
 *   any:     ">=0.7", "in a,b" …   the `--keep` shorthand, applied to this question
 *   any:     undecided             the answer should be too flat to act on
 */
export type Expectation =
  | { kind: "noul"; value: boolean }
  | { kind: "choice"; value: string }
  | { kind: "level"; value: number }
  | { kind: "range"; lo: number; hi: number }
  | { kind: "filter"; filter: Filter }
  | { kind: "undecided" }

const OPERATOR = /^\s*(>=|<=|!=|>|<|=|in\s)/

/** Parse one example's `expect` map against its questions, collecting every problem. */
export function parseExpect(
  expect: Record<string, unknown>,
  questions: QuestionSet,
  where: string,
): Record<string, Expectation> {
  const out: Record<string, Expectation> = {}
  const problems: string[] = []
  for (const [name, raw] of Object.entries(expect)) {
    const question = questions[name]
    if (!question) {
      problems.push(`${where}: expects "${name}", which is not a question in this spec`)
      continue
    }
    try {
      out[name] = parseOne(name, question, raw)
    } catch (error) {
      problems.push(`${where}: ${(error as Error).message}`)
    }
  }
  if (problems.length > 0) {
    throw new DecisionsError("invalid-request", problems.join("\n"), { problems })
  }
  return out
}

function parseOne(name: string, question: Question, raw: unknown): Expectation {
  if (raw === "undecided") return { kind: "undecided" }
  if (typeof raw === "string" && OPERATOR.test(raw)) {
    return {
      kind: "filter",
      filter: parseFilter(`${name}${raw.startsWith("in") ? " " : ""}${raw}`, { [name]: question }),
    }
  }
  switch (question.type) {
    case "noul":
      if (typeof raw === "boolean") return { kind: "noul", value: raw }
      break
    case "choice":
      if (typeof raw === "string") {
        if (!(raw in question.criteria)) {
          throw new Error(
            `expects "${name}" to be "${raw}", which is not one of its options (${Object.keys(question.criteria).join(", ")})`,
          )
        }
        return { kind: "choice", value: raw }
      }
      break
    case "score": {
      const top = question.criteria.length - 1
      if (Number.isInteger(raw) && (raw as number) >= 0 && (raw as number) <= top) {
        return { kind: "level", value: raw as number }
      }
      if (Array.isArray(raw) && raw.length === 2) {
        const [lo, hi] = raw as unknown[]
        if (typeof lo === "number" && typeof hi === "number" && lo <= hi) {
          return { kind: "range", lo, hi }
        }
      }
      throw new Error(`expects "${name}" to be a level 0–${top} or a [lo, hi] range`)
    }
  }
  throw new Error(
    `expects "${name}" to be ${JSON.stringify(raw)}; a ${question.type} takes ${question.type === "noul" ? "true or false" : "an option key"}, "undecided", or a filter such as ">=0.7"`,
  )
}

/** Whether an answer meets an expectation. Undecided answers are handled by the caller. */
export function meets(name: string, answer: Answer, expectation: Expectation): boolean {
  switch (expectation.kind) {
    case "undecided":
      return false
    case "filter":
      return matches({ [name]: answer }, expectation.filter)
    case "noul":
      return answer.type === "noul" && answer.noul >= 0.5 === expectation.value
    case "choice":
      return answer.type === "choice" && answer.choice === expectation.value
    case "level":
      return answer.type === "score" && Math.round(answer.score) === expectation.value
    case "range":
      return (
        answer.type === "score" && answer.score >= expectation.lo && answer.score <= expectation.hi
      )
  }
}

/** The expectation as written, for reports. */
export function describeExpectation(expectation: Expectation): string {
  switch (expectation.kind) {
    case "undecided":
      return "undecided"
    case "filter":
      return expectation.filter.source
    case "range":
      return `[${expectation.lo}, ${expectation.hi}]`
    default:
      return String(expectation.value)
  }
}
