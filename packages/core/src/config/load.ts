/**
 * Layered configuration:
 *
 *   defaults → user (`$XDG_CONFIG_HOME/decisions/config.yaml`)
 *            → repo (`<repo>/.decisions/config.yaml`) → env
 *
 * Later layers win. There is one exception: egress consent is read **only**
 * from the repo layer. Consent is per repo (decision 0009), so a user-level
 * grant is ignored rather than silently covering every repo.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { parse } from "yaml"
import { DecisionsError } from "../errors.js"
import { DEFAULT_MODEL_ID, type ModelProfile, PROFILES } from "../model/profiles.js"
import { DEFAULT_ENDPOINT, DEFAULT_TIMEOUT_MS } from "../transport/openrouter.js"
import { type DetectedSession, detectSession } from "./session.js"

export interface Consent {
  granted: boolean
  /** ISO timestamp of the grant. */
  at?: string
  /** Free text, e.g. who granted it or through which harness. */
  by?: string
}

export interface Budget {
  /** Above this many calls, a request needs explicit confirmation. */
  maxCalls: number
  /** Above this projected USD, a request needs explicit confirmation. */
  maxUsd: number
}

export interface DecisionsConfig {
  model: string
  endpoint: string
  /** Server-side cap on simultaneous calls in a fan-out. */
  concurrency: number
  /** Per-attempt request timeout. */
  timeoutMs: number
  budget: Budget
  egress: {
    /** Only ever taken from the repo layer. */
    consent: Consent
    /** Extra path patterns never to send, on top of the defaults. */
    exclude: string[]
  }
  /** Extra model profiles, on top of the built-in ones. */
  profiles: ModelProfile[]
}

export interface ResolvedConfig extends DecisionsConfig {
  repoRoot: string
  /** Absent when no key is configured. Never printed. */
  apiKey: string | undefined
  apiKeySource: "env" | "credentials" | undefined
  replay: boolean
  /** `DECISIONS_SESSION`, else the harness session id (`claude:…`, `codex:…`, `pi:…`). */
  session: string | undefined
  sessionOrigin: DetectedSession["origin"] | undefined
  /** Which files contributed, for `decide config`. */
  layers: { user?: string; repo?: string; credentials?: string }
}

export const DEFAULTS: DecisionsConfig = {
  model: DEFAULT_MODEL_ID,
  endpoint: DEFAULT_ENDPOINT,
  concurrency: 8,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  budget: { maxCalls: 200, maxUsd: 0.05 },
  egress: { consent: { granted: false }, exclude: [] },
  profiles: [],
}

/** Walk up from `cwd` to the nearest directory holding `.decisions/` or `.git`; else `cwd`. */
export function findRepoRoot(cwd: string): string {
  let dir = resolve(cwd)
  while (true) {
    if (existsSync(join(dir, ".decisions")) || existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) return resolve(cwd)
    dir = parent
  }
}

export function userConfigDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const base = env.XDG_CONFIG_HOME?.trim() ? env.XDG_CONFIG_HOME : join(home, ".config")
  return join(base, "decisions")
}

/** Where a repo keeps its decisions state: config, fixtures, the spend ledger. */
export function stateDir(repoRoot: string): string {
  return join(repoRoot, ".decisions")
}

export function repoConfigPath(repoRoot: string): string {
  return join(repoRoot, ".decisions", "config.yaml")
}

export interface LoadOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  home?: string
}

export function loadConfig(options: LoadOptions = {}): ResolvedConfig {
  const env = options.env ?? process.env
  const repoRoot = findRepoRoot(options.cwd ?? process.cwd())
  const userDir = userConfigDir(env, options.home)
  const userFile = join(userDir, "config.yaml")
  const repoFile = repoConfigPath(repoRoot)

  const user = readLayer(userFile)
  const repo = readLayer(repoFile)

  const merged: DecisionsConfig = {
    model: pick("model", "string", repo, user) ?? DEFAULTS.model,
    endpoint: pick("endpoint", "string", repo, user) ?? DEFAULTS.endpoint,
    concurrency: pick("concurrency", "number", repo, user) ?? DEFAULTS.concurrency,
    timeoutMs: pick("timeoutMs", "number", repo, user) ?? DEFAULTS.timeoutMs,
    budget: {
      maxCalls: pickIn("budget", "maxCalls", repo, user) ?? DEFAULTS.budget.maxCalls,
      maxUsd: pickIn("budget", "maxUsd", repo, user) ?? DEFAULTS.budget.maxUsd,
    },
    egress: {
      consent: readConsent(repo, repoFile),
      exclude: [
        ...stringList(user, "egress.exclude", userFile),
        ...stringList(repo, "egress.exclude", repoFile),
      ],
    },
    profiles: [...profileList(user, userFile), ...profileList(repo, repoFile)],
  }

  const key = resolveApiKey(env, userDir)
  const session = detectSession(env)
  return {
    ...merged,
    model: nonEmpty(env.DECISIONS_MODEL) ?? merged.model,
    endpoint: nonEmpty(env.DECISIONS_ENDPOINT) ?? merged.endpoint,
    repoRoot,
    apiKey: key?.value,
    apiKeySource: key?.source,
    replay: /^(1|true|yes)$/i.test(env.DECISIONS_REPLAY ?? ""),
    session: session?.id,
    sessionOrigin: session?.origin,
    layers: {
      ...(user ? { user: userFile } : {}),
      ...(repo ? { repo: repoFile } : {}),
      ...(key?.file ? { credentials: key.file } : {}),
    },
  }
}

