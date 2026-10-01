import { ProviderError } from "../errors.js"
import type { DecisionRequest, DecisionResponse } from "../model/types.js"
import { parseDecisionResponse, responseUsage } from "../model/validate.js"
import { postJson, withUncounted } from "./post.js"

export { RETRY_STATUSES, untilAborted } from "./post.js"

export const DEFAULT_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"

export const DEFAULT_TIMEOUT_MS = 5_000

export interface TransportOptions {
  /** OpenRouter's decisions endpoint. An alpha path, so overridable. */
  endpoint?: string
  apiKey: string
  /**
   * Per attempt, not per call. Default 5 s: a normal decision call measured
   * 225–650 ms, but upstream occasionally stalls a request with no response at
   * all (seen live, 2026-09-22). The old 30 s default turned one stall into a
   * 30 s fan-out; a timeout sized to the model makes a stall cost one retry.
   */
  timeoutMs?: number
  maxAttempts?: number
  /** First backoff; doubles on each retry. */
  backoffMs?: number
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export interface TransportResult {
  response: DecisionResponse
  /** Measured round trip across all attempts. */
  latencyMs: number
  attempts: number
  /**
   * Attempts that may have been billed at a cost nobody reported: earlier ones
   * (see `postJson`), and this one when its usage was unreadable. Optional so a
   * custom transport needn't track it.
   */
  uncounted?: number
}

export interface Transport {
  decide(request: DecisionRequest, signal?: AbortSignal): Promise<TransportResult>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The `openrouter-decisions` transport: POSTs one decision request, with retry,
 * exponential backoff, a timeout per attempt and caller abort, and validates
 * the body strictly before anything downstream trusts it. A body that fails
 * validation is still paid for: its usage travels on the error (`spent`).
 */
export function createOpenRouterTransport(options: TransportOptions): Transport {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  return {
    async decide(request, signal) {
      const { raw, latencyMs, attempts, uncounted } = await postJson({
        endpoint,
        apiKey: options.apiKey,
        body: JSON.stringify(request),
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxAttempts: Math.max(1, options.maxAttempts ?? 3),
        backoffMs: options.backoffMs ?? 400,
        fetch: options.fetch ?? fetch,
        sleep: options.sleep ?? defaultSleep,
        signal,
        quoteErrorBody: true,
        describe,
      })
      let response: DecisionResponse
      try {
        response = parseDecisionResponse(raw, request.questions, request.model)
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error
        // The 200 itself counts as uncounted when its usage is unreadable too.
        const usage = responseUsage(raw)
        const all = uncounted + (usage.reported === false ? 1 : 0)
        throw new ProviderError(error.code as "malformed-response", error.message, undefined, {
          usage: withUncounted(usage, all),
          uncounted: all,
        })
      }
      const all = uncounted + (response.usage.reported === false ? 1 : 0)
      return {
        response: { ...response, usage: withUncounted(response.usage, all) },
        latencyMs,
        attempts,
        uncounted: all,
      }
    },
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message
  }
  return String(error)
}
