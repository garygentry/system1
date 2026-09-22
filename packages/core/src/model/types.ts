/**
 * The decision-model wire contract, verified against OpenRouter's decisions
 * endpoint:
 *
 *     POST https://openrouter.ai/api/alpha/decisions
 *     {"model": "typesafe/jev-1.13", "state": ..., "questions": {...}}
 *
 * A decision model does not generate text. You send one `state` and a map of
 * named `questions`, and every question is answered against that same state,
 * in one request, with typed, calibrated answers. `/chat/completions` rejects
 * these models outright; they are served on their own path.
 *
 * The names are model-neutral on purpose: Jev is the first model with this
 * calling convention, not the only one (decision 0003).
 */

/** Anything JSON-shaped. A bare string or a structured object both work. */
export type State = string | Record<string, unknown> | unknown[]

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/**
 * One of a fixed set of options. `criteria` maps each option key to when it
 * applies. Always include a no-match option: the model cannot choose a value
 * you never offered, so without one it is forced to pick among wrong answers.
 */
export interface ChoiceQuestion {
  type: "choice"
  instructions: string
  criteria: Record<string, string>
}

/**
 * A position along a dimension you define. `criteria` is an ordered list of
 * levels, and **levels are 0-indexed**: three criteria are levels 0, 1 and 2, so
 * a score of 1.5 sits between the middle and top level. Describe each level as
 * a concrete situation ("a workaround exists"), not a degree ("medium").
 */
export interface ScoreQuestion {
  type: "score"
  instructions: string
  criteria: string[]
}

/**
 * Whether a proposition holds, as a probability. Optional `true`/`false`
 * criteria sharpen the boundary when the proposition is at all ambiguous.
 */
export interface NoulQuestion {
  type: "noul"
  instructions: string
  criteria?: { true: string; false: string }
}

export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion
export type QuestionType = Question["type"]

/** Named questions, all answered against one state in one request. */
export type QuestionSet = Record<string, Question>

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export interface ChoiceAnswer {
  type: "choice"
  /** The winning option key. */
  choice: string
  /** Distribution over every option key, summing to about 1. */
  probabilities: Record<string, number>
  /** How concentrated the distribution is. See `isUndecided`. */
  confidence: number
}

export interface ScoreAnswer {
  type: "score"
  /** Probability-weighted mean level. Can land between levels. */
  score: number
  /** Distribution over levels. Keys are strings ("0", "1", ...), not numbers. */
  probabilities: Record<string, number>
  /** Level index to its criterion text, string-keyed for the same reason. */
  legend?: Record<string, string>
  confidence: number
}

export interface NoulAnswer {
  type: "noul"
  /** Probability the proposition holds, 0–1. 0.5 means "cannot tell". */
  noul: number
}

export type Answer = ChoiceAnswer | ScoreAnswer | NoulAnswer
export type Answers = Record<string, Answer>

export interface Usage {
  input_tokens: number
  output_tokens: number
  /** Upstream-reported cost in USD. Output tokens are free on Jev. */
  cost: number
  /**
   * False when the provider reported no usage (or an unreadable one), so the
   * zeroes above are "unknown", not "free". Absent means reported.
   */
  reported?: boolean
}

/** What the decisions endpoint returns, after validation. */
export interface DecisionResponse {
  /** The model build that actually served the call, e.g. `typesafe/jev-1.13-20260917`. */
  model: string
  answers: Answers
  usage: Usage
  /** Upstream generation id, when present. */
  id?: string
  provider?: string
}

export interface DecisionRequest {
  model: string
  state: State
  questions: QuestionSet
}
