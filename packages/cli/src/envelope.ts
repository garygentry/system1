/**
 * Every command prints one envelope (decision 0015). `v` versions the shape, so
 * skills, hooks and scripts can detect a contract change instead of misreading
 * it.
 */
export const ENVELOPE_VERSION = 1

export interface OkEnvelope<T> {
  v: typeof ENVELOPE_VERSION
  ok: true
  command: string
  result: T
}

export interface ErrorEnvelope {
  v: typeof ENVELOPE_VERSION
  ok: false
  command: string
  error: { code: string; message: string; details?: Record<string, unknown> }
  result?: unknown
}

export type Envelope<T> = OkEnvelope<T> | ErrorEnvelope

export type Format = "json" | "jsonl" | "brief"

export const FORMATS: readonly Format[] = ["json", "jsonl", "brief"]

export function ok<T>(command: string, result: T): OkEnvelope<T> {
  return { v: ENVELOPE_VERSION, ok: true, command, result }
}

export function fail(
  command: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  return {
    v: ENVELOPE_VERSION,
    ok: false,
    command,
    error: { code, message, ...(details && Object.keys(details).length ? { details } : {}) },
  }
}
