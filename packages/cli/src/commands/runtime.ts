import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  createPolicyRuntime,
  type PolicyRequest,
  type PolicyResult,
} from "@garygentry/system1-core/runtime"
import { RUNTIME_PROTOCOL, readModuleGrant } from "@garygentry/system1-core/runtime/grant"
import { typedParse } from "../args.js"
import { EXIT, type ExitCode } from "../exit-codes.js"
import type { Io } from "../io.js"

/** Flags of `runtime`. Exported so `docs/cli.md` can be checked against them. */
export const RUNTIME_OPTIONS = {
  module: { type: "string" },
  root: { type: "string" },
  "max-usd-per-day": { type: "string" },
  model: { type: "string" },
  replay: { type: "boolean" },
  "timeout-ms": { type: "string" },
  protocol: { type: "boolean" },
} as const

/**
 * Set by Claude Code, Codex and Pi in the shells they run (core/config/session.ts).
 * A deterrent, not a control: an agent can unset them, and other agents set none.
 */
const HARNESS_SESSION_VARS = [
  "CLAUDE_CODE_SESSION_ID",
  "CODEX_THREAD_ID",
  "CODEX_SESSION_ID",
  "PI_SESSION_ID",
  "AI_AGENT",
  "CLAUDECODE",
] as const

/** A request is a question set and one state; anything larger is not one. */
const MAX_REQUEST_BYTES = 8 * 1024 * 1024

/**
 * `decide runtime --module <path> --root <dir> --max-usd-per-day <usd>`: one
 * policy decision for adopted Python code (plan m11-adopt D7). The request
 * `{questions, state, namespace}` comes on stdin, and one `PolicyResult` goes
 * to stdout, never the envelope, and it **always exits 0**: every problem is a
 * fallback with a reason code, so the app takes its existing path.
 *
 * - **The grant is the module's marked line** (0020), read from `--module`.
 *   There is no egress flag and no variable: only reviewed code turns it on.
 * - **It loads no config** and reads only `OPENROUTER_API_KEY`.
 * - **A live call needs a writable `--root`,** so the daily cap holds across
 *   the one-process-per-call spawns.
 * - `--protocol` prints `{protocol, version}` and nothing else.
 */
export async function runRuntimeCommand(argv: string[], io: Io): Promise<ExitCode> {
  io.out(JSON.stringify(await respond(argv, io)))
  io.exitWhenFlushed?.()
  return EXIT.ok
}

const internal = (detail: string): PolicyResult => ({
  ok: false,
  reason: "internal",
  detail,
  ledger: "memory",
})

async function respond(argv: string[], io: Io): Promise<PolicyResult | object> {
  let values: ReturnType<typeof parse>["values"]
  try {
    ;({ values } = parse(argv))
  } catch (error) {
    return internal(`decide runtime: ${(error as Error).message}`)
  }
  if (values.protocol) {
    const { VERSION } = await import("@garygentry/system1-core/version")
    return { protocol: RUNTIME_PROTOCOL, version: VERSION }
  }
  if (!values.module)
    return internal("decide runtime: --module <path> is required (the grant is read from it)")
  const cwd = io.cwd ?? process.cwd()
  const modulePath = resolve(cwd, values.module)
  const grant = readModuleGrant(modulePath)
  if (!grant) return internal("decide runtime: --module can't be read")
  const cap =
    values["max-usd-per-day"] === undefined ? Number.NaN : Number(values["max-usd-per-day"])
  if (!Number.isFinite(cap) || cap < 0)
    return internal("decide runtime: --max-usd-per-day must be a number of at least 0")
  const timeoutMs = values["timeout-ms"] === undefined ? undefined : Number(values["timeout-ms"])
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1))
    return internal("decide runtime: --timeout-ms must be a whole number ≥ 1")
  const mode = values.replay ? "replay" : "live"
  // Inside an agent's session, a module's grant may be a file the agent just
  // wrote and nobody reviewed (0020, "What we give up"). It only ever denies:
  // no variable grants egress. Replay sends nothing, so it still runs.
  const harness = HARNESS_SESSION_VARS.find((name) => io.env[name])
  if (mode === "live" && grant.egress === "on" && harness)
    return {
      ok: false,
      reason: "egress-off",
      detail: `decide runtime: live calls are refused inside an agent session (${harness} is set); run the app outside the agent`,
      ledger: "memory",
    } satisfies PolicyResult
  const root = values.root ? resolve(cwd, values.root) : undefined
  if (mode === "live" && grant.egress === "on" && !writable(root))
    return internal(
      root
        ? "decide runtime: --root isn't writable; a live call needs it so the daily cap holds"
        : "decide runtime: a live call needs --root, so the daily cap holds across calls",
    )

  let request: PolicyRequest
  try {
    const text = (io.readStdin ?? (() => readFileSync(0, "utf8")))()
    if (Buffer.byteLength(text) > MAX_REQUEST_BYTES) throw new Error("too large")
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error()
    request = parsed as PolicyRequest
  } catch {
    return internal("decide runtime: stdin must be one JSON object {questions, state, namespace}")
  }

  const apiKey = io.env.OPENROUTER_API_KEY
  const runtime = createPolicyRuntime({
    egress: grant.egress,
    // The same file again: the runtime's own lock reads it too (0020).
    module: modulePath,
    maxUsdPerDay: cap,
    mode,
    ...(root ? { root } : {}),
    ...(values.model ? { model: values.model } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(io.fetch ? { fetch: io.fetch } : {}),
  })
  const result = await runtime.decide(request)
  // Say why the grant is off, so the log points at the module's line.
  if (!result.ok && result.reason === "egress-off" && grant.why)
    return { ...result, detail: `${result.detail}: ${grant.why}` }
  return result
}

/** Can the spend ledger be appended to under `root`? */
function writable(root: string | undefined): boolean {
  if (!root) return false
  try {
    mkdirSync(root, { recursive: true })
    appendFileSync(join(root, "usage.jsonl"), "")
    return true
  } catch {
    return false
  }
}

function parse(argv: string[]) {
  return typedParse({ args: argv, allowPositionals: false, strict: true, options: RUNTIME_OPTIONS })
}
