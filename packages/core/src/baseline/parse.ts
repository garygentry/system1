/**
 * Reading an emulated baseline's reply. A chat model returns one value per
 * question, not a calibrated distribution, so a baseline answer carries no
 * `probabilities` and no `confidence`, and never becomes an `Answer`: it can't
 * reach thresholds, `project()` or a gate.
 *
 * **Strict:** a choice must be an offered key, a score an integer level in
 * range, a noul a number in 0–1. Anything else is a parse failure, counted by
 * the caller and never repaired into an answer (`jev-poc` rounded scores and
 * clamped nouls; that would flatter or damn the baseline by accident).
 */
import type { Question, QuestionSet } from "../model/types.js"

export type BaselineAnswer =
  | { type: "choice"; choice: string }
  | { type: "score"; score: number }
  | { type: "noul"; noul: number }

export type BaselineAnswers = Record<string, BaselineAnswer>

export class BaselineParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BaselineParseError"
  }
}

/** The model's object as answers, or `BaselineParseError` naming the first field that failed. */
export function parseBaseline(raw: unknown, questions: QuestionSet): BaselineAnswers {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new BaselineParseError("the reply was not a JSON object")
  const object = raw as Record<string, unknown>
  // The model named this key, so it isn't quoted: it could carry anything.
  if (Object.keys(object).some((k) => !Object.hasOwn(questions, k)))
    throw new BaselineParseError("the reply has a field that wasn't asked")
  const answers: BaselineAnswers = {}
  for (const [name, question] of Object.entries(questions)) {
    const value = Object.hasOwn(object, name) ? object[name] : undefined
    if (value === undefined || value === null) throw new BaselineParseError(`"${name}" is missing`)
    answers[name] = parseBaselineValue(name, question, value)
  }
  return answers
}

/**
 * One single value as the answer to `question`, strictly: an offered key, an
 * integer level in range, or a probability in 0–1. Anything else is a
 * `BaselineParseError` naming the question, never a repaired answer.
 */
export function parseBaselineValue(
  name: string,
  question: Question,
  value: unknown,
): BaselineAnswer {
  switch (question.type) {
    case "choice":
      if (typeof value !== "string" || !Object.hasOwn(question.criteria, value))
        throw new BaselineParseError(`"${name}" is not an offered option`)
      return { type: "choice", choice: value }
    case "score":
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > question.criteria.length - 1
      )
        throw new BaselineParseError(
          `"${name}" is not a level from 0 to ${question.criteria.length - 1}`,
        )
      return { type: "score", score: value + 0 }
    case "noul":
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
        throw new BaselineParseError(`"${name}" is not a probability from 0 to 1`)
      return { type: "noul", noul: value + 0 }
  }
}
