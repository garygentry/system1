/**
 * Convenience wiring for callers outside the tool layer (scripts, tests).
 *
 * The engine never reads a `.env` file: a project's `.env` belongs to that
 * project, not to us.
 */

import { allProfiles } from "./config/load.js"
import type { DecideMode, Decider } from "./decide.js"
import { DEFAULT_MODEL_ID, resolveProfile } from "./model/profiles.js"
import { createContext, deciderFor } from "./tools/context.js"
import { DEFAULT_ENDPOINT } from "./transport/openrouter.js"

export { stateDir } from "./config/load.js"
export { DEFAULT_ENDPOINT } from "./transport/openrouter.js"
export const DEFAULT_MODEL = DEFAULT_MODEL_ID

export interface ConnectionConfig {
  endpoint: string
  model: string
  /** Never printed; only its presence is ever reported. */
  apiKey: string | undefined
  /** `SYSTEM1_REPLAY` forces replay even when a key is present. */
  replay: boolean
}

/** Env-only connection settings, for `ping` (which must work with no config at all). */
export function resolveConnection(env: NodeJS.ProcessEnv = process.env): ConnectionConfig {
  return {
    endpoint: nonEmpty(env.SYSTEM1_ENDPOINT) ?? DEFAULT_ENDPOINT,
    model: nonEmpty(env.SYSTEM1_MODEL) ?? DEFAULT_MODEL,
    apiKey: nonEmpty(env.OPENROUTER_API_KEY),
    replay: /^(1|true|yes)$/i.test(env.SYSTEM1_REPLAY ?? ""),
  }
}

export interface EnvDeciderOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  home?: string
  mode?: DecideMode
  fetch?: typeof fetch
}

/** A decider from layered config, as the tools build one. */
export function createDeciderFromEnv(options: EnvDeciderOptions = {}): Decider {
  const ctx = createContext(options)
  return deciderFor(ctx, resolveProfile(ctx.config.model, allProfiles(ctx.config)), options.mode)
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim()
}
