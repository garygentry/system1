import { ProviderError } from "../errors.js"
import type { DecisionRequest, DecisionResponse } from "../model/types.js"
import { parseDecisionResponse } from "../model/validate.js"

export const DEFAULT_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"

export const DEFAULT_TIMEOUT_MS = 5_000

/** Statuses worth another attempt: timeouts, rate limits and upstream hiccups. */
export const RETRY_STATUSES: ReadonlySet<number> = new Set([
  408, 429, 500, 502, 503, 504, 520, 521, 522, 524,
])

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
}

export interface Transport {
  decide(request: DecisionRequest, signal?: AbortSignal): Promise<TransportResult>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The `openrouter-decisions` transport: POSTs one decision request, with retry,
 * exponential backoff, a timeout per attempt and caller abort, and validates
 * the body strictly before anything downstream trusts it.
 */
export function createOpenRouterTransport(options: TransportOptions): Transport {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const backoffMs = options.backoffMs ?? 400
  const doFetch = options.fetch ?? fetch
  const sleep = options.sleep ?? defaultSleep

  return {
    async decide(request, signal) {
      const startedAt = performance.now()
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        // One timeout per attempt, linked to the caller's signal so an abort
        // cancels the in-flight fetch rather than being ignored.
        const timeout = AbortSignal.timeout(timeoutMs)
        const composite = signal ? AbortSignal.any([signal, timeout]) : timeout
        const last = attempt === maxAttempts
        const wait = () => sleep(backoffMs * 2 ** (attempt - 1))

        let response: Response
        try {
          response = await doFetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://github.com/garygentry/system1",
              "X-Title": "system1",
            },
            body: JSON.stringify(request),
            signal: composite,
          })
        } catch (error) {
          // A caller abort means the answer is no longer wanted: not retried.
          if (signal?.aborted) throw error
          if (last) {
            throw new ProviderError(
              "provider-unreachable",
              `Could not reach ${endpoint}: ${describe(error)}`,
            )
          }
          await wait()
          continue
        }

        if (!response.ok) {
          const detail = (await response.text()).slice(0, 500)
          if (!RETRY_STATUSES.has(response.status) || last) {
            throw new ProviderError(
              "provider-http",
              `${endpoint} returned ${response.status}: ${detail}`,
              response.status,
            )
          }
          await wait()
          continue
        }

        let raw: unknown
        try {
          raw = await response.json()
        } catch {
          throw new ProviderError(
            "malformed-response",
            `${endpoint} returned a body that is not JSON`,
          )
        }
        return {
          response: parseDecisionResponse(raw, request.questions, request.model),
          latencyMs: Math.round(performance.now() - startedAt),
          attempts: attempt,
        }
      }
      // Unreachable: the last attempt always returns or throws.
      throw new ProviderError("provider-unreachable", `Could not reach ${endpoint}`)
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
