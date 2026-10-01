/**
 * `doctor`: is `decide` usable from this shell, and if not, the exact fix for
 * the harness running it. Read-only: it never writes a rule, a config file or
 * an install. Those need the user's consent and belong to `setup`.
 *
 * Unlike the other tools it builds its own context: a broken config is one of
 * the things it diagnoses, so it must not fail before it can report it.
 */
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import { userConfigDir } from "../config/load.js"
import { detectHarness, type Harness } from "../config/session.js"
import { isDecisionsError } from "../errors.js"
import { PACK_NAMES } from "../guard/packs.js"
import { backlogPath, readBacklog } from "../opportunities/backlog.js"
import { ping } from "../ping.js"
import { activeTriggers, route } from "../route/route.js"
import { CLI_PACKAGE, VERSION } from "../version.js"
import { type ContextOptions, createContext, type ToolContext } from "./context.js"
import { adoptedCheck, capturedCheck, emulatedCheck } from "./doctor-adopt.js"

export type CheckStatus = "ok" | "warn" | "fail"

/** Every check doctor can report, in report order. `docs/troubleshooting.md` covers each. */
export const DOCTOR_CHECKS = [
  "cli",
  "config",
  "config-keys",
  "path",
  "path-version",
  "key",
  "consent",
  "route",
  "guard",
  "backlog",
  "adopted",
  "emulated",
  "captured",
  "network",
] as const