/** All profiles the config knows: built-ins first, config additions after. */
export function allProfiles(config: Pick<DecisionsConfig, "profiles">): ModelProfile[] {
  return [...PROFILES, ...config.profiles]
}

// ---------------------------------------------------------------------------

type Layer = Record<string, unknown> | undefined

function readLayer(file: string): Layer {
  if (!existsSync(file)) return undefined
  let parsed: unknown
  try {
    parsed = parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new DecisionsError("config-error", `${file} is not valid YAML: ${String(error)}`, {
      file,
    })
  }
  if (parsed === null || parsed === undefined) return {}
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DecisionsError("config-error", `${file} must be a YAML mapping`, { file })
  }
  return parsed as Record<string, unknown>
}

function pick<T extends "string" | "number">(
  key: string,
  type: T,
  ...layers: Layer[]
): (T extends "string" ? string : number) | undefined {
  for (const layer of layers) {
    const value = layer?.[key]
    if (typeof value === type) return value as T extends "string" ? string : number
  }
  return undefined
}

function pickIn(section: string, key: string, ...layers: Layer[]): number | undefined {
  for (const layer of layers) {
    const value = (layer?.[section] as Record<string, unknown> | undefined)?.[key]
    if (typeof value === "number" && value >= 0) return value
  }
  return undefined
}

function readConsent(repo: Layer, file: string): Consent {
  const consent = (repo?.egress as Record<string, unknown> | undefined)?.consent
  if (consent === undefined) return { granted: false }
  if (
    typeof consent !== "object" ||
    consent === null ||
    typeof (consent as Consent).granted !== "boolean"
  ) {
    throw new DecisionsError(
      "config-error",
      `${file}: egress.consent must be {granted: true|false, at?, by?}`,
      { file },
    )
  }
  const { granted, at, by } = consent as Consent
  return {
    granted,
    ...(typeof at === "string" ? { at } : {}),
    ...(typeof by === "string" ? { by } : {}),
  }
}

function stringList(layer: Layer, path: string, file: string): string[] {
  const value = (layer?.egress as Record<string, unknown> | undefined)?.exclude
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new DecisionsError("config-error", `${file}: ${path} must be a list of glob patterns`, {
      file,
    })
  }
  return value
}

function profileList(layer: Layer, file: string): ModelProfile[] {
  const value = layer?.profiles
  if (value === undefined) return []
  if (!Array.isArray(value))
    throw new DecisionsError("config-error", `${file}: profiles must be a list`, { file })
  return value.map((p, i) => {
    const profile = p as Partial<ModelProfile>
    const ok =
      typeof profile.id === "string" &&
      typeof profile.maxStateTokens === "number" &&
      typeof profile.usdPerInputToken === "number" &&
      typeof profile.undecidedFloor === "number"
    if (!ok) {
      throw new DecisionsError(
        "config-error",
        `${file}: profiles[${i}] needs id, maxStateTokens, usdPerInputToken and undecidedFloor`,
        { file },
      )
    }
    return {
      displayName: profile.id as string,
      transport: "openrouter-decisions",
      usdPerOutputToken: 0,
      priceAsOf: "unknown",
      calibrated: true,
      ...profile,
    } as ModelProfile
  })
}

/**
 * The API key: `OPENROUTER_API_KEY` first, then the user credentials file.
 *
 * The credentials file holds `openrouter_api_key: sk-…` and must not be
 * readable by group or others, the same rule ssh applies to private keys.
 */
function resolveApiKey(
  env: NodeJS.ProcessEnv,
  userDir: string,
): { value: string; source: "env" | "credentials"; file?: string } | undefined {
  const fromEnv = nonEmpty(env.OPENROUTER_API_KEY)
  if (fromEnv) return { value: fromEnv, source: "env" }
  const file = join(userDir, "credentials")
  if (!existsSync(file)) return undefined
  if (process.platform !== "win32" && (statSync(file).mode & 0o077) !== 0) {
    throw new DecisionsError(
      "config-error",
      `${file} is readable by other users. Run \`chmod 600 ${file}\`.`,
      { file },
    )
  }
  const parsed = readLayer(file)
  const value = nonEmpty(
    typeof parsed?.openrouter_api_key === "string" ? parsed.openrouter_api_key : undefined,
  )
  return value ? { value, source: "credentials", file } : undefined
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim()
}
