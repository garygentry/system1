import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  createContext,
  DecisionsError,
  type OpportunitiesAddResult,
  type OpportunitiesCheckResult,
  type OpportunitiesListResult,
  runOpportunitiesAdd,
  runOpportunitiesCheck,
  runOpportunitiesList,
} from "@garygentry/system1-core"
import { typedParse } from "../args.js"
import type { Format } from "../envelope.js"
import type { ExitCode } from "../exit-codes.js"
import type { Io } from "../io.js"
import { emit } from "../run.js"

/** Flags of `opportunities`. Exported so `docs/cli.md` can be checked against them. */
export const OPPORTUNITIES_OPTIONS = {
  file: { type: "string" },
  keep: { type: "string", multiple: true },
  sort: { type: "string" },
  limit: { type: "string" },
  fields: { type: "string" },
} as const

const USAGE =
  "Usage: decide opportunities add --file <candidates.json> | list [--keep …] [--sort …] [--limit N] [--fields a,b] | check"

/**
 * `decide opportunities add|list|check`: the scout backlog in
 * `.system1/opportunities.json`. Local only; nothing here is sent anywhere.
 */
export function runOpportunitiesCommand(argv: string[], io: Io, format: Format): Promise<ExitCode> {
  const [action, ...rest] = argv
  const ctx = () => createContext({ ...io, cwd: io.cwd ?? process.cwd(), env: io.env })
  const cwd = io.cwd ?? process.cwd()
  switch (action) {
    case "add":
      return emit<OpportunitiesAddResult>(
        io,
        "opportunities",
        format,
        () => {
          const { values } = parse(rest, ["file"])
          if (!values.file) throw new DecisionsError("invalid-request", USAGE)
          return runOpportunitiesAdd(ctx(), {
            candidates: readCandidates(resolve(cwd, values.file), values.file),
          })
        },
        (r, f) =>
          f === "brief"
            ? `decide opportunities add: ${r.added.length} added · ${r.updated.length} updated · ${r.staled.length} marked stale · ${r.total} in ${r.file}`
            : undefined,
      )
    case "list":
      return emit<OpportunitiesListResult>(
        io,
        "opportunities",
        format,
        () => {
          const { values } = parse(rest, ["keep", "sort", "limit", "fields"])
          if (values.limit !== undefined && !/^\d+$/.test(values.limit)) {
            throw new DecisionsError("invalid-request", "--limit must be a whole number")
          }
          return runOpportunitiesList(ctx(), {
            ...(values.keep?.length ? { keep: values.keep } : {}),
            ...(values.sort ? { sort: values.sort } : {}),
            ...(values.limit !== undefined ? { limit: Number(values.limit) } : {}),
            ...(values.fields
              ? {
                  fields: values.fields
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                }
              : {}),
          })
        },
        (r, f) => (f === "brief" ? briefList(r) : undefined),
      )
    case "check":
      return emit<OpportunitiesCheckResult>(
        io,
        "opportunities",
        format,
        () => {
          parse(rest, [])
          return runOpportunitiesCheck(ctx())
        },
        (r, f) =>
          f === "brief"
            ? r.exists
              ? `decide opportunities check: valid · ${r.entries} entr${r.entries === 1 ? "y" : "ies"}${
                  Object.keys(r.byStatus).length
                    ? ` (${Object.entries(r.byStatus)
                        .map(([s, n]) => `${n} ${s}`)
                        .join(", ")})`
                    : ""
                } · ${r.file}`
              : `decide opportunities check: no backlog yet (${r.file})`
            : undefined,
      )
    default:
      return emit(io, "opportunities", format, () => {
        throw new DecisionsError("invalid-request", USAGE)
      })
  }
}

/** Only the flags an action takes; any other is a usage error. */
function parse(argv: string[], allowed: Array<keyof typeof OPPORTUNITIES_OPTIONS>) {
  const options = Object.fromEntries(allowed.map((k) => [k, OPPORTUNITIES_OPTIONS[k]]))
  return typedParse({ args: argv, options, strict: true }) as {
    values: { file?: string; keep?: string[]; sort?: string; limit?: string; fields?: string }
  }
}

/** A JSON array of candidates, or `{candidates: [...]}`. No stdin: the Codex rule doesn't cover a pipe. */
function readCandidates(path: string, ref: string): unknown {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    throw new DecisionsError("invalid-request", `--file: cannot read ${ref}`)
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new DecisionsError(
      "invalid-request",
      `--file ${ref}: not JSON (${(error as Error).message})`,
    )
  }
  if (Array.isArray(value)) return value
  if (value && typeof value === "object" && "candidates" in value) {
    const extra = Object.keys(value).filter((k) => k !== "candidates")
    if (extra.length) {
      throw new DecisionsError(
        "invalid-request",
        `--file ${ref}: unknown key(s) ${extra.join(", ")}; only "candidates" is read`,
      )
    }
    return (value as { candidates: unknown }).candidates
  }
  throw new DecisionsError(
    "invalid-request",
    `--file ${ref}: expected a JSON array of candidates, or {"candidates": [...]}`,
  )
}

function briefList(r: OpportunitiesListResult): string {
  const lines = [
    `decide opportunities list: ${r.opportunities.length} shown · ${r.matched} matched · ${r.total} total · savings projected`,
  ]
  for (const o of r.opportunities) {
    const where = o.location
      ? `${o.location.path}${o.location.lines ? `:${o.location.lines.start}-${o.location.lines.end}` : ""}`
      : ""
    const saving = o.projected
      ? ` · $${o.projected.savingUsd} per ${o.projected.per} (projected)`
      : ""
    const head = [o.id, o.status, o.mode, o.shape, o.risk ? `risk ${o.risk.level}` : undefined]
      .filter(Boolean)
      .join(" · ")
    lines.push(`  ${head}${saving}${where ? `  ${where}` : ""}`)
    if (o.mechanism) lines.push(`      ${o.mechanism}`)
    if (o.statusReason) lines.push(`      ${o.status}: ${o.statusReason}`)
  }
  return lines.join("\n")
}
