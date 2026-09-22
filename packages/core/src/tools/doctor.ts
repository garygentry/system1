/**
 * `doctor`: is `decide` usable from this shell, and if not, the exact fix for
 * the harness running it. Read-only: it never writes a rule, a config file or
 * an install. Those need the user's consent and belong to `setup`.
 *
 * Unlike the other tools it builds its own context: a broken config is one of
 * the things it diagnoses, so it must not fail before it can report it.
 */
import { accessSync, constants, statSync } from "node:fs"
import { delimiter, join } from "node:path"
import { detectHarness, type Harness } from "../config/session.js"
import { ping } from "../ping.js"
import { CLI_PACKAGE, VERSION } from "../version.js"
import { type ContextOptions, createContext, type ToolContext } from "./context.js"

export type CheckStatus = "ok" | "warn" | "fail"

export interface DoctorCheck {
  name: "cli" | "config" | "path" | "path-version" | "key" | "consent" | "network"
  status: CheckStatus
  detail: string
  /** What the user (not the agent) can do about a warn or fail. */
  fix?: string
}

export interface DoctorResult {
  /** False when any check failed; warnings alone keep it true. */
  healthy: boolean
  /** Whether a live decision would be sent: key, consent, network, and replay not forced. */
  live: boolean
  harness: Harness | null
  session: string | null
  version: string
  node: string
  checks: DoctorCheck[]
}

export interface DoctorOptions extends ContextOptions {
  env: NodeJS.ProcessEnv
  /** The script that is running, for the report. */
  cliPath?: string
  /**
   * Reads the version of the `decide` found on PATH (the CLI runs it with
   * `version`). Injected so the engine itself never spawns anything but git
   * (0014). Without it the `path-version` check is skipped.
   */
  probeVersion?: (path: string) => Promise<string | undefined>
}

export const CODEX_RULE = 'prefix_rule(pattern = ["decide"], decision = "allow")'

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const { env } = options
  const harness = detectHarness(env) ?? null
  const checks: DoctorCheck[] = [
    {
      name: "cli",
      status: "ok",
      detail: `decide ${VERSION} on node ${process.version}${options.cliPath ? ` (${options.cliPath})` : ""}`,
    },
    pathCheck(harness, env),
  ]
  const onPath = which("decide", env.PATH ?? "")
  if (onPath && options.probeVersion) {
    checks.push(await versionCheck(onPath, options.probeVersion, env))
  }
  const report = (ctx: ToolContext | undefined, live: boolean): DoctorResult => ({
    healthy: !checks.some((c) => c.status === "fail"),
    live,
    harness,
    session: ctx?.config.session ?? null,
    version: VERSION,
    node: process.version,
    checks,
  })

  let ctx: ToolContext
  try {
    ctx = createContext(options)
  } catch (error) {
    checks.push({
      name: "config",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      fix: "correct the config file or environment variable named above",
    })
    return report(undefined, false)
  }
  const { config } = ctx

  checks.push(
    config.apiKey
      ? { name: "key", status: "ok", detail: `OPENROUTER_API_KEY present (${config.apiKeySource})` }
      : {
          name: "key",
          status: "warn",
          detail: "no API key: only replay works",
          fix: "set OPENROUTER_API_KEY, or write `openrouter_api_key: <key>` to ~/.config/decisions/credentials (chmod 600)",
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

  let reach: Awaited<ReturnType<typeof ping>>
  try {
    reach = await ping(
      {
        endpoint: config.endpoint,
        model: config.model,
        apiKey: config.apiKey,
        replay: config.replay,
      },
      ctx.fetch ? { fetch: ctx.fetch } : {},
    )
  } catch (error) {
    // An endpoint that is not a URL at all.
    checks.push({
      name: "config",
      status: "fail",
      detail: `endpoint ${config.endpoint}: ${error instanceof Error ? error.message : String(error)}`,
      fix: "correct DECISIONS_ENDPOINT or `endpoint` in the config file",
    })
    return report(ctx, false)
  }
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
      fix: networkFix(reach.httpStatus, harness, sandboxed, env),
    })
  }

  const live =
    !config.replay &&
    config.apiKey !== undefined &&
    config.egress.consent.granted &&
    reach.ok === true
  return report(ctx, live)
}

