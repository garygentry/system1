/**
 * Guard packs (M10): hooks that check an agent's work at a harness event and
 * send content to the decision model when they do. Each pack is dormant until
 * the user enables it in this repo, on top of egress consent. Enabling is a
 * consent act (plan X6), so `enabled` is read only from the repo layer, like
 * `egress.consent` (decision 0009): a user-level setting can't switch on
 * egress in every repo.
 */

export const PACKS = {
  "done-check": {
    summary:
      "At Stop, checks the change against the criteria files' bullets and blocks once on a confidently unmet one",
    defaults: {
      latencyMs: 5000,
      maxUsdPerSession: 0.01,
      criteria: ["TASK.md", ".system1/done.md"],
      evidence: [] as string[],
    },
  },
} as const

export type PackName = keyof typeof PACKS

export const PACK_NAMES = Object.keys(PACKS) as PackName[]

export function isPackName(name: string): name is PackName {
  return Object.hasOwn(PACKS, name)
}

export interface GuardPackConfig {
  /** Only ever taken from the repo layer. */
  enabled: boolean
  /** When and how it was enabled, as `setGuardEnabled` recorded it. */
  enabledAt?: string
  enabledBy?: string
  /** The time a check may add at the event before it fails open. */
  latencyMs: number
  /** Measured spend per session (the ledger, by session id) before checks are skipped. */
  maxUsdPerSession: number
  /** Files whose bullets are the criteria, relative to the repo root. */
  criteria: string[]
  /** Extra files sent with the change as evidence, e.g. a test log. */
  evidence: string[]
}

export interface GuardConfig {
  packs: Record<PackName, GuardPackConfig>
}

type Layer = Record<string, unknown> | undefined

/** Keys a pack section may hold. The `enabled*` ones are read from the repo layer only. */
const PACK_KEYS = [
  "enabled",
  "enabledAt",
  "enabledBy",
  "latencyMs",
  "maxUsdPerSession",
  "criteria",
  "evidence",
] as const

/**
 * `guard:` from both layers, with warnings for everything ignored. Options:
 * the repo wins over the user, then the pack default; a list is taken whole
 * from the first layer that sets it. A value of the wrong type is ignored
 * with a warning, like the other config keys, so a bad file never stops
 * `decide`.
 */
export function readGuard(
  user: Layer,
  userFile: string,
  repo: Layer,
  repoFile: string,
  warnings: string[],
): GuardConfig {
  // Repo first: it wins.
  const layers = [
    { packs: packSections(repo, repoFile, warnings), file: repoFile, which: "repo" as const },
    { packs: packSections(user, userFile, warnings), file: userFile, which: "user" as const },
  ]
  const packs = {} as Record<PackName, GuardPackConfig>
  for (const name of PACK_NAMES) {
    const defaults = PACKS[name].defaults
    const pack: GuardPackConfig = {
      enabled: false,
      latencyMs: defaults.latencyMs,
      maxUsdPerSession: defaults.maxUsdPerSession,
      criteria: [...defaults.criteria],
      evidence: [...defaults.evidence],
    }
    const seen = new Set<string>()
    for (const { packs: sections, file, which } of layers) {
      const section = sections[name]
      if (!section) continue
      const set = <K extends keyof GuardPackConfig>(key: K, value: GuardPackConfig[K]) => {
        if (seen.has(key)) return
        seen.add(key)
        pack[key] = value
      }
      for (const [key, value] of Object.entries(section)) {
        if (value === undefined || value === null) continue
        const path = `guard.packs.${name}.${key}`
        if (!(PACK_KEYS as readonly string[]).includes(key)) {
          warnings.push(`${file}: unknown key ${path}`)
          continue
        }
        if (key.startsWith("enabled") && which === "user") {
          warnings.push(`${file}: ${path} is read only from the repo file (ignored)`)
          continue
        }
        const bad = (expected: string) =>
          warnings.push(`${file}: ${path} must be ${expected} (ignored)`)
        switch (key) {
          case "enabled":
            if (typeof value === "boolean") set("enabled", value)
            else bad("true or false")
            break
          case "enabledAt":
          case "enabledBy":
            if (typeof value === "string" && value.trim()) set(key, value)
            else bad("text")
            break
          case "latencyMs":
            if (typeof value === "number" && Number.isFinite(value) && value > 0) set(key, value)
            else bad("a number above 0")
            break
          case "maxUsdPerSession":
            if (typeof value === "number" && Number.isFinite(value) && value >= 0) set(key, value)
            else bad("a number of at least 0")
            break
          case "criteria":
          case "evidence":
            if (Array.isArray(value) && value.every((v) => typeof v === "string" && v.trim()))
              set(key, value as string[])
            else bad("a list of file paths")
            break
        }
      }
    }
    packs[name] = pack
  }
  return { packs }
}

/** The `guard.packs` mappings of one layer, by pack name; anything else is a warning. */
function packSections(
  layer: Layer,
  file: string,
  warnings: string[],
): Partial<Record<PackName, Record<string, unknown>>> {
  const guard = layer?.guard
  if (guard === undefined || guard === null) return {}
  if (!isMapping(guard)) {
    warnings.push(`${file}: guard must be a mapping (ignored)`)
    return {}
  }
  for (const key of Object.keys(guard)) {
    if (key !== "packs") warnings.push(`${file}: unknown key guard.${key}`)
  }
  const packs = guard.packs
  if (packs === undefined || packs === null) return {}
  if (!isMapping(packs)) {
    warnings.push(`${file}: guard.packs must be a mapping (ignored)`)
    return {}
  }
  const out: Partial<Record<PackName, Record<string, unknown>>> = {}
  for (const [name, section] of Object.entries(packs)) {
    if (!isPackName(name)) {
      warnings.push(`${file}: unknown guard pack ${name} (known: ${PACK_NAMES.join(", ")})`)
      continue
    }
    if (section === undefined || section === null) continue
    if (!isMapping(section)) {
      warnings.push(`${file}: guard.packs.${name} must be a mapping (ignored)`)
      continue
    }
    out[name] = section
  }
  return out
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
