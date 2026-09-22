import { DecisionsError } from "../errors.js"
import type { ModelProfile } from "../model/profiles.js"
import type { QuestionSet, State } from "../model/types.js"

/**
 * A deliberately conservative token estimate: about 3 characters per token.
 * Real tokenizers average nearer 4 for English and code, so this
 * over-estimates. That is the right direction for a limit check and a cost
 * projection.
 */
export const CHARS_PER_TOKEN = 3

export function estimateTokens(value: State | QuestionSet): number {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * @throws DecisionsError `state-too-large`. The state is never truncated,
 *   because a decision over half an input is a wrong decision.
 */
export function assertStateFits(
  id: string,
  state: State,
  questions: QuestionSet,
  profile: ModelProfile,
): number {
  const tokens = estimateTokens(state) + estimateTokens(questions)
  if (tokens > profile.maxStateTokens) {
    throw new DecisionsError(
      "state-too-large",
      `${id} is about ${tokens} tokens with its questions; ${profile.id} accepts ${profile.maxStateTokens}. ` +
        "Split it smaller (e.g. --split lines:200 or --split hunk).",
      { id, estimatedTokens: tokens, maxStateTokens: profile.maxStateTokens },
    )
  }
  return tokens
}
