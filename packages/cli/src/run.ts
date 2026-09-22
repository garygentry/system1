import { DecisionsError, isDecisionsError } from "@garygentry/decisions-core/errors"
import { FORMATS, type Format, fail, ok } from "./envelope.js"
import { EXIT, type ExitCode, exitFor } from "./exit-codes.js"
import type { Io } from "./io.js"

/** Renders a result for `brief` or `jsonl`; returning undefined falls back to the JSON envelope. */
export type Render<T> = (result: T, format: Format) => string | undefined

/**
 * Run a command body and print its result. A `DecisionsError` becomes a typed
 * error envelope and its mapped exit code. Anything else is a bug: `error`,
 * exit 1.
 */
export async function emit<T>(
  io: Io,
  command: string,
  format: Format,
  body: () => Promise<T> | T,
  render: Render<T> = () => undefined,
): Promise<ExitCode> {
  try {
    const result = await body()
    io.out(render(result, format) ?? JSON.stringify(ok(command, result)))
    return EXIT.ok
  } catch (error) {
    const code = isDecisionsError(error) ? error.code : "error"
    const message = error instanceof Error ? error.message : String(error)
    const details = isDecisionsError(error) ? error.details : undefined
    io.out(
      format === "brief"
        ? `decide ${command}: error ${code} — ${message}`
        : JSON.stringify(fail(command, code, message, details)),
    )
    if (!isDecisionsError(error) && error instanceof Error && io.env.DECISIONS_DEBUG)
      io.err(error.stack ?? "")
    return exitFor(code)
  }
}

/**
 * Pull `--format X` / `--format=X` out of argv before command parsing, so even
 * a flag-parsing error is reported in the format the caller asked for.
 */
export function extractFormat(
  argv: string[],
  fallback: Format,
): { format: Format; rest: string[] } {
  const rest: string[] = []
  let format: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string
    if (arg === "--format") {
      format = argv[i + 1]
      i += 1
    } else if (arg.startsWith("--format=")) {
      format = arg.slice("--format=".length)
    } else {
      rest.push(arg)
    }
  }
  if (format === undefined) return { format: fallback, rest }
  if (!FORMATS.includes(format as Format)) {
    throw new DecisionsError("invalid-request", `--format must be one of ${FORMATS.join(", ")}`)
  }
  return { format: format as Format, rest }
}
