import type { ErrorCode } from "@garygentry/system1-core/errors"

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
  /**
   * The check ran and did not pass: `spec check --strict` (an example missed),
   * or `spec lint` (an error-level finding or invalid spec; with `--strict`, any
   * warning).
   */
  checkFailed: 7,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

/** Every error code and its exit code. `docs/cli.md` and `docs/troubleshooting.md` cover each. */
export const BY_CODE: Record<ErrorCode, ExitCode> = {
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
