import type { ErrorCode } from "@garygentry/decisions-core"

/**
 * Process exit codes: part of the CLI contract hooks and scripts rely on
 * (decision 0015). Add new codes; never renumber.
 */
export const EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
  egressRefused: 3,
  budgetGuard: 4,
  providerError: 5,
  replayMiss: 6,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

const BY_CODE: Record<ErrorCode, ExitCode> = {
  "invalid-request": EXIT.usage,
  "state-too-large": EXIT.usage,
  "unknown-model": EXIT.usage,
  "config-error": EXIT.usage,
  "source-error": EXIT.usage,
  "no-key": EXIT.usage,
  "egress-refused": EXIT.egressRefused,
  "budget-exceeded": EXIT.budgetGuard,
  "provider-unreachable": EXIT.providerError,
  "provider-http": EXIT.providerError,
  "malformed-response": EXIT.providerError,
  "replay-miss": EXIT.replayMiss,
}

export function exitFor(code: ErrorCode | "error"): ExitCode {
  return code === "error" ? EXIT.failure : BY_CODE[code]
}
