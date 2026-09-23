/**
 * Layered configuration:
 *
 *   defaults → user (`$XDG_CONFIG_HOME/system1/config.yaml`)
 *            → repo (`<repo>/.system1/config.yaml`) → env
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
import { ROUTE_DEFAULTS, type RouteConfig, type Trigger } from "../route/route.js"
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
  /** Prompt routing hints for harness hooks (decision 0018). */
  route: RouteConfig
}

export interface ResolvedConfig extends DecisionsConfig {
  repoRoot: string
  /** Absent when no key is configured. Never printed. */
  apiKey: string | undefined
  apiKeySource: "env" | "credentials" | undefined
  replay: boolean
  /** `SYSTEM1_SESSION`, else the harness session id (`claude:…`, `codex:…`, `pi:…`). */
  session: string | undefined
  sessionOrigin: DetectedSession["origin"] | undefined
  /** Which files contributed, for `decide config`. */
  layers: { user?: string; repo?: string; credentials?: string }
  /**
   * Keys and values the files hold but loading ignored: an unknown key or a
   * value of the wrong type. Ignored rather than refused so an old or
   * hand-edited file never stops `decide`; `doctor` reports each one.
   */
  warnings: string[]
}

export const DEFAULTS: DecisionsConfig = {
  model: DEFAULT_MODEL_ID,
  endpoint: DEFAULT_ENDPOINT,
  concurrency: 8,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  budget: { maxCalls: 200, maxUsd: 0.05 },
  egress: { consent: { granted: false }, exclude: [] },
  profiles: [],
  route: ROUTE_DEFAULTS,
}

/** Walk up from `cwd` to the nearest directory holding `.system1/` or `.git`; else `cwd`. */
export function findRepoRoot(cwd: string): string {
  let dir = resolve(cwd)
  while (true) {
    if (existsSync(join(dir, ".system1")) || existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) return resolve(cwd)
    dir = parent
  }
}

export function userConfigDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const base = env.XDG_CONFIG_HOME?.trim() ? env.XDG_CONFIG_HOME : join(home, ".config")
  return join(base, "system1")
}

/** Where a repo keeps its decisions state: config, fixtures, the spend ledger. */
export function stateDir(repoRoot: string): string {
  return join(repoRoot, ".system1")
}

export function repoConfigPath(repoRoot: string): string {
  return join(repoRoot, ".system1", "config.yaml")
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
  const warnings = [...unknownKeys(user, userFile, "user"), ...unknownKeys(repo, repoFile, "repo")]
  // Repo first: it wins over the user layer.
  const layers = [
    { layer: repo, file: repoFile },
    { layer: user, file: userFile },
  ]
  const pickFrom = <T>(path: string, rule: Rule<T>) => pick(path, rule, layers, warnings)

  const merged: DecisionsConfig = {
    model: pickFrom("model", TEXT) ?? DEFAULTS.model,
    endpoint: pickFrom("endpoint", URL_TEXT) ?? DEFAULTS.endpoint,
    concurrency: pickFrom("concurrency", WHOLE) ?? DEFAULTS.concurrency,
    timeoutMs: pickFrom("timeoutMs", POSITIVE) ?? DEFAULTS.timeoutMs,
    budget: {
      maxCalls: pickFrom("budget.maxCalls", NON_NEGATIVE) ?? DEFAULTS.budget.maxCalls,
      maxUsd: pickFrom("budget.maxUsd", NON_NEGATIVE) ?? DEFAULTS.budget.maxUsd,
    },
    egress: {
      consent: readConsent(repo, repoFile),
      exclude: [
        ...stringList(user, "egress.exclude", userFile),
        ...stringList(repo, "egress.exclude", repoFile),
      ],
    },
    profiles: [...profileList(user, userFile, warnings), ...profileList(repo, repoFile, warnings)],
    route: readRoute(user, userFile, repo, repoFile, env),
  }

  const key = resolveApiKey(env, userDir)
  const session = detectSession(env)
  return {
    ...merged,
    model: nonEmpty(env.SYSTEM1_MODEL) ?? merged.model,
    endpoint: nonEmpty(env.SYSTEM1_ENDPOINT) ?? merged.endpoint,
    repoRoot,
    apiKey: key?.value,
    apiKeySource: key?.source,
    replay: /^(1|true|yes)$/i.test(env.SYSTEM1_REPLAY ?? ""),
    session: session?.id,
    sessionOrigin: session?.origin,
    layers: {
      ...(user ? { user: userFile } : {}),
      ...(repo ? { repo: repoFile } : {}),
      ...(key?.file ? { credentials: key.file } : {}),
    },
    warnings,
  }
}

