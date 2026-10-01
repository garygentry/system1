import { ProviderError, type Spent } from "../errors.js"
import type { Usage } from "../model/types.js"

/**
 * Statuses worth another attempt: timeouts, rate limits and upstream hiccups.
 * 529 is the provider's `system_overloaded`, seen on 2.9% of a 385-item sweep.
 */
export const RETRY_STATUSES: ReadonlySet<number> = new Set([
  408, 429, 500, 502, 503, 504, 520, 521, 522, 524, 529,
])

/**
 * Could an attempt that ended in `status` have run, and been billed? A refusal
 * (a 4xx other than 408, a 503 unavailable, a 529 overloaded) never ran; a
 * server-side timeout or a gateway failure may have, after the model answered.
 */
export function mayHaveRun(status: number): boolean {
  if (status >= 500) return status !== 503 && status !== 529
  return status === 408
}

/** Network failures that mean the request never left: nothing was billed. */
const NEVER_SENT = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
])

function neverSent(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } })?.cause
  const code = typeof cause?.code === "string" ? cause.code : undefined
  const message = typeof cause?.message === "string" ? cause.message : ""
  return (code !== undefined && NEVER_SENT.has(code)) || NEVER_SENT.has(message)
}

/** Nothing measured, and at least one attempt that may have been billed. */
export const UNKNOWN_COST: Usage = { input_tokens: 0, output_tokens: 0, cost: 0, reported: false }

/** `wait`, or the abort's reason as soon as `signal` aborts. */
export function untilAborted(wait: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return wait
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    wait.then(
      () => {
        signal.removeEventListener("abort", abort)
        resolve()
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

export interface PostOptions {
  endpoint: string
  apiKey: string
  body: string
  /** Per attempt, not per call. */
  timeoutMs: number
  maxAttempts: number
  /** First backoff; doubles on each retry. */
  backoffMs: number
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  signal?: AbortSignal | undefined
  /**
   * Quote an error status's body in the message. Off for a chat endpoint,
   * which may echo the prompt, and so the state.
   */
  quoteErrorBody: boolean
  describe: (error: unknown) => string
}

export interface PostResult {
  /** The 200's body, parsed as JSON. The caller validates it. */
  raw: unknown
  /** Measured round trip across all attempts. */
  latencyMs: number
  attempts: number
  /**
   * Attempts before this one that may have been billed at a cost nobody
   * reported (a timeout, a server-side failure). Zero when every earlier
   * attempt was refused before it ran.
   */
  uncounted: number
}

/**
 * POST `body` with retry, exponential backoff, a timeout per attempt and caller
 * abort. It never retries once a 200 has arrived, so a call is paid for once.
 * A failure that may have been billed carries `spent` (see `ProviderError`),
 * so the caller can count it rather than lose it.
 */
export async function postJson(o: PostOptions): Promise<PostResult> {
  const started = performance.now()
  let uncounted = 0
  const spent = (extra = 0): Spent | undefined =>
    uncounted + extra > 0 ? { usage: UNKNOWN_COST, uncounted: uncounted + extra } : undefined
  for (let attempt = 1; attempt <= o.maxAttempts; attempt += 1) {
    // One timeout per attempt, linked to the caller's signal so an abort
    // cancels the in-flight fetch rather than being ignored.
    const timeout = AbortSignal.timeout(o.timeoutMs)
    const composite = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout
    const last = attempt === o.maxAttempts
    // A backoff the caller's abort cuts short, so a deadline holds across retries.
    const wait = () => untilAborted(o.sleep(o.backoffMs * 2 ** (attempt - 1)), o.signal)

    let response: Response
    try {
      response = await o.fetch(o.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${o.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/garygentry/system1",
          "X-Title": "system1",
        },
        body: o.body,
        signal: composite,
      })
    } catch (error) {
      // A caller abort means the answer is no longer wanted: not retried.
      if (o.signal?.aborted) throw error
      // A request that may have reached the server may have been billed.
      if (!neverSent(error)) uncounted += 1
      if (last) {
        throw new ProviderError(
          "provider-unreachable",
          `Could not reach ${o.endpoint}: ${o.describe(error)}`,
          undefined,
          spent(),
        )
      }
      await wait()
      continue
    }

    if (!response.ok) {
      let detail = ""
      if (o.quoteErrorBody) detail = `: ${(await response.text().catch(() => "")).slice(0, 500)}`
      else await response.body?.cancel().catch(() => {})
      if (mayHaveRun(response.status)) uncounted += 1
      if (!RETRY_STATUSES.has(response.status) || last) {
        throw new ProviderError(
          "provider-http",
          `${o.endpoint} returned ${response.status}${detail}`,
          response.status,
          spent(),
        )
      }
      await wait()
      continue
    }

    // A 200 is paid for. From here a failure is never retried (that would pay
    // again), and it carries what was spent so the caller can count it.
    let raw: unknown
    try {
      raw = await response.json()
    } catch (error) {
      if (o.signal?.aborted) throw error
      const timedOut = composite.aborted
      throw new ProviderError(
        timedOut ? "provider-unreachable" : "malformed-response",
        timedOut
          ? `${o.endpoint} timed out sending its answer, after ${o.timeoutMs} ms`
          : `${o.endpoint} returned a body that is not JSON`,
        undefined,
        spent(1),
      )
    }
    return {
      raw,
      latencyMs: Math.round(performance.now() - started),
      attempts: attempt,
      uncounted,
    }
  }
  // Unreachable: the last attempt always returns or throws.
  throw new ProviderError("provider-unreachable", `Could not reach ${o.endpoint}`)
}

/**
 * `usage` as the total for a call: a lower bound (`reported: false`) when
 * earlier attempts may have been billed at a cost nobody reported.
 */
export function withUncounted(usage: Usage, uncounted: number): Usage {
  return uncounted > 0 ? { ...usage, reported: false } : usage
}
