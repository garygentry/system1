import type { Answer, Answers, ChoiceAnswer, NoulAnswer, ScoreAnswer } from "./types.js"

/**
 * The default confidence at or below which a choice or score answer means
 * nothing. Profiles carry their own floor; this is Jev's.
 *
 * **Calibrated against live output, and wrong at first.** It started at 0.05,
 * tuned on hand-written fixtures. Live Jev returned 0.09 for a three-level score
 * spread 0.38 / 0.40 / 0.22, which is about as undecided as an answer gets, and
 * it cleared a 0.05 floor. Thresholds tuned on invented data don't transfer.
 *
 * Not the same as a weakly held answer: 0.34 on a genuine two-way contest (0.51
 * against 0.49) is a decided answer held weakly. Per-branch gates in policy code
 * handle that.
 */
export const DEFAULT_UNDECIDED_FLOOR = 0.15

/** A flat distribution: never act on the top option. */
export function isUndecided(
  answer: ChoiceAnswer | ScoreAnswer,
  floor = DEFAULT_UNDECIDED_FLOOR,
): boolean {
  return answer.confidence <= floor
}

/**
 * A noul's distance from a coin flip, mapped onto 0–1 so it reads beside choice
 * and score confidences. Derived here; the model returns no noul confidence.
 */
export function noulConfidence(answer: NoulAnswer): number {
  return Math.abs(answer.noul - 0.5) * 2
}

/** Confidence of any answer on one 0–1 scale. */
export function confidenceOf(answer: Answer): number {
  return answer.type === "noul" ? noulConfidence(answer) : answer.confidence
}

/**
 * Names of the answers that are undecided. A noul is undecided when it sits
 * within `floor / 2` of 0.5, which keeps the same 0–1 confidence scale.
 */
export function undecidedNames(answers: Answers, floor = DEFAULT_UNDECIDED_FLOOR): string[] {
  return Object.entries(answers)
    .filter(([, answer]) => confidenceOf(answer) <= floor)
    .map(([name]) => name)
}

/** Distribution entries, highest probability first. */
export function rankedProbabilities(
  probabilities: Record<string, number>,
): Array<{ key: string; probability: number }> {
  return Object.entries(probabilities)
    .map(([key, probability]) => ({ key, probability }))
    .sort((a, b) => b.probability - a.probability)
}

export const isChoice = (answer: Answer): answer is ChoiceAnswer => answer.type === "choice"
export const isScore = (answer: Answer): answer is ScoreAnswer => answer.type === "score"
export const isNoul = (answer: Answer): answer is NoulAnswer => answer.type === "noul"
