import { DecisionsError, ProviderError } from "../errors.js"
import type { Answer, Answers, DecisionResponse, QuestionSet, Usage } from "./types.js"

/**
 * Reject a malformed question set before it costs a call.
 *
 * @throws DecisionsError `invalid-request`, listing every problem found.
 */
export function assertQuestionSet(questions: unknown): asserts questions is QuestionSet {
  const problems: string[] = []
  if (!isObject(questions) || Object.keys(questions).length === 0) {
    throw new DecisionsError(
      "invalid-request",
      "questions must be a non-empty object of named questions",
    )
  }
  for (const [name, q] of Object.entries(questions)) {
    if (!isObject(q)) {
      problems.push(`${name}: must be an object`)
      continue
    }
    if (typeof q.instructions !== "string" || q.instructions.trim() === "") {
      problems.push(`${name}: instructions must be a non-empty string`)
    }
    switch (q.type) {
      case "choice":
        if (!isObject(q.criteria) || Object.keys(q.criteria).length < 2) {
          problems.push(
            `${name}: choice criteria must map at least two option keys to descriptions`,
          )
        } else if (!Object.values(q.criteria).every((v) => typeof v === "string")) {
          problems.push(`${name}: choice criteria values must be strings`)
        }
        break
      case "score":
        if (
          !Array.isArray(q.criteria) ||
          q.criteria.length < 2 ||
          !q.criteria.every((c) => typeof c === "string")
        ) {
          problems.push(`${name}: score criteria must be a list of at least two level descriptions`)
        }
        break
      case "noul":
        if (
          q.criteria !== undefined &&
          (!isObject(q.criteria) ||
            typeof q.criteria.true !== "string" ||
            typeof q.criteria.false !== "string")
        ) {
          problems.push(`${name}: noul criteria, when given, must be {true: string, false: string}`)
        }
        break
      default:
        problems.push(`${name}: type must be choice, score or noul (got ${JSON.stringify(q.type)})`)
    }
  }
  if (problems.length > 0) {
    throw new DecisionsError(
      "invalid-request",
      `Invalid question set:\n  ${problems.join("\n  ")}`,
      { problems },
    )
  }
}

/**
 * Validate a decisions-endpoint body against the request it answers.
 *
 * Stricter than "has answers": every question asked must come back, as the
 * type it was asked as, with correctly typed fields. A 2xx that fails this is
 * still a provider failure, so it surfaces as `malformed-response` and never as
 * a partial result.
 */
export function parseDecisionResponse(
  raw: unknown,
  questions: QuestionSet,
  requestedModel: string,
): DecisionResponse {
  if (!isObject(raw)) throw malformed("body is not a JSON object", raw)
  if (!isObject(raw.answers)) throw malformed("body has no answers object", raw)

  const answers: Answers = {}
  for (const [name, question] of Object.entries(questions)) {
    const answer = raw.answers[name]
    if (answer === undefined) throw malformed(`question "${name}" was not answered`, raw)
    if (!isObject(answer) || answer.type !== question.type) {
      throw malformed(
        `answer "${name}" should be type ${question.type}, got ${JSON.stringify(isObject(answer) ? answer.type : answer)}`,
        raw,
      )
    }
    answers[name] = checkAnswer(name, answer, raw)
  }

  const usage = raw.usage
  return {
    model: typeof raw.model === "string" ? raw.model : requestedModel,
    answers,
    usage: isObject(usage) ? checkUsage(usage) : { input_tokens: 0, output_tokens: 0, cost: 0 },
    ...(typeof raw.id === "string" ? { id: raw.id } : {}),
    ...(typeof raw.provider === "string" ? { provider: raw.provider } : {}),
  }
}

function checkAnswer(name: string, a: Record<string, unknown>, raw: unknown): Answer {
  const bad = (field: string) => malformed(`answer "${name}" has an invalid ${field}`, raw)
  switch (a.type) {
    case "choice":
      if (typeof a.choice !== "string") throw bad("choice")
      if (!isDistribution(a.probabilities)) throw bad("probabilities")
      if (!isUnit(a.confidence)) throw bad("confidence")
      return {
        type: "choice",
        choice: a.choice,
        probabilities: a.probabilities,
        confidence: a.confidence,
      }
    case "score":
      if (typeof a.score !== "number" || !Number.isFinite(a.score)) throw bad("score")
      if (!isDistribution(a.probabilities)) throw bad("probabilities")
      if (!isUnit(a.confidence)) throw bad("confidence")
      return {
        type: "score",
        score: a.score,
        probabilities: a.probabilities,
        confidence: a.confidence,
        ...(isObject(a.legend) ? { legend: a.legend as Record<string, string> } : {}),
      }
    case "noul":
      if (!isUnit(a.noul)) throw bad("noul")
      return { type: "noul", noul: a.noul }
    default:
      throw bad("type")
  }
}

function checkUsage(u: Record<string, unknown>): Usage {
  return {
    input_tokens: finiteOrZero(u.input_tokens),
    output_tokens: finiteOrZero(u.output_tokens),
    cost: finiteOrZero(u.cost),
  }
}

function malformed(reason: string, raw: unknown): ProviderError {
  const preview = JSON.stringify(raw)?.slice(0, 300) ?? String(raw)
  return new ProviderError(
    "malformed-response",
    `Malformed decision response: ${reason}. Body: ${preview}`,
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

function isDistribution(value: unknown): value is Record<string, number> {
  return isObject(value) && Object.keys(value).length > 0 && Object.values(value).every(isUnit)
}

function finiteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}
