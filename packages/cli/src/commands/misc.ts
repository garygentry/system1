import {
  createContext,
  DecisionsError,
  ping,
  resolveConnection,
  runUsage,
  TOOL_SCHEMAS,
} from "@garygentry/system1-core"
import { typedParse } from "../args.js"
import type { Format } from "../envelope.js"
import { EXIT, type ExitCode } from "../exit-codes.js"
import type { Io } from "../io.js"
import { emit } from "../run.js"

export function runSchemaCommand(argv: string[], io: Io, format: Format): Promise<ExitCode> {
  return emit(io, "schema", format, () => {
    const [tool] = argv
    if (!tool || !(tool in TOOL_SCHEMAS)) {
      throw new DecisionsError(
        "invalid-request",
        `Usage: decide schema <${Object.keys(TOOL_SCHEMAS).join("|")}>`,
      )
    }
    return TOOL_SCHEMAS[tool as keyof typeof TOOL_SCHEMAS]
  })
}

export function runUsageCommand(argv: string[], io: Io, format: Format): Promise<ExitCode> {
  return emit(
    io,
    "usage",
    format,
    () => {
      const { values } = typedParse({
        args: argv,
        options: { session: { type: "string" }, since: { type: "string" } },
      })
      const ctx = createContext({ ...io, cwd: io.cwd ?? process.cwd(), env: io.env })
      return runUsage(ctx, {
        ...(values.session ? { session: values.session } : {}),
        ...(values.since ? { since: values.since } : {}),
      })
    },
    (r, f) =>
      f === "brief"
        ? `usage (measured): ${r.calls} call(s) — ${r.liveCalls} live, ${r.replayCalls} replayed · ` +
          `$${r.cost.toFixed(6)} · ${r.input_tokens} input tokens${r.session ? ` · session ${r.session}` : ""}`
        : undefined,
  )
}

export async function runPingCommand(io: Io, format: Format): Promise<ExitCode> {
  let failed = false
  const code = await emit(
    io,
    "ping",
    format,
    async () => {
      const result = await ping(resolveConnection(io.env), io.fetch ? { fetch: io.fetch } : {})
      failed = !result.ok
      if (!result.ok && format !== "brief") {
        throw new DecisionsError("provider-unreachable", result.error ?? "unreachable", {
          ...result,
        })
      }
      return result
    },
    (r, f) => {
      if (f !== "brief") return undefined
      const key = r.keyPresent ? "key: present" : "key: absent (replay only)"
      return r.ok
        ? `decide ping: ok — ${r.model} reachable in ${r.latencyMs} ms (${key})`
        : `decide ping: FAILED — ${r.probe}: ${r.error} (${key})`
    },
  )
  return failed ? EXIT.providerError : code
}
