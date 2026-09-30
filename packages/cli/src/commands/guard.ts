import {
  DecisionsError,
  type GuardPackConfig,
  isPackName,
  loadConfig,
  PACK_NAMES,
  PACKS,
  type PackName,
  repoConfigPath,
  setGuardEnabled,
} from "@garygentry/system1-core"
import { typedParse } from "../args.js"
import type { Format } from "../envelope.js"
import type { ExitCode } from "../exit-codes.js"
import type { Io } from "../io.js"
import { emit } from "../run.js"

/**
 * `decide guard [list] | status | enable <pack> | disable <pack>` (M10).
 *
 * Enabling a pack opts every matching harness event into egress, so it is a
 * consent act (plan X6) and follows `config egress allow`: it needs this
 * repo's egress consent first, then an interactive terminal or `--i-consent`
 * (the TTY-less form for a prompt's shell escape). The flag is not `--confirm`:
 * agents pass `--confirm` to approve spend, and that habit must not carry over.
 * Skills never pass it. Disabling needs neither: it only stops egress.
 */
export function runGuardCommand(argv: string[], io: Io, format: Format): Promise<ExitCode> {
  return emit(
    io,
    "guard",
    format,
    () => body(argv, io),
    (r, f) => (f === "brief" ? brief(r) : undefined),
  )
}

/** Flags of `guard`. Exported so `docs/cli.md` can be checked against them. */
export const GUARD_OPTIONS = { "i-consent": { type: "boolean" }, by: { type: "string" } } as const

interface PackStatus extends GuardPackConfig {
  name: PackName
  summary: string
  /** Enabled and consented: the hook will act on its events. */
  active: boolean
}

interface GuardResult {
  file: string
  consent: boolean
  packs: PackStatus[]
  /** Set by enable/disable. */
  changed?: PackName
}

function body(argv: string[], io: Io): GuardResult {
  const { values, positionals } = typedParse({
    args: argv,
    allowPositionals: true,
    options: GUARD_OPTIONS,
  })
  const [action = "list", name] = positionals
  const cwd = io.cwd ?? process.cwd()
  const load = () => loadConfig({ cwd, env: io.env, ...(io.home ? { home: io.home } : {}) })
  const config = load()
  const file = repoConfigPath(config.repoRoot)
  const result = (c = config, changed?: PackName): GuardResult => ({
    file,
    consent: c.egress.consent.granted,
    packs: PACK_NAMES.map((n) => ({
      name: n,
      summary: PACKS[n].summary,
      ...c.guard.packs[n],
      active: c.guard.packs[n].enabled && c.egress.consent.granted,
    })),
    ...(changed ? { changed } : {}),
  })
  switch (action) {
    case "list":
    case "status":
      return result()
    case "enable":
    case "disable": {
      const pack = packName(name)
      if (action === "disable") {
        setGuardEnabled(config.repoRoot, pack, false, values.by ?? "decide guard disable")
        return result(load(), pack)
      }
      if (!config.egress.consent.granted) {
        throw new DecisionsError(
          "egress-refused",
          `Enabling ${pack} sends content to the decision model's provider, and this repo has ` +
            "not agreed to that. Grant egress consent first (see `decide doctor`); it is the " +
            "user's decision, and an agent must not make it.",
          { repoRoot: config.repoRoot },
        )
      }
      if (!io.interactive && !values["i-consent"]) {
        throw new DecisionsError(
          "egress-refused",
          `Enabling a guard pack is the user's decision. An agent must not enable it, with or ` +
            `without a flag: show the user this message instead. The user enables it by typing ` +
            `\`decide guard enable ${pack}\` in a terminal at the repo root. If they run it ` +
            "through their agent prompt's shell escape instead (not as a chat message), there " +
            "is no terminal, so they add --i-consent to say the decision is theirs.",
        )
      }
      setGuardEnabled(
        config.repoRoot,
        pack,
        true,
        values.by ?? (io.interactive ? "decide guard" : "decide guard --i-consent"),
      )
      return result(load(), pack)
    }
    default:
      throw new DecisionsError(
        "invalid-request",
        `Unknown guard action "${action}". Use: list, status, enable <pack>, disable <pack>`,
      )
  }
}

function packName(name: string | undefined): PackName {
  if (name && isPackName(name)) return name
  throw new DecisionsError(
    "invalid-request",
    `${name ? `Unknown guard pack "${name}"` : "Name a guard pack"}. Known: ${PACK_NAMES.join(", ")}`,
  )
}

function brief(r: GuardResult): string {
  const lines = r.packs.map((p) => {
    const state = p.active
      ? "active"
      : p.enabled
        ? "enabled, but no egress consent: dormant"
        : "dormant"
    const asks =
      "askAboutMessage" in p && p.askAboutMessage
        ? " · also sends the agent's last message (askAboutMessage)"
        : ""
    return `${p.name}: ${state}${p.name === r.changed ? " (changed)" : ""}${asks} · ${p.summary}`
  })
  return [...lines, `egress consent: ${r.consent ? "granted" : "not granted"} (${r.file})`].join(
    "\n",
  )
}
