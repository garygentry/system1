import { DecisionsError } from "../errors.js"
import type { SpendSummary } from "../run/spend.js"
import { checkInput, ledgerFor, type ToolContext } from "./context.js"
import type { UsageInput } from "./schemas.js"

export interface UsageResult extends SpendSummary {
  /** Every figure is measured from upstream `usage` blocks. */
  basis: "measured"
  ledger: string
  session?: string
  since?: string
}

export function runUsage(ctx: ToolContext, rawInput: unknown = {}): UsageResult {
  const input = checkInput<UsageInput>("usage", rawInput)
  const since = input.since ? new Date(input.since) : undefined
  if (since && Number.isNaN(since.getTime())) {
    throw new DecisionsError("invalid-request", `--since "${input.since}" is not a date`)
  }
  const session = input.session === "current" ? currentSession(ctx) : input.session
  const ledger = ledgerFor(ctx)
  return {
    basis: "measured",
    ...ledger.summary({
      ...(session ? { session } : {}),
      ...(since ? { since } : {}),
    }),
    ledger: ledger.file,
    ...(session ? { session } : {}),
    ...(input.since ? { since: input.since } : {}),
  }
}

function currentSession(ctx: ToolContext): string {
  if (ctx.config.session) return ctx.config.session
  throw new DecisionsError(
    "invalid-request",
    "no current session: not running under Claude Code, Codex or Pi, and SYSTEM1_SESSION is not set",
  )
}
