import type { ConnectionConfig } from "./wiring.js"

/**
 * A reachability check that spends nothing.
 *
 * It reads the model's public endpoint listing rather than calling the
 * decisions endpoint, so it needs no key and makes no decision. That makes it
 * safe to run from any harness, and a good probe for whether the agent's shell
 * sandbox allows network access at all.
 */
export interface PingResult {
  ok: boolean
  model: string
  endpoint: string
  /** The URL actually probed. */
  probe: string
  keyPresent: boolean
  /** Measured round trip. Absent when the request never completed. */
  latencyMs?: number
  httpStatus?: number
  /** The listing's context length for the model, when it answered. */
  contextLength?: number
  error?: string
}

export interface PingOptions {
  fetch?: typeof fetch
  timeoutMs?: number
}

export function probeUrl(config: ConnectionConfig): string {
  const origin = new URL(config.endpoint).origin
  return `${origin}/api/v1/models/${config.model}/endpoints`
}

export async function ping(
  config: ConnectionConfig,
  options: PingOptions = {},
): Promise<PingResult> {
  const doFetch = options.fetch ?? fetch
  const probe = probeUrl(config)
  const base = {
    model: config.model,
    endpoint: config.endpoint,
    probe,
    keyPresent: config.apiKey !== undefined,
  }
  const started = performance.now()
  try {
    const response = await doFetch(probe, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
    const latencyMs = Math.round(performance.now() - started)
    if (!response.ok) {
      return {
        ...base,
        ok: false,
        latencyMs,
        httpStatus: response.status,
        error: `HTTP ${response.status}`,
      }
    }
    const body = (await response.json()) as ListingBody
    const contextLength = body.data?.endpoints?.[0]?.context_length
    return {
      ...base,
      ok: true,
      latencyMs,
      httpStatus: response.status,
      ...(typeof contextLength === "number" ? { contextLength } : {}),
    }
  } catch (error) {
    return { ...base, ok: false, error: describe(error) }
  }
}

interface ListingBody {
  data?: { endpoints?: Array<{ context_length?: number }> }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message
  }
  return String(error)
}
