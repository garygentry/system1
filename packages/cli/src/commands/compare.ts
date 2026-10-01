import {
  type CompareResult,
  createContext,
  DecisionsError,
  runCompare,
} from "@garygentry/system1-core"
import { typedParse } from "../args.js"
import type { Format } from "../envelope.js"
import type { ExitCode } from "../exit-codes.js"
import { briefCompare } from "../format.js"
import type { Io } from "../io.js"
import { emit } from "../run.js"

/**
 * `decide compare <spec> [--baseline current|emulated[:<model>]] [--live|--record|--replay]
 * [--limit N] [--dry-run] [--confirm] [--model <id>]`.
 */
export function runCompareCommand(argv: string[], io: Io, format: Format): Promise<ExitCode> {
  return emit<CompareResult>(
    io,
    "compare",
    format,
    () =>
      runCompare(createContext({ ...io, cwd: io.cwd ?? process.cwd(), env: io.env }), input(argv)),
    (r, f) => (f === "brief" ? briefCompare(r) : undefined),
  )
}

/** Flags of `compare`. Exported so `docs/cli.md` can be checked against them. */
export const COMPARE_OPTIONS = {
  baseline: { type: "string" },
  model: { type: "string" },
  limit: { type: "string" },
  live: { type: "boolean" },
  record: { type: "boolean" },
  replay: { type: "boolean" },
  "dry-run": { type: "boolean" },
  confirm: { type: "boolean" },
} as const

function input(argv: string[]): Record<string, unknown> {
  const { values, positionals } = typedParse({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: COMPARE_OPTIONS,
  })
  const [spec, extra] = positionals
  if (!spec || extra !== undefined)
    throw new DecisionsError(
      "invalid-request",
      "Usage: decide compare <spec> [--baseline current|emulated[:<model>]] [--live|--record|--replay] [--limit N] [--dry-run] [--confirm]",
    )
  const modes = (["live", "record", "replay"] as const).filter((m) => values[m])
  if (modes.length > 1)
    throw new DecisionsError("invalid-request", "Pick one of --live, --record, --replay")
  let limit: number | undefined
  if (values.limit !== undefined) {
    limit = Number(values.limit)
    if (!Number.isInteger(limit) || limit < 1)
      throw new DecisionsError(
        "invalid-request",
        `--limit must be a whole number ≥ 1, got "${values.limit}"`,
      )
  }
  return {
    spec,
    ...(values.baseline ? { baseline: values.baseline } : {}),
    ...(values.model ? { model: values.model } : {}),
    ...(modes[0] ? { mode: modes[0] } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(values["dry-run"] ? { dryRun: true } : {}),
    ...(values.confirm ? { confirm: true } : {}),
  }
}
