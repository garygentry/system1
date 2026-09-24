import type { Budget } from "../config/load.js"
import { DecisionsError } from "../errors.js"
import type { ModelProfile } from "../model/profiles.js"

/** A cost figure computed before running. Always labelled; never shown as measured. */
export interface Projection {
  basis: "projected"
  calls: number
  estimatedInputTokens: number
  projectedUsd: number
  /** Listed-price date the projection used. */
  priceAsOf: string
}

/**
 * @param tokensPerCall the estimated state-plus-questions tokens of each call;
 *   the profile's per-call overhead is added to every one.
 */
export function project(profile: ModelProfile, tokensPerCall: readonly number[]): Projection {
  const estimatedInputTokens = tokensPerCall.reduce(
    (sum, tokens) => sum + tokens + profile.callOverheadTokens,
    0,
  )
  return {
    basis: "projected",
    calls: tokensPerCall.length,
    estimatedInputTokens,
    projectedUsd: estimatedInputTokens * profile.usdPerInputToken,
    priceAsOf: profile.priceAsOf,
  }
}

/**
 * The spend guard (decision 0011): above either limit, stop and hand back the
 * projection unless the caller explicitly confirmed.
 *
 * @throws DecisionsError `budget-exceeded`, with the projection in `details`.
 */
export function checkBudget(projection: Projection, budget: Budget, confirmed: boolean): void {
  if (confirmed) return
  const over: string[] = []
  if (projection.calls > budget.maxCalls)
    over.push(`${projection.calls} calls > ${budget.maxCalls}`)
  if (projection.projectedUsd > budget.maxUsd) {
    over.push(`projected $${projection.projectedUsd.toFixed(4)} > $${budget.maxUsd}`)
  }
  if (over.length === 0) return
  throw new DecisionsError(
    "budget-exceeded",
    `Over the spend guard (${over.join("; ")}). Narrow the source, or re-run with --confirm to proceed.`,
    { projection, budget },
  )
}
