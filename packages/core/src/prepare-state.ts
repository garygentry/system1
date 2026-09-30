/**
 * The state-level entry point (M11, 0020): one in-memory state made safe to
 * send. Kept apart from `prepare()` so code that only holds states in memory,
 * like the runtime for adopted code, doesn't load the source readers.
 */
import { type ScrubCounts, scrubState } from "./egress/scrub.js"
import { assertStateFits } from "./egress/size.js"
import { DecisionsError } from "./errors.js"
import type { ModelProfile } from "./model/profiles.js"
import type { QuestionSet, State } from "./model/types.js"
import { assertQuestionSet, assertStateShape } from "./model/validate.js"

export interface PreparedState {
  /** Scrubbed, and within the profile's size limit with its questions. */
  state: State
  /** Estimated input tokens, state plus questions: what a call would project. */
  tokens: number
  /** How many secret-shaped strings were replaced. */
  redactions: number
}

/**
 * One in-memory state, made safe to send: scrubbed, then sized against the
 * profile with its questions. The state-level entry point for code that holds
 * its content in memory, such as an adopted policy module (M11, 0020). There
 * is no path, so excludes can't apply. A state that doesn't fit is refused
 * with `state-too-large`, never cut short.
 */
export function prepareState(
  state: State,
  options: { questions: QuestionSet; profile: ModelProfile; id?: string },
): PreparedState {
  assertQuestionSet(options.questions)
  assertChoicesFit(options.questions, options.profile)
  assertStateShape(state)
  const counts: ScrubCounts = {}
  const safe = scrubState(state, counts)
  // Again on what will be sent: a `toJSON` can turn an object into anything.
  assertStateShape(safe)
  const tokens = assertStateFits(options.id ?? "state", safe, options.questions, options.profile)
  return { state: safe, tokens, redactions: Object.values(counts).reduce((a, b) => a + b, 0) }
}

/** Refused before any call, so a fan-out never fails N times on the same limit. */
export function assertChoicesFit(questions: QuestionSet, profile: ModelProfile): void {
  for (const [name, q] of Object.entries(questions)) {
    if (q.type !== "choice") continue
    const n = Object.keys(q.criteria).length
    if (n > profile.maxChoices) {
      throw new DecisionsError(
        "invalid-request",
        `Question "${name}" has ${n} options; ${profile.id} accepts at most ${profile.maxChoices}. Narrow the candidates first (e.g. screen them with a noul), then pick among the survivors.`,
        { question: name, options: n, maxChoices: profile.maxChoices },
      )
    }
  }
}