export interface DoctorCheck {
  name: (typeof DOCTOR_CHECKS)[number]
  status: CheckStatus
  detail: string
  /** What the user (not the agent) can do about a warn or fail. */
  fix?: string
  /** A warn that doesn't stand between this shell and a live decision. */
  advisory?: boolean
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

/** Guard packs (M10): which are active, and any enabled without consent (dormant). */
function guardCheck(
  config: ToolContext["config"],
  env: NodeJS.ProcessEnv,
  home?: string,
  cliPath?: string,
): DoctorCheck {
  const enabled = PACK_NAMES.filter((name) => config.guard.packs[name].enabled)
  if (enabled.length === 0)
    return { name: "guard", status: "ok", detail: "no guard pack enabled (all dormant)" }
  if (!config.egress.consent.granted) {
    return {
      name: "guard",
      status: "warn",
      detail: `${enabled.join(", ")} enabled, but this repo has no egress consent: dormant`,
      fix: "grant consent (see the consent check), or turn it off with `decide guard disable <pack>`",
      // The consent check already stands between this shell and a live decision.
      advisory: true,
    }
  }
  const codex = codexHookTrust(env, home)
  if (codex === "untrusted") {
    return {
      name: "guard",
      status: "warn",
      detail: `active: ${enabled.join(", ")}; but Codex hasn't trusted the system1 hooks, so it skips them without a word`,
      fix: "open Codex interactively in this repo once and trust the system1 hooks when it asks (after a plugin update it may ask again)",
      advisory: true,
    }
  }
  // The hook runs with SYSTEM1_NO_NPX: it never downloads. Run from npx's
  // cache, it finds this copy (as fast as a global install) until a plugin
  // update or a cache clean removes it; then the check is skipped silently.
  if (cliPath && /[\\/]_npx[\\/]/.test(cliPath)) {
    return {
      name: "guard",
      status: "warn",
      detail: `active: ${enabled.join(", ")}; but decide runs from npx's cache, which the hooks never download into: after a plugin update or an npm cache clean, the check is skipped silently until decide runs once`,
      fix: "npm i -g @garygentry/system1",
      advisory: true,
    }
  }
  return { name: "guard", status: "ok", detail: `active: ${enabled.join(", ")}` }
}

/**
 * Codex runs a plugin's hooks only after the user trusts them, recorded per
 * hook in `$CODEX_HOME/config.toml` (M10 spike). `absent`: the system1 plugin
 * isn't installed in Codex, so there's nothing to trust. The hash itself
 * isn't checked: only that a trust entry exists for the Stop hook.
 */
export function codexHookTrust(
  env: NodeJS.ProcessEnv,
  home: string = homedir(),
): "absent" | "trusted" | "untrusted" {
  const file = join(env.CODEX_HOME?.trim() || join(home, ".codex"), "config.toml")
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return "absent"
  }
  const section = (header: RegExp): string[] => {
    const out: string[] = []
    const lines = text.split(/\r?\n/)
    lines.forEach((line, n) => {
      if (!header.test(line)) return
      const body: string[] = []
      for (const next of lines.slice(n + 1)) {
        if (/^\s*\[/.test(next)) break
        body.push(next)
      }
      out.push(body.join("\n"))
    })
    return out
  }
  const plugin = section(/^\s*\[plugins\."system1@[^"]+"\]\s*$/)
  if (plugin.length === 0 || plugin.every((b) => /^\s*enabled\s*=\s*false\b/m.test(b))) {
    return "absent"
  }
  // The key names the hooks file as Codex resolved it; match any form of it.
  const trust = section(
    /^\s*\[hooks\.state\."system1@[^"]+:[^"]*codex-hooks\.json:stop:[^"]*"\]\s*$/,
  )
  return trust.some((b) => /^\s*trusted_hash\s*=/m.test(b)) ? "trusted" : "untrusted"
}

/**
 * The routing hook stays silent on a config error rather than get in the
 * user's way, so this is where a bad pattern shows up.
 */
function routeCheck(config: ToolContext["config"]["route"]): DoctorCheck {
  try {
    route("", config)
    if (!config.enabled) {
      return {
        name: "route",
        status: "ok",
        detail: "routing hints are off (route.enabled or SYSTEM1_ROUTE)",
      }
    }
    const names = activeTriggers(config).map((t) => t.name)
    return {
      name: "route",
      status: "ok",
      detail: `routing hints on: ${names.length ? names.join(", ") : "no triggers"}`,
    }
  } catch (error) {
    return {
      name: "route",
      status: "warn",
      detail: `routing hints are silent: ${error instanceof Error ? error.message : String(error)}`,
      fix: 'correct route: in the config file (test it with `decide route --text "…"`)',
    }
  }
}

function backlogProblem(error: unknown): string {
  const problems = isDecisionsError(error) ? error.details?.problems : undefined
  const first = Array.isArray(problems) ? problems[0] : undefined
  const count =
    Array.isArray(problems) && problems.length > 1 ? ` (+${problems.length - 1} more)` : ""
  return `the backlog doesn't validate: ${first ?? (error instanceof Error ? error.message : String(error))}${count}`
}

/** The scout backlog is optional; a malformed one is worth knowing about before `list` fails on it. */
function backlogCheck(repoRoot: string): DoctorCheck {
  const file = backlogPath(repoRoot)
  if (!existsSync(file)) return { name: "backlog", status: "ok", detail: "no scout backlog yet" }
  try {
    const { opportunities } = readBacklog(file)
    return {
      name: "backlog",
      status: "ok",
      detail: `${opportunities.length} opportunit${opportunities.length === 1 ? "y" : "ies"} in ${file}`,
    }
  } catch (error) {
    return {
      name: "backlog",
      status: "warn",
      detail: backlogProblem(error),
      fix: "`decide opportunities check` lists every problem; correct the file by hand or move it aside (decide never repairs it)",
    }
  }
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

  if (config.warnings.length > 0) {
    checks.push({
      name: "config-keys",
      status: "warn",
      detail: `ignored: ${config.warnings.join("; ")}`,
      fix: "correct or remove these keys (docs/configuration.md lists every key)",
    })
  }
  const credentials = join(userConfigDir(env, options.home), "credentials")
  checks.push(
    config.apiKey && config.apiKeyQuoted
      ? {
          name: "key",
          status: "warn",
          detail: `OPENROUTER_API_KEY present (${config.apiKeySource}), but wrapped in quotes; they were removed`,
          fix:
            config.apiKeySource === "env"
              ? "set OPENROUTER_API_KEY without the surrounding quotes"
              : `remove the extra quotes around openrouter_api_key in ${credentials}`,
          advisory: true,
        }
      : config.apiKey
        ? {
            name: "key",
            status: "ok",
            detail: `OPENROUTER_API_KEY present (${config.apiKeySource})`,
          }
        : {
            name: "key",
            status: "warn",
            detail: "no API key: only replay works",
            // The file this shell would read: XDG_CONFIG_HOME moves it.
            fix: `set OPENROUTER_API_KEY, or write \`openrouter_api_key: <key>\` to ${credentials} (create its directory first; chmod 600)`,
          },
  )
  checks.push(
    config.egress.consent.granted
      ? { name: "consent", status: "ok", detail: `egress consent granted for ${config.repoRoot}` }
      : {
          name: "consent",
          status: "warn",
          detail: `no egress consent for ${config.repoRoot}: live calls are refused`,
          fix:
            "if the user agrees, they grant it themselves (an agent must not): " +
            "`decide config egress allow` in a terminal in this repo, or through their agent " +
            "prompt's shell escape (not as a chat message) with --confirm added",
        },
  )

  checks.push(routeCheck(config.route))
  checks.push(guardCheck(config, env, options.home, options.cliPath))
  checks.push(backlogCheck(config.repoRoot))
  checks.push(
    adoptedCheck(config.repoRoot),
    emulatedCheck(config.egress.allowProfiles),
    capturedCheck(config.repoRoot),
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
      fix: "correct SYSTEM1_ENDPOINT or `endpoint` in the config file",
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
      detail: "decide is not on PATH, so the System 1 plugin's bin/ is not loaded",
      fix: `npm i -g ${CLI_PACKAGE}@${VERSION} (also puts decide in your own terminal), or install the System 1 plugin from its marketplace`,
    }
  }
  return {
    name: "path",
    status: "warn",
    detail: "decide is not on PATH. Codex and Pi do not add plugin bin/ to PATH",
    fix: `npm i -g ${CLI_PACKAGE}@${VERSION}`,
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
    fix: `npm i -g ${CLI_PACKAGE}@${VERSION}, or remove the other decide (${path})`,
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
    return "the endpoint does not know this model: check SYSTEM1_MODEL / `model` and SYSTEM1_ENDPOINT / `endpoint`"
  if (httpStatus !== undefined && httpStatus >= 500)
    return `the provider answered HTTP ${httpStatus}: retry later`
  if (httpStatus !== undefined)
    return `the endpoint answered HTTP ${httpStatus}: check SYSTEM1_ENDPOINT / \`endpoint\``
  // Only a sandboxed Codex shell gets the rule: outside the sandbox (or with
  // the rule applied) a failure is an ordinary network problem. The flag also
  // beats the nesting heuristic (Codex inside Pi looks like Pi).
  if (sandboxed) {
    return `add \`${CODEX_RULE}\` to ${env.CODEX_HOME?.trim() || "~/.codex"}/rules/system1.rules, then restart Codex (it covers commands that start with decide; a pipe into decide stays offline)`
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