function pathCheck(harness: Harness | null, env: NodeJS.ProcessEnv): DoctorCheck {
  const onPath = which("decide", env.PATH ?? "")
  if (onPath) return { name: "path", status: "ok", detail: `decide on PATH: ${onPath}` }
  if (harness === "claude") {
    return {
      name: "path",
      status: "warn",
      detail: "decide is not on PATH, so the decisions plugin's bin/ is not loaded",
      fix: "install the decisions plugin from its marketplace, or start Claude Code with `--plugin-dir <checkout>/plugins/decisions`",
    }
  }
  const install = `npm i -g ${CLI_PACKAGE}@${VERSION}`
  return {
    name: "path",
    status: "warn",
    detail: "decide is not on PATH. Codex and Pi do not add plugin bin/ to PATH",
    fix:
      VERSION === "0.0.0"
        ? `${CLI_PACKAGE} is not published yet: put <checkout>/plugins/decisions/bin on PATH`
        : install,
  }
}

async function versionCheck(
  path: string,
  probe: (path: string) => Promise<string | undefined>,
  env: NodeJS.ProcessEnv,
): Promise<DoctorCheck> {
  let raw: string | undefined
  try {
    raw = await probe(path)
  } catch {}
  const found = raw?.trim() || undefined
  // Measured with Codex 0.152: inside its Linux sandbox, a child process that
  // node spawns exits 0 with empty stdout (even `node -e "console.log(1)"`), so
  // nothing can be learned there. Say so rather than warn about a false problem.
  if (raw !== undefined && found === undefined && env.CODEX_SANDBOX_NETWORK_DISABLED === "1") {
    return {
      name: "path-version",
      status: "ok",
      detail: "not checked: the Codex sandbox hides a child process's output",
    }
  }
  if (found === undefined) {
    return {
      name: "path-version",
      status: "warn",
      detail: `could not read the version of ${path}`,
      fix: `run \`${path} version\` to see why; reinstall it if it fails`,
    }
  }
  if (found === VERSION) {
    return {
      name: "path-version",
      status: "ok",
      detail: `decide on PATH is ${found}, same as this one`,
    }
  }
  return {
    name: "path-version",
    status: "warn",
    detail: `decide on PATH is ${found}, but this one is ${VERSION}: agents will run the one on PATH`,
    fix:
      VERSION === "0.0.0"
        ? `point PATH at the checkout's plugins/decisions/bin, or remove the other decide (${path})`
        : `npm i -g ${CLI_PACKAGE}@${VERSION}`,
  }
}

function networkFix(
  httpStatus: number | undefined,
  harness: Harness | null,
  sandboxed: boolean,
  env: NodeJS.ProcessEnv,
): string {
  // An HTTP answer means the network works; the problem is what was asked for.
  if (httpStatus === 404)
    return "the endpoint does not know this model: check DECISIONS_MODEL / `model` and DECISIONS_ENDPOINT / `endpoint`"
  if (httpStatus !== undefined && httpStatus >= 500)
    return `the provider answered HTTP ${httpStatus}: retry later`
  if (httpStatus !== undefined)
    return `the endpoint answered HTTP ${httpStatus}: check DECISIONS_ENDPOINT / \`endpoint\``
  // Only a sandboxed Codex shell gets the rule: outside the sandbox (or with
  // the rule applied) a failure is an ordinary network problem. The flag also
  // beats the nesting heuristic (Codex inside Pi looks like Pi).
  if (sandboxed) {
    return `add \`${CODEX_RULE}\` to ${env.CODEX_HOME?.trim() || "~/.codex"}/rules/decisions.rules, then restart Codex (it covers commands that start with decide; a pipe into decide stays offline)`
  }
  if (harness === "claude")
    return "allow outbound access to openrouter.ai in Claude Code's sandbox settings"
  return "check that this machine can reach openrouter.ai (proxy, firewall, DNS)"
}

/** The first executable file `name` on `path`, like `command -v`. */
export function which(name: string, path: string): string | undefined {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      if (statSync(candidate).isFile()) return candidate
    } catch {}
  }
  return undefined
}
