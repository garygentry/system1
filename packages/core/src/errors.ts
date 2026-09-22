/**
 * Every failure the engine reports on purpose carries a stable `code`.
 *
 * The CLI maps codes onto exit codes (`packages/cli/src/exit-codes.ts`), and
 * skills branch on them, so a code is part of the contract: add new ones, but
 * don't rename them.
 */
export type ErrorCode =
  /** The endpoint could not be reached, or kept failing after retries. */
  | "provider-unreachable"
  /** The endpoint answered with a non-2xx status that is not worth retrying. */
  | "provider-http"
  /** A 2xx whose body is not a valid decision response for the request. */
  | "malformed-response"
  /** A live call was needed but no API key is configured. */
  | "no-key"
  /** Replay mode, and no recorded fixture matches this request. */
  | "replay-miss"
  /** The requested model has no profile. */
  | "unknown-model"
  /** The request itself is invalid (caller bug, not a provider problem). */
  | "invalid-request"
  /** A live call in a repo that has not consented to sending content off the machine. */
  | "egress-refused"
  /** The projected spend is over the budget and the caller did not confirm. */
  | "budget-exceeded"
  /** One state is over the model's limit. Refused, never truncated. */
  | "state-too-large"
  /** A source could not be read (missing file, bad JSONL, git failure). */
  | "source-error"
  /** A config or credentials file is invalid or insecure. */
  | "config-error"

export class DecisionsError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = "DecisionsError"
  }
}

/** A failure on the provider's side, as distinct from a bad question set. */
export class ProviderError extends DecisionsError {
  constructor(
    code: "provider-unreachable" | "provider-http" | "malformed-response",
    message: string,
    readonly status?: number,
  ) {
    super(code, message, status === undefined ? {} : { status })
    this.name = "ProviderError"
  }
}

export function isDecisionsError(error: unknown): error is DecisionsError {
  return error instanceof DecisionsError
}
