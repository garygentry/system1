/**
 * `decide hook <pack>` (M10 §4): run a guard pack on a harness hook event.
 *
 * It reads the event the harness sends on stdin and returns the harness's
 * own hook JSON, not the `{v, ok, …}` envelope (0015, M10 amendment).
 *
 * - **Dormant by default.** Unless the pack is enabled in this repo and the
 *   repo has egress consent, it returns `{}` having loaded only the config:
 *   nothing is sent, nothing is written.
 * - **Fail open, never silently.** Once a pack is active, any failure
 *   (provider, timeout, replay miss, budget, size, git, state, a bug) allows
 *   the stop and says why in a `systemMessage`, so the user can tell "checked
 *   and fine" from "not checked".
 */
import { type LoadOptions, loadConfig } from "../config/load.js"
import type { DecideMode } from "../decide.js"
import { isDecisionsError } from "../errors.js"
import type { HookEvent, HookOutput, PackContext } from "../guard/done-check.js"
import { isPackName, type PackName } from "../guard/packs.js"

export type { HookEvent, HookOutput } from "../guard/done-check.js"

/** A hook command's own ceiling: the generated wiring gives the harness 60 s. */
export const HOOK_LATENCY_CEILING_MS = 55_000

export interface HookOptions extends LoadOptions {
  /** Which harness's wiring ran this; inferred from the event when absent. */
  harness?: "claude" | "codex"
  /** The provider's fetch, for tests. */
  fetch?: typeof fetch
  /** For tests: replaces a pack's module. */
  packs?: Partial<Record<PackName, PackModule>>
  now?: Date
  /** For evals: `record` keeps each live answer as a replay fixture. Default `auto`. */
  mode?: DecideMode
}

export interface PackModule {
  sessionStart(ctx: PackContext): HookOutput | Promise<HookOutput>
  stop(ctx: PackContext): Promise<HookOutput>
}

const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/

/** The same rules as `decide schema hook`: the fields read here, others allowed. */
export function checkHookEvent(input: unknown): string[] {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return ["/ must be an object"]
  const e = input as Record<string, unknown>
  const problems: string[] = []
  for (const key of ["hook_event_name", "session_id", "cwd"]) {
    if (typeof e[key] !== "string" || !e[key]) problems.push(`/${key} must be a non-empty string`)
  }
  if (e.stop_hook_active !== undefined && typeof e.stop_hook_active !== "boolean")
    problems.push("/stop_hook_active must be a boolean")
  for (const key of ["source", "turn_id"]) {
    if (e[key] !== undefined && typeof e[key] !== "string")
      problems.push(`/${key} must be a string`)
  }
  return problems
}

const say = (pack: string, text: string): HookOutput => ({
  systemMessage: `System 1 ${pack}: ${text}`,
})

/**
 * Run `pack` on `rawEvent`. Never throws and never rejects: every outcome is a
 * hook response, so the CLI can always exit 0.
 */
export async function runHook(
  pack: string,
  rawEvent: unknown,
  options: HookOptions = {},
): Promise<HookOutput> {
  const now = options.now ?? new Date()
  const event = rawEvent as HookEvent
  const problems = checkHookEvent(rawEvent)
  // Where to look for config: the event's cwd, else where the harness ran us.
  const cwd = problems.length === 0 ? event.cwd : (options.cwd ?? process.cwd())
  const harness = options.harness ?? (typeof event?.turn_id === "string" ? "codex" : "claude")
  const usableId = problems.length === 0 && SESSION_ID.test(event.session_id)
  // The pack's decide calls go to the ledger under the harness's session, the
  // same id the agent's own calls use, so the per-session cap can find them.
  const env = options.env ?? process.env
  const session = env.SYSTEM1_SESSION || (usableId ? `${harness}:${event.session_id}` : undefined)
  let config: ReturnType<typeof loadConfig>
  try {
    config = loadConfig({
      ...options,
      cwd,
      env: session ? { ...env, SYSTEM1_SESSION: session } : env,
    })
  } catch {
    // A broken config can't say whether a pack is on; `decide doctor` reports it.
    return {}
  }
  // An unknown pack is a wiring/version mismatch, not an active check: stay
  // dormant rather than speak in every session of every repo (doctor can tell).
  if (!isPackName(pack)) return {}
  const settings = config.guard.packs[pack]
  if (!settings.enabled || !config.egress.consent.granted) return {}
  if (problems.length > 0) {
    return say(pack, `not checked: the harness sent an unexpected event (${problems[0]})`)
  }
  if (event.stop_hook_active === true) return {}
  if (!usableId) return say(pack, "not checked: the harness sent a session id it can't use")
  const latencyMs = Math.min(settings.latencyMs, HOOK_LATENCY_CEILING_MS)
  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<HookOutput>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(say(pack, `not checked: it took longer than ${latencyMs} ms (latencyMs)`))
    }, latencyMs)
  })
  const work = (async (): Promise<HookOutput> => {
    const mod: PackModule = options.packs?.[pack] ?? (await import("../guard/done-check.js"))
    const ctx: PackContext = {
      repoRoot: config.repoRoot,
      sessionKey: `${harness}:${event.session_id}`,
      ledgerSession: config.session ?? `${harness}:${event.session_id}`,
      tool: {
        cwd: config.repoRoot,
        env: session ? { ...env, SYSTEM1_SESSION: session } : env,
        ...(options.home ? { home: options.home } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      },
      harness,
      pack: settings,
      event,
      signal: controller.signal,
      now,
      ...(options.mode ? { mode: options.mode } : {}),
    }
    if (event.hook_event_name === "SessionStart") return mod.sessionStart(ctx)
    if (event.hook_event_name === "Stop") return mod.stop(ctx)
    return {}
  })().catch((error: unknown) => say(pack, `not checked: ${failOpenReason(error, latencyMs)}`))
  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/** Why a check didn't happen, in words a user can act on. Never includes content. */
export function failOpenReason(error: unknown, latencyMs: number): string {
  if ((error as { name?: unknown })?.name === "AbortError")
    return `it took longer than ${latencyMs} ms (latencyMs)`
  if (!isDecisionsError(error)) return "an internal error; run `decide doctor`"
  switch (error.code) {
    case "egress-refused":
      return "this repo has no egress consent"
    case "no-key":
      return "no API key is set"
    case "provider-unreachable":
    case "provider-http":
    case "malformed-response":
    case "unknown-model":
      return `the decision model's provider failed (${error.code})`
    case "replay-miss":
      return "replay is forced (SYSTEM1_REPLAY) and has no recorded answer"
    case "budget-exceeded":
      return error.message.split("\n")[0] ?? "the spend cap was reached"
    case "state-too-large":
      return "the change is too large to send"
    case "source-error":
      return `git failed (${error.message})`
    case "invalid-request":
    case "config-error":
      return error.message.split("\n")[0] ?? error.code
    default:
      return "an internal error; run `decide doctor`"
  }
}
