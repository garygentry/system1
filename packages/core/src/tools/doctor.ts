/**
 * `doctor`: is `decide` usable from this shell, and if not, the exact fix for
 * the harness running it. Read-only: it never writes a rule, a config file or
 * an install. Those need the user's consent and belong to `setup`.
 */
import { accessSync, constants } from "node:fs"
import { delimiter, join } from "node:path"
import { detectHarness, type Harness } from "../config/session.js"
import { ping } from "../ping.js"
import { CLI_PACKAGE, VERSION } from "../version.js"
import type { ToolContext } from "./context.js"

export type CheckStatus = "ok" | "warn" | "fail"

export interface DoctorCheck {
  name: "cli" | "path" | "key" | "consent" | "network"
  status: CheckStatus
  detail: string
  /** What the user (not the agent) can do about a warn or fail. */
  fix?: string
}

export interface DoctorResult {
  /** False when any check failed; warnings alone keep it true. */
  healthy: boolean
  harness: Harness | null
  session: string | null
  version: string
  node: string
  checks: DoctorCheck[]
}

export interface DoctorOptions {
  env: NodeJS.ProcessEnv
  /** The script that is running, for the report. */
  cliPath?: string
}

export const CODEX_RULE = 'prefix_rule(pattern = ["decide"], decision = "allow")'

export async function runDoctor(ctx: ToolContext, options: DoctorOptions): Promise<DoctorResult> {
  const { env } = options
  const { config } = ctx
  const harness = detectHarness(env) ?? null
  const install = `npm i -g ${CLI_PACKAGE}@${VERSION}`
  const checks: DoctorCheck[] = []

  checks.push({
    name: "cli",
    status: "ok",
    detail: `decide ${VERSION} on node ${process.version}${options.cliPath ? ` (${options.cliPath})` : ""}`,
  })

  const onPath = which("decide", env.PATH ?? "")
  checks.push(
    onPath
      ? { name: "path", status: "ok", detail: `decide on PATH: ${onPath}` }
      : {
          name: "path",
          status: "warn",
          detail:
            harness === "claude"
              ? "decide is not on PATH; is the decisions plugin loaded?"
              : "decide is not on PATH. Codex and Pi do not add plugin bin/ to PATH",
          fix: install,
        },
  )

  checks.push(
    config.apiKey
      ? { name: "key", status: "ok", detail: `OPENROUTER_API_KEY present (${config.apiKeySource})` }
      : {
          name: "key",
          status: "warn",
          detail: "no API key: only replay works",
          fix: "set OPENROUTER_API_KEY, or put the key in ~/.config/decisions/credentials (mode 600)",
        },
  )

  checks.push(
    config.egress.consent.granted
      ? { name: "consent", status: "ok", detail: `egress consent granted for ${config.repoRoot}` }
      : {
          name: "consent",
          status: "warn",
          detail: `no egress consent for ${config.repoRoot}: live calls are refused`,
          fix: "the user runs `decide config egress allow` in this repo, if they agree",
        },
  )

  const reach = await ping(
    {
      endpoint: config.endpoint,
      model: config.model,
      apiKey: config.apiKey,
      replay: config.replay,
    },
    ctx.fetch ? { fetch: ctx.fetch } : {},
  )
  if (reach.ok) {
    checks.push({
      name: "network",
      status: "ok",
      detail: `${config.model} reachable in ${reach.latencyMs} ms`,
    })
  } else {
    const sandboxed = env.CODEX_SANDBOX_NETWORK_DISABLED === "1"
    checks.push({
      name: "network",
      // Replay needs no network, so an unreachable endpoint only warns there.
      status: config.replay ? "warn" : "fail",
      detail: `${reach.probe}: ${reach.error ?? "unreachable"}${sandboxed ? " (Codex sandbox has network disabled)" : ""}`,
      fix: networkFix(harness, env),
    })
  }

  return {
    healthy: !checks.some((c) => c.status === "fail"),
    harness,
    session: config.session ?? null,
    version: VERSION,
    node: process.version,
    checks,
  }
}

function networkFix(harness: Harness | null, env: NodeJS.ProcessEnv): string {
  switch (harness) {
    case "codex":
      return `add \`${CODEX_RULE}\` to ${env.CODEX_HOME?.trim() || "~/.codex"}/rules/decisions.rules, then restart Codex`
    case "claude":
      return "allow outbound access to openrouter.ai in Claude Code's sandbox settings"
    default:
      return "check that this machine can reach openrouter.ai (proxy, firewall, DNS)"
  }
}

/** The first executable `name` on `path`, like `command -v`. */
export function which(name: string, path: string): string | undefined {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {}
  }
  return undefined
}
