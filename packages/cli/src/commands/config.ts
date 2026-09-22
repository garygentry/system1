import { parseArgs } from "node:util"
import {
  createContext,
  DEFAULT_EXCLUDES,
  DecisionsError,
  loadConfig,
  repoConfigPath,
  setConsent,
} from "@garygentry/decisions-core"
import type { Format } from "../envelope.js"
import type { ExitCode } from "../exit-codes.js"
import type { Io } from "../io.js"
import { emit } from "../run.js"

/**
 * `decide config [show]` and `decide config egress allow|deny|status`.
 *
 * Granting egress consent is the user's decision, not the agent's. So `allow`
 * needs an interactive terminal (a human typed it, e.g. `! decide config
 * egress allow` in Claude Code) or an explicit `--confirm`. Skills must never
 * pass `--confirm` on the user's behalf.
 */
export function runConfigCommand(argv: string[], io: Io, format: Format): Promise<ExitCode> {
  return emit(
    io,
    "config",
    format,
    () => body(argv, io),
    (r, f) => (f === "brief" ? brief(r) : undefined),
  )
}

type ConfigResult =
  | ReturnType<typeof show>
  | { egress: { consent: unknown; file: string; changed?: boolean } }

function body(argv: string[], io: Io): ConfigResult {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { confirm: { type: "boolean" }, by: { type: "string" } },
  })
  const [section = "show", action = "status"] = positionals
  const cwd = io.cwd ?? process.cwd()
  if (section === "show") return show(io, cwd)
  if (section !== "egress") {
    throw new DecisionsError(
      "invalid-request",
      `Unknown config section "${section}". Use: show, egress`,
    )
  }
  const config = loadConfig({ cwd, env: io.env, ...(io.home ? { home: io.home } : {}) })
  const file = repoConfigPath(config.repoRoot)
  switch (action) {
    case "status":
      return { egress: { consent: config.egress.consent, file } }
    case "allow":
      if (!io.interactive && !values.confirm) {
        throw new DecisionsError(
          "egress-refused",
          "Egress consent is the user's decision. Ask the user to run `decide config egress allow` themselves " +
            "(in Claude Code: `! decide config egress allow`).",
        )
      }
      return {
        egress: {
          consent: setConsent(config.repoRoot, true, values.by ?? "decide config"),
          file,
          changed: true,
        },
      }
    case "deny":
      return {
        egress: {
          consent: setConsent(config.repoRoot, false, values.by ?? "decide config"),
          file,
          changed: true,
        },
      }
    default:
      throw new DecisionsError(
        "invalid-request",
        `Unknown egress action "${action}". Use: status, allow, deny`,
      )
  }
}

function show(io: Io, cwd: string) {
  const ctx = createContext({ ...io, cwd, env: io.env })
  const { config } = ctx
  return {
    repoRoot: config.repoRoot,
    model: config.model,
    endpoint: config.endpoint,
    concurrency: config.concurrency,
    budget: config.budget,
    egress: {
      consent: config.egress.consent,
      exclude: config.egress.exclude,
      defaultExcludes: DEFAULT_EXCLUDES.length,
    },
    apiKey: config.apiKey ? `present (${config.apiKeySource})` : "absent (replay only)",
    replay: config.replay,
    session: config.session ?? null,
    files: config.layers,
    specDirs: ctx.specDirs,
  }
}

function brief(r: ConfigResult): string {
  if (!("repoRoot" in r)) {
    const c = r.egress.consent as { granted: boolean; at?: string }
    return `egress consent: ${c.granted ? `granted${c.at ? ` ${c.at}` : ""}` : "not granted"} (${r.egress.file})`
  }
  const c = r.egress.consent
  return [
    `repo: ${r.repoRoot}`,
    `model: ${r.model} via ${r.endpoint}`,
    `key: ${r.apiKey}${r.replay ? " · DECISIONS_REPLAY forces replay" : ""}`,
    `egress consent: ${c.granted ? `granted ${c.at ?? ""}`.trim() : "not granted — run `decide config egress allow`"}`,
    `excludes: ${r.egress.defaultExcludes} default${r.egress.exclude.length ? ` + ${r.egress.exclude.join(", ")}` : ""}`,
    `budget: ${r.budget.maxCalls} calls / $${r.budget.maxUsd} per request · concurrency ${r.concurrency}`,
  ].join("\n")
}
