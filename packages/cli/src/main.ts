// Deep imports keep the startup path off the core barrel (see bundle.mjs).
import { DecisionsError } from "@garygentry/decisions-core/errors"
import { VERSION } from "@garygentry/decisions-core/version"
import type { Format } from "./envelope.js"
import { EXIT, type ExitCode } from "./exit-codes.js"
import type { Io } from "./io.js"
import { emit, extractFormat } from "./run.js"

export type { Io } from "./io.js"

export const HELP = `decide ${VERSION} — typed, calibrated decisions for coding agents

Usage: decide <command> [options] [--format json|jsonl|brief]

Commands:
  ask       One state, one question set, one call
  many      One question set over many items (fan-out), filtered to what matters
  usage     Measured spend from the ledger (--session, --since)
  config    Show resolved config; \`config egress allow|deny|status\` for consent
  spec      list | show <name> | validate [name|path]
  schema    Print the JSON Schema of a tool's input (ask, many, usage)
  ping      Check the endpoint is reachable (no key, no spend)
  doctor    Check decide works from this shell; prints the fix for each problem
  version   Print the version

Questions:  --spec <name|path>  |  --question name:noul:<text>
            --question name:choice:<text>:key=desc|key=desc|none=None of these
            --question name:score:<text>:level 0|level 1|level 2
            --input <file|->  (full tool input as JSON; flags override it)
Sources:    --glob <pattern>…  --file <path[:L1-L2]>…  --jsonl <path>
            --diff <range> [--staged]  --text <text>  --stdin
Split:      --split file|hunk|row|lines:N[/overlap]           (default: file)
Project:    --keep 'relevant>=0.7'…  --sort relevant:desc  --limit N  --fields a,b
Run:        --dry-run  --confirm  --record | --replay | --live  --model <id>  --concurrency N

Output is one JSON envelope by default: {v, ok, command, result | error}.
Exit codes: 0 ok · 1 failure · 2 usage · 3 egress refused · 4 budget guard
            5 provider error · 6 replay miss
`

/** Commands whose default output is for agents to read. */
const DEFAULT_FORMAT: Format = "json"

export async function main(argv: string[], io: Io): Promise<ExitCode> {
  const [command, ...args] = argv
  let format: Format
  let rest: string[]
  try {
    ;({ format, rest } = extractFormat(args, DEFAULT_FORMAT))
  } catch (error) {
    return emit(io, command ?? "decide", DEFAULT_FORMAT, () => {
      throw error
    })
  }

  if (
    command === undefined ||
    command === "help" ||
    command === "--help" ||
    command === "-h" ||
    rest.includes("--help")
  ) {
    io.out(HELP)
    return EXIT.ok
  }
  // Command modules load on demand: startup is dominated by module loading,
  // so `version` and `help` must not pay for TypeBox, yaml and the globbers.
  switch (command) {
    case "ask":
      return (await import("./commands/decide.js")).runAskCommand(rest, io, format)
    case "many":
      return (await import("./commands/decide.js")).runManyCommand(rest, io, format)
    case "usage":
      return (await import("./commands/misc.js")).runUsageCommand(rest, io, format)
    case "config":
      return (await import("./commands/config.js")).runConfigCommand(rest, io, format)
    case "spec":
      return (await import("./commands/spec.js")).runSpecCommand(rest, io, format)
    case "schema":
      return (await import("./commands/misc.js")).runSchemaCommand(rest, io, format)
    case "ping":
      return (await import("./commands/misc.js")).runPingCommand(io, format)
    case "doctor":
      return (await import("./commands/doctor.js")).runDoctorCommand(io, format)
    case "version":
    case "--version":
    case "-v":
      return emit(
        io,
        "version",
        format === "json" && !argv.includes("--format") ? "brief" : format,
        () => ({ version: VERSION }),
        (r, f) => (f === "json" ? undefined : r.version),
      )
    default:
      return emit(io, command, format, () => {
        throw new DecisionsError(
          "invalid-request",
          `unknown command "${command}". Run \`decide help\`.`,
        )
      })
  }
}