/**
 * All profiles the config knows: built-ins first, config additions after. A
 * config profile with a built-in's id replaces it in place, and a repo profile
 * replaces a user one, so later layers win here as everywhere else.
 */
export function allProfiles(config: Pick<DecisionsConfig, "profiles">): ModelProfile[] {
  const byId = new Map<string, ModelProfile>()
  for (const profile of [...PROFILES, ...config.profiles]) byId.set(profile.id, profile)
  return [...byId.values()]
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

/** Top-level keys, and keys of the plain sections, that loading reads. */
const KNOWN: Record<string, readonly string[]> = {
  "": ["model", "endpoint", "concurrency", "timeoutMs", "budget", "egress", "profiles", "route"],
  budget: ["maxCalls", "maxUsd"],
  egress: ["consent", "exclude"],
}

/**
 * Warnings for what a layer holds but loading never reads: unknown keys, a
 * section that isn't a mapping, and consent in the user file (read only from
 * the repo, decision 0009). A key set to nothing (`budget:`) counts as unset.
 */
function unknownKeys(layer: Layer, file: string, which: "user" | "repo"): string[] {
  if (!layer) return []
  const warnings = Object.keys(layer)
    .filter((k) => !KNOWN[""]?.includes(k))
    .map((key) => `${file}: unknown key ${key}`)
  for (const section of ["budget", "egress"]) {
    const value = layer[section]
    if (value === undefined || value === null) continue
    if (!isMapping(value)) {
      warnings.push(`${file}: ${section} must be a mapping (ignored)`)
      continue
    }
    for (const key of Object.keys(value)) {
      if (!KNOWN[section]?.includes(key)) warnings.push(`${file}: unknown key ${section}.${key}`)
    }
  }
  const egress = layer.egress
  if (which === "user" && isMapping(egress) && egress.consent !== undefined) {
    warnings.push(`${file}: egress.consent is read only from the repo file (ignored)`)
  }
  return warnings
}

interface Rule<T> {
  ok: (value: unknown) => value is T
  /** Completes "<key> must be …". */
  expected: string
}

const TEXT: Rule<string> = { ok: (v): v is string => typeof v === "string", expected: "text" }
const URL_TEXT: Rule<string> = {
  ok: (v): v is string =>
    typeof v === "string" && URL.canParse(v) && /^https?:$/.test(new URL(v).protocol),
  expected: "an http(s) URL",
}
const WHOLE: Rule<number> = {
  ok: (v): v is number => Number.isInteger(v) && (v as number) >= 1,
  expected: "a whole number of at least 1",
}
const POSITIVE: Rule<number> = {
  ok: (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0,
  expected: "a number above 0",
}
const NON_NEGATIVE: Rule<number> = {
  ok: (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0,
  expected: "a number of at least 0",
}

/**
 * The first layer's valid value at `path` (`key` or `section.key`). A value
 * that breaks the rule is skipped, so the next layer (or the default) applies.
 * Every layer is checked, so a bad value warns whichever layer wins. A key set
 * to nothing (`model:`) counts as unset.
 */
function pick<T>(
  path: string,
  rule: Rule<T>,
  layers: Array<{ layer: Layer; file: string }>,
  warnings: string[],
): T | undefined {
  let found: T | undefined
  for (const { layer, file } of layers) {
    const [head, key] = path.split(".") as [string, string?]
    let value = layer?.[head]
    // A section that isn't a mapping is reported once, by unknownKeys.
    if (key !== undefined) value = isMapping(value) ? value[key] : undefined
    if (value === undefined || value === null) continue
    if (!rule.ok(value)) warnings.push(`${file}: ${path} must be ${rule.expected} (ignored)`)
    else if (found === undefined) found = value
  }
  return found
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readConsent(repo: Layer, file: string): Consent {
  const consent = (repo?.egress as Record<string, unknown> | undefined)?.consent
  if (consent === undefined || consent === null) return { granted: false }
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
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new DecisionsError("config-error", `${file}: ${path} must be a list of glob patterns`, {
      file,
    })
  }
  return value
}

/** The fields a config profile may set. Anything else is dropped with a warning. */
const PROFILE_FIELDS: readonly (keyof ModelProfile)[] = [
  "id",
  "displayName",
  "transport",
  "maxStateTokens",
  "maxChoices",
  "usdPerInputToken",
  "usdPerOutputToken",
  "priceAsOf",
  "undecidedFloor",
  "calibrated",
]

function profileList(layer: Layer, file: string, warnings: string[]): ModelProfile[] {
  const value = layer?.profiles
  if (value === undefined || value === null) return []
  if (!Array.isArray(value))
    throw new DecisionsError("config-error", `${file}: profiles must be a list`, { file })
  return value.map((p, i) => {
    const profile = { ...(p as object) } as Partial<ModelProfile>
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
    if (
      profile.maxChoices !== undefined &&
      !(Number.isInteger(profile.maxChoices) && (profile.maxChoices as number) >= 2)
    ) {
      throw new DecisionsError(
        "config-error",
        `${file}: profiles[${i}].maxChoices must be a whole number of at least 2`,
        { file },
      )
    }
    const extra = Object.keys(profile).filter(
      (k) => !PROFILE_FIELDS.includes(k as keyof ModelProfile),
    )
    for (const key of extra) {
      warnings.push(`${file}: unknown key profiles[${i}].${key} (ignored)`)
      delete (profile as Record<string, unknown>)[key]
    }
    // A field with no value (`priceAsOf:`) is unset, so the default applies.
    for (const [key, v] of Object.entries(profile)) {
      if (v === null) delete (profile as Record<string, unknown>)[key]
    }
    return {
      displayName: profile.id as string,
      transport: "openrouter-decisions",
      usdPerOutputToken: 0,
      priceAsOf: "unknown",
      calibrated: true,
      // Same wire contract as Jev unless the config says otherwise.
      maxChoices: 255,
      ...profile,
    } as ModelProfile
  })
}

/**
 * `route:` from both layers. Scalars: the repo wins over the user. Lists
 * (`disable`, `triggers`, `ignore`) add up, user first. `SYSTEM1_ROUTE=off`
 * switches hints off whatever the files say.
 */
function readRoute(
  user: Layer,
  userFile: string,
  repo: Layer,
  repoFile: string,
  env: NodeJS.ProcessEnv,
): RouteConfig {
  const sections = [
    { layer: section(user, "route", userFile), file: userFile },
    { layer: section(repo, "route", repoFile), file: repoFile },
  ]
  const known = ["enabled", "builtin", "disable", "triggers", "ignore", "message"]
  const route: RouteConfig = { ...ROUTE_DEFAULTS, disable: [], triggers: [], ignore: [] }
  for (const { layer, file } of sections) {
    if (!layer) continue
    const extra = Object.keys(layer).filter((k) => !known.includes(k))
    if (extra.length > 0) {
      throw new DecisionsError(
        "config-error",
        `${file}: unknown route key(s) ${extra.join(", ")}. Known: ${known.join(", ")}`,
        { file },
      )
    }
    for (const key of ["enabled", "builtin"] as const) {
      const v = layer[key]
      if (v === undefined) continue
      if (typeof v !== "boolean")
        throw new DecisionsError("config-error", `${file}: route.${key} must be true or false`, {
          file,
        })
      route[key] = v
    }
    if (layer.message !== undefined) {
      if (typeof layer.message !== "string" || !layer.message.trim())
        throw new DecisionsError("config-error", `${file}: route.message must be text`, { file })
      route.message = layer.message
    }
    for (const key of ["disable", "ignore"] as const) {
      const v = layer[key]
      if (v === undefined) continue
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string"))
        throw new DecisionsError(
          "config-error",
          `${file}: route.${key} must be a list of strings`,
          { file },
        )
      route[key].push(...v)
    }
    if (layer.triggers !== undefined) route.triggers.push(...triggerList(layer.triggers, file))
  }
  if (/^(0|off|false|no)$/i.test(env.SYSTEM1_ROUTE ?? "")) route.enabled = false
  return route
}

function section(layer: Layer, key: string, file: string): Record<string, unknown> | undefined {
  const value = layer?.[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== "object" || Array.isArray(value))
    throw new DecisionsError("config-error", `${file}: ${key} must be a mapping`, { file })
  return value as Record<string, unknown>
}

function triggerList(value: unknown, file: string): Trigger[] {
  if (!Array.isArray(value))
    throw new DecisionsError("config-error", `${file}: route.triggers must be a list`, { file })
  return value.map((t, i) => {
    const { name, pattern } = (t ?? {}) as Partial<Trigger>
    if (typeof name !== "string" || !name.trim() || typeof pattern !== "string" || !pattern) {
      throw new DecisionsError(
        "config-error",
        `${file}: route.triggers[${i}] needs a name and a pattern (a regular expression)`,
        { file },
      )
    }
    return { name, pattern }
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
