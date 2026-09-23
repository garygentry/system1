import { readFileSync } from "node:fs"
import { DecisionsError } from "@garygentry/system1-core/errors"
import { runRoute } from "@garygentry/system1-core/route"
import { typedParse } from "../args.js"
import type { Format } from "../envelope.js"
import type { ExitCode } from "../exit-codes.js"
import type { Io } from "../io.js"
import { emit } from "../run.js"

/** Flags of `route`. Exported so `docs/cli.md` can be checked against them. */
export const ROUTE_OPTIONS = {
  text: { type: "string" },
  stdin: { type: "boolean" },
  hook: { type: "boolean" },
} as const

/**
 * `decide route`: does this prompt call for the `ask` skill? (decision 0018)
 *
 * `--hook` reads a harness hook event from stdin (`{prompt, cwd}`, as Claude
 * Code's UserPromptSubmit sends it) and resolves config from the event's cwd.
 * `--format brief` prints only the hint, or nothing: that is what the plugin
 * hook adds to the agent's context.
 */
export function runRouteCommand(argv: string[], io: Io, format: Format): Promise<ExitCode> {
  return emit(
    io,
    "route",
    format,
    () => {
      const { values } = typedParse({ args: argv, options: ROUTE_OPTIONS })
      const given = [values.text !== undefined, values.stdin, values.hook].filter(Boolean).length
      if (given !== 1) {
        throw new DecisionsError(
          "invalid-request",
          "Usage: decide route --text <prompt> | --stdin | --hook  (exactly one)",
        )
      }
      const read = io.readStdin ?? (() => readFileSync(0, "utf8"))
      let prompt = values.text
      let cwd = io.cwd ?? process.cwd()
      if (values.stdin) prompt = read()
      if (values.hook) {
        const event = parseHookEvent(read())
        prompt = event.prompt
        if (event.cwd) cwd = event.cwd
      }
      return runRoute({ cwd, env: io.env, ...(io.home ? { home: io.home } : {}) }, { prompt })
    },
    (r, f) => (f === "brief" ? (r.message ?? "") : undefined),
  )
}

function parseHookEvent(text: string): { prompt: string; cwd?: string } {
  let event: unknown
  try {
    event = JSON.parse(text)
  } catch {
    throw new DecisionsError("invalid-request", "--hook expects a JSON hook event on stdin")
  }
  const { prompt, cwd } = (event ?? {}) as { prompt?: unknown; cwd?: unknown }
  if (typeof prompt !== "string") {
    throw new DecisionsError("invalid-request", "--hook: the event has no `prompt` string")
  }
  return { prompt, ...(typeof cwd === "string" && cwd ? { cwd } : {}) }
}
