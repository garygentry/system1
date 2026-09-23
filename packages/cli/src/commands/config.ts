import {
  activeTriggers,
  allProfiles,
  createContext,
  DEFAULT_EXCLUDES,
  DecisionsError,
  loadConfig,
  repoConfigPath,
  setConsent,
} from "@garygentry/system1-core"
import { typedParse } from "../args.js"
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

/** Flags of `config`. Exported so `docs/cli.md` can be checked against them. */
export const CONFIG_OPTIONS = { confirm: { type: "boolean" }, by: { type: "string" } } as const

function body(argv: string[], io: Io): ConfigResult {
  const { values, positionals } = typedParse({
    args: argv,
    allowPositionals: true,
    options: CONFIG_OPTIONS,
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
    timeoutMs: config.timeoutMs,
    budget: config.budget,
    egress: {
      consent: config.egress.consent,
      exclude: config.egress.exclude,
      defaultExcludes: DEFAULT_EXCLUDES.length,
    },
    apiKey: config.apiKey ? `present (${config.apiKeySource})` : "absent (replay only)",
    replay: config.replay,
    session: config.session ?? null,
    sessionOrigin: config.sessionOrigin ?? null,
    /**
     * The profiles in effect for the ids the config files set, one per id: an
     * override of a built-in shows once. Built-ins nobody overrides are not repeated.
     */
    profiles: allProfiles(config).filter((p) => config.profiles.some((c) => c.id === p.id)),
    route: config.route,
    files: config.layers,
    specDirs: ctx.specDirs,
    warnings: config.warnings,
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
    `key: ${r.apiKey}${r.replay ? " · SYSTEM1_REPLAY forces replay" : ""}`,
    `egress consent: ${c.granted ? `granted ${c.at ?? ""}`.trim() : "not granted — run `decide config egress allow`"}`,
    `excludes: ${r.egress.defaultExcludes} default${r.egress.exclude.length ? ` + ${r.egress.exclude.join(", ")}` : ""}`,
    `budget: ${r.budget.maxCalls} calls / $${r.budget.maxUsd} per request · concurrency ${r.concurrency} · timeout ${r.timeoutMs} ms`,
    ...(r.profiles.length ? [`profiles: ${r.profiles.map((p) => p.id).join(", ")}`] : []),
    `route: ${routeLine(r.route)}`,
    `session: ${r.session ? `${r.session} (${r.sessionOrigin === "env" ? "SYSTEM1_SESSION" : `detected from ${r.sessionOrigin}`})` : "none"}`,
    ...(r.warnings.length ? [`ignored: ${r.warnings.join("; ")}`] : []),
  ].join("\n")
}

/** Never fails: `config` is where a user looks to see what resolved, even when `route:` is wrong. */
function routeLine(route: Parameters<typeof activeTriggers>[0]): string {
  if (!route.enabled) return "off"
  try {
    const names = activeTriggers(route).map((t) => t.name)
    return `on · ${names.join(", ") || "no triggers"}`
  } catch (error) {
    return `invalid (${error instanceof Error ? error.message : String(error)})`
  }
}
