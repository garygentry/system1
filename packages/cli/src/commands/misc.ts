import {
  type ConnectionConfig,
  createContext,
  DecisionsError,
  isDecisionsError,
  loadConfig,
  ping,
  probeUrl,
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

/** Flags of `usage`. Exported so `docs/cli.md` can be checked against them. */
export const USAGE_OPTIONS = { session: { type: "string" }, since: { type: "string" } } as const

export function runUsageCommand(argv: string[], io: Io, format: Format): Promise<ExitCode> {
  return emit(
    io,
    "usage",
    format,
    () => {
      const { values } = typedParse({
        args: argv,
        options: USAGE_OPTIONS,
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
      const { config, configError } = connection(io)
      try {
        probeUrl(config)
      } catch {
        throw new DecisionsError(
          "config-error",
          `endpoint ${config.endpoint} is not a URL: correct SYSTEM1_ENDPOINT or \`endpoint\` in the config file`,
          { endpoint: config.endpoint },
        )
      }
      const result = {
        ...(await ping(config, io.fetch ? { fetch: io.fetch } : {})),
        ...(configError ? { configError } : {}),
      }
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
      const line = r.ok
        ? `decide ping: ok — ${r.model} reachable in ${r.latencyMs} ms (${key})`
        : `decide ping: FAILED — ${r.probe}: ${r.error} (${key})`
      return r.configError
        ? `${line}\nconfig not loaded, so this used the environment only: ${r.configError}`
        : line
    },
  )
  return failed ? EXIT.providerError : code
}

/**
 * What `ping` probes: the layered config, as every other command sees it. A
 * config file that fails to load must not stop the network check, so that
 * falls back to the environment alone (`doctor` reports the config problem).
 */
function connection(io: Io): { config: ConnectionConfig; configError?: string } {
  try {
    const config = loadConfig({
      cwd: io.cwd ?? process.cwd(),
      env: io.env,
      ...(io.home ? { home: io.home } : {}),
    })
    const { endpoint, model, apiKey, replay } = config
    return { config: { endpoint, model, apiKey, replay } }
  } catch (error) {
    if (isDecisionsError(error) && error.code === "config-error")
      return { config: resolveConnection(io.env), configError: error.message }
    throw error
  }
}
