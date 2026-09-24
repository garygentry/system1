import { existsSync } from "node:fs"
import { DecisionsError } from "../errors.js"
import {
  type Backlog,
  backlogPath,
  mergeCandidates,
  type Opportunity,
  type OpportunityStatus,
  parseRecordFilter,
  parseRecordSort,
  readBacklog,
  readField,
  recordMatches,
  writeBacklog,
} from "../opportunities/backlog.js"
import { checkInput, type ToolContext } from "./context.js"
import type { OpportunitiesAddInput, OpportunitiesListInput } from "./schemas.js"

export interface OpportunitiesAddResult {
  file: string
  added: string[]
  updated: string[]
  /** `new` entries at a covered path that this add didn't see again. */
  staled: string[]
  total: number
}

/** Validate candidates and merge them into the backlog. Local only: nothing is sent. */
export function runOpportunitiesAdd(
  ctx: ToolContext,
  rawInput: unknown,
  now: () => Date = () => new Date(),
): OpportunitiesAddResult {
  const input = checkInput<OpportunitiesAddInput>("opportunities-add", rawInput)
  const file = backlogPath(ctx.config.repoRoot)
  const merged = mergeCandidates(readBacklog(file), input.candidates, now().toISOString())
  writeBacklog(file, merged.backlog)
  return {
    file,
    added: merged.added,
    updated: merged.updated,
    staled: merged.staled,
    total: merged.backlog.opportunities.length,
  }
}

export interface OpportunitiesListResult {
  file: string
  total: number
  /** Matching the filters, before `limit`. */
  matched: number
  /** Every saving here is projected: arithmetic over the inputs shown with it. */
  basis: "projected"
  opportunities: Array<Partial<Opportunity> & { id: string }>
}

export function runOpportunitiesList(
  ctx: ToolContext,
  rawInput: unknown = {},
): OpportunitiesListResult {
  const input = checkInput<OpportunitiesListInput>("opportunities-list", rawInput)
  const filters = (input.keep ?? []).map(parseRecordFilter)
  const sort = parseRecordSort(input.sort ?? "projected:desc")
  const file = backlogPath(ctx.config.repoRoot)
  const { opportunities } = readBacklog(file)
  const matched = opportunities
    .filter((o) => filters.every((f) => recordMatches(o, f)))
    .sort((a, b) => compare(readField(a, sort.field), readField(b, sort.field), sort.direction))
  const shown = input.limit === undefined ? matched : matched.slice(0, input.limit)
  return {
    file,
    total: opportunities.length,
    matched: matched.length,
    basis: "projected",
    opportunities: shown.map((o) => pick(o, input.fields)),
  }
}

export interface OpportunitiesCheckResult {
  file: string
  exists: boolean
  entries: number
  byStatus: Partial<Record<OpportunityStatus, number>>
}

/** Validate the backlog on disk. Malformed is a typed error (exit 2); nothing is repaired. */
export function runOpportunitiesCheck(
  ctx: ToolContext,
  rawInput: unknown = {},
): OpportunitiesCheckResult {
  checkInput("opportunities-check", rawInput)
  const file = backlogPath(ctx.config.repoRoot)
  const backlog: Backlog = readBacklog(file)
  const byStatus: OpportunitiesCheckResult["byStatus"] = {}
  for (const o of backlog.opportunities) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1
  return { file, exists: existsSync(file), entries: backlog.opportunities.length, byStatus }
}

/** Missing values sort last either way. */
function compare(a: unknown, b: unknown, direction: "asc" | "desc"): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1
  const order =
    typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))
  return direction === "asc" ? order : -order
}

function pick(o: Opportunity, fields?: readonly string[]): Partial<Opportunity> & { id: string } {
  if (!fields) return o
  const unknown = fields.filter((f) => !(f in o) && f !== "statusReason")
  if (unknown.length) {
    throw new DecisionsError(
      "invalid-request",
      `--fields: no field ${unknown.join(", ")}. Fields: ${Object.keys(o).join(", ")}`,
    )
  }
  const out: Record<string, unknown> = { id: o.id }
  for (const f of fields) if (f in o) out[f] = o[f as keyof Opportunity]
  return out as Partial<Opportunity> & { id: string }
}
