import { assertConsent } from "../config/consent.js"
import type { DecisionResult } from "../decide.js"
import { DecisionsError, type ErrorCode, isDecisionsError } from "../errors.js"
import type { Answers, Usage } from "../model/types.js"
import { prepare } from "../prepare.js"
import { project } from "../project/project.js"
import { checkBudget, type Projection } from "../run/budget.js"
import { mapWithConcurrency } from "../run/pool.js"
import { type AnswerSource, sumUsage } from "../run/spend.js"
import type { Item, LineRange, Skipped } from "../sources/types.js"
import { checkInput, deciderFor, resolveRequest, type ToolContext } from "./context.js"
import type { ManyInput } from "./schemas.js"

export interface ResultRow {
  id: string
  path?: string
  lines?: LineRange
  /**
   * The start of the (scrubbed) text, for items whose id doesn't lead back to
   * it: piped items, and single lines such as grep hits split by row.
   */
  excerpt?: string
  /**
   * Answers of this row that came back too flat to act on. Present on kept
   * rows too: a question the projection didn't act on can still be undecided,
   * and hiding that would overstate the result.
   */
  undecided?: string[]
  answers: Answers
}

const EXCERPT = 120

export interface SkippedSummary {
  total: number
  byReason: Partial<Record<Skipped["reason"], number>>
  /** The first few, so the agent can see what kind of thing was withheld. */
  sample: Skipped[]
}

export interface ManyResult {
  dryRun: boolean
  spec?: string
  model: string
  /** How answers were produced: every item in one run shares the decider's mode. */
  source?: AnswerSource
  counts: {
    items: number
    kept: number
    /** Kept before `limit`. */
    keptTotal: number
    undecided: number
    dropped: number
    failed: number
    skipped: number
  }
  kept: ResultRow[]
  /** Too flat to judge: read these yourself, or ask a human. */
  undecided: Array<ResultRow & { questions: string[] }>
  failed: Array<{ id: string; code: ErrorCode | "error"; message: string }>
  skipped: SkippedSummary
  redactions: { total: number; items: number }
  /** Measured. Zero on a dry run or a replay. */
  usage: Usage
  projection: Projection
  wallClockMs: number
  /** Present on a dry run: the first item ids that would be sent. */
  sampleIds?: string[]
}

const SAMPLE = 5

/**
 * Fan-out: one question set over N items, each its own call, under the
 * concurrency cap. Only what survives `keep` comes back in full.
 */
