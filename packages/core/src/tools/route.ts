import { type LoadOptions, loadConfig } from "../config/load.js"
import { DecisionsError } from "../errors.js"
import { type RouteResult, route } from "../route/route.js"
import type { RouteInput } from "./schemas.js"

export interface RouteToolResult extends RouteResult {
  /** Which config files contributed, so a user can see why a hint did or did not fire. */
  files: { user?: string; repo?: string }
}

/**
 * Match a prompt against the routing triggers (decision 0018). Local only: it
 * loads config and runs regular expressions, and never sends the prompt.
 *
 * It deliberately skips the full tool context (profiles, transport, specs),
 * because a hook runs it on every prompt.
 */
export function runRoute(options: LoadOptions, rawInput: unknown): RouteToolResult {
  // Checked by hand, not with TypeBox: a hook pays for every module it loads.
  const problems = checkRouteInput(rawInput)
  if (problems.length > 0) {
    throw new DecisionsError(
      "invalid-request",
      `Invalid route input:\n  ${problems.join("\n  ")}`,
      {
        problems,
      },
    )
  }
  const input = rawInput as RouteInput
  const config = loadConfig(options)
  const { user, repo } = config.layers
  return {
    ...route(input.prompt, config.route),
    files: { ...(user ? { user } : {}), ...(repo ? { repo } : {}) },
  }
}

/** The same rules as the `RouteInput` schema (`decide schema route`). */
function checkRouteInput(input: unknown): string[] {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return ["/ must be an object"]
  const extra = Object.keys(input).filter((k) => k !== "prompt")
  return [
    ...(typeof (input as { prompt?: unknown }).prompt === "string"
      ? []
      : ["/prompt must be a string"]),
    ...extra.map((k) => `/${k} is not allowed`),
  ]
}