export async function runMany(ctx: ToolContext, rawInput: unknown): Promise<ManyResult> {
  const input = checkInput<ManyInput>("many", rawInput)
  const started = performance.now()
  const req = resolveRequest(ctx, input)
  const prepared = await prepare({
    sources: req.sources,
    split: req.split,
    questions: req.questions,
    profile: req.profile,
    cwd: ctx.config.repoRoot,
    exclude: ctx.config.egress.exclude,
    filter: req.exclude,
    ...(input.allowOutside ? { allowOutside: true } : {}),
  })
  const base = {
    ...(req.spec ? { spec: req.spec.name } : {}),
    model: req.profile.id,
    skipped: summariseSkipped(prepared.skipped),
    redactions: { total: prepared.redactions.total, items: prepared.redactions.items },
    projection: prepared.projection,
  }

  if (input.dryRun) {
    return {
      ...base,
      dryRun: true,
      counts: counts(prepared.items.length, 0, 0, 0, 0, 0, prepared.skipped.length),
      kept: [],
      undecided: [],
      failed: [],
      usage: sumUsage([]),
      wallClockMs: Math.round(performance.now() - started),
      sampleIds: prepared.items.slice(0, SAMPLE).map((i) => i.id),
    }
  }

  const decider = deciderFor(ctx, req.profile, input.mode ?? "auto")
  if (decider.mode !== "replay") {
    // Fail once, up front, rather than N times inside the pool.
    assertConsent(ctx.config.egress.consent, ctx.config.repoRoot)
    checkBudget(prepared.projection, ctx.config.budget, input.confirm ?? false)
  }

  const concurrency = Math.min(input.concurrency ?? ctx.config.concurrency, ctx.config.concurrency)
  const settled = await mapWithConcurrency(prepared.items, concurrency, (item) =>
    decider.decide({ state: item.state, questions: req.questions, namespace: req.namespace }),
  )

  const done: Array<{ item: Item; result: DecisionResult }> = []
  const failed: ManyResult["failed"] = []
  settled.forEach((outcome, i) => {
    const item = prepared.items[i] as Item
    if ("value" in outcome) done.push({ item, result: outcome.value })
    else failed.push({ id: item.id, ...describe(outcome.error) })
  })

  // Every item failing the same way is a failure of the run, not of the items.
  const [first] = failed
  if (done.length === 0 && first && failed.every((f) => f.code === first.code)) {
    const { error } = settled.find((s) => "error" in s) as { error: Error }
    const details = isDecisionsError(error) ? error.details : {}
    throw new DecisionsError(
      first.code === "error" ? "invalid-request" : first.code,
      failed.length === 1 ? error.message : `All ${failed.length} items failed: ${error.message}`,
      { ...details, failed: failed.length },
    )
  }

  const rows = done.map(({ item, result }) => ({
    ...row(item, result.answers),
    flat: result.undecided,
  }))
  const projected = project({
    rows,
    keep: req.keep,
    ...(req.sort ? { sort: req.sort } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.fields ? { fields: input.fields } : {}),
    undecidedOf: (r) => r.flat,
  })
  const strip = ({ flat, ...rest }: (typeof rows)[number]): ResultRow => ({
    ...rest,
    ...(flat.length ? { undecided: [...flat] } : {}),
  })

  return {
    ...base,
    dryRun: false,
    source: decider.mode === "replay" ? "replay" : "live",
    counts: counts(
      prepared.items.length,
      projected.kept.length,
      projected.keptTotal,
      projected.undecided.length,
      projected.dropped,
      failed.length,
      prepared.skipped.length,
    ),
    kept: projected.kept.map(strip),
    undecided: projected.undecided.map(({ row, questions }) => ({ ...strip(row), questions })),
    failed,
    usage: sumUsage(done.map((d) => d.result.usage)),
    wallClockMs: Math.round(performance.now() - started),
  }
}

function row(item: Item, answers: Answers): ResultRow {
  return {
    id: item.id,
    ...(item.path ? { path: item.path } : {}),
    ...(item.lines ? { lines: item.lines } : {}),
    ...(traceable(item) ? {} : { excerpt: excerpt(item.state) }),
    answers,
  }
}

/**
 * Whether the id alone leads back to the text. Piped items have no file, and a
 * single line (a row of grep output, a log line) is only useful with its text.
 */
function traceable(item: Item): boolean {
  if (item.path === undefined) return false
  const oneLine = item.lines !== undefined && item.lines.start === item.lines.end
  return item.id === item.path || !oneLine
}

function excerpt(state: Item["state"]): string {
  const text = (typeof state === "string" ? state : JSON.stringify(state))
    .replace(/\s+/g, " ")
    .trim()
  return text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text
}

function counts(
  items: number,
  kept: number,
  keptTotal: number,
  undecided: number,
  dropped: number,
  failed: number,
  skipped: number,
) {
  return { items, kept, keptTotal, undecided, dropped, failed, skipped }
}

export function summariseSkipped(skipped: readonly Skipped[]): SkippedSummary {
  const byReason: SkippedSummary["byReason"] = {}
  for (const s of skipped) byReason[s.reason] = (byReason[s.reason] ?? 0) + 1
  // Show excluded (secret-shaped) paths first: they are the ones worth noticing.
  const ordered = [...skipped].sort(
    (a, b) => Number(b.reason === "excluded") - Number(a.reason === "excluded"),
  )
  return { total: skipped.length, byReason, sample: ordered.slice(0, SAMPLE) }
}

function describe(error: Error): { code: ErrorCode | "error"; message: string } {
  return isDecisionsError(error)
    ? { code: error.code, message: error.message }
    : { code: "error", message: error.message }
}
