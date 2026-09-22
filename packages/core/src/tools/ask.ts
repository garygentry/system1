import { DecisionsError } from "../errors.js"
import type { Answers, Usage } from "../model/types.js"
import { prepare } from "../prepare.js"
import { matches } from "../project/project.js"
import type { AnswerSource } from "../run/spend.js"
import type { LineRange } from "../sources/types.js"
import { checkInput, deciderFor, resolveRequest, type ToolContext } from "./context.js"
import { type SkippedSummary, summariseSkipped } from "./many.js"
import type { AskInput } from "./schemas.js"

export interface AskResult {
  spec?: string
  id: string
  path?: string
  lines?: LineRange
  source: AnswerSource
  model: string
  servedBy: string
  answers: Answers
  /** Answers too flat to act on. */
  undecided: string[]
  /**
   * With `keep`: whether this one state passes. Undecided on any question the
   * filters reference means `undecided`, never a pass or fail.
   */
  verdict?: "kept" | "dropped" | "undecided"
  usage: Usage
  latencyMs: number
  skipped: SkippedSummary
  redactions: { total: number; items: number }
}

/** One state, one question set, one call. The shape hooks and scripts want. */
export async function runAsk(ctx: ToolContext, rawInput: unknown): Promise<AskResult> {
  const input = checkInput<AskInput>("ask", rawInput)
  const req = resolveRequest(ctx, input)
  const prepared = await prepare({
    sources: req.sources,
    split: req.split,
    questions: req.questions,
    profile: req.profile,
    cwd: ctx.config.repoRoot,
    exclude: ctx.config.egress.exclude,
  })
  const [item, ...rest] = prepared.items
  if (!item || rest.length > 0) {
    const withheld = prepared.skipped.length
      ? ` (${prepared.skipped.length} withheld: ${prepared.skipped.map((s) => `${s.path} ${s.reason}`).join(", ")})`
      : ""
    throw new DecisionsError(
      "invalid-request",
      item
        ? `ask needs exactly one state, but the source gave ${prepared.items.length}. Use \`decide many\` to fan out.`
        : `The source gave nothing to ask about${withheld}.`,
      { items: prepared.items.length },
    )
  }

  const result = await deciderFor(ctx, req.profile, input.mode ?? "auto").decide({
    state: item.state,
    questions: req.questions,
    namespace: req.namespace,
  })

  let verdict: AskResult["verdict"]
  if (req.keep.length > 0) {
    const referenced = new Set(req.keep.map((f) => f.question))
    verdict = result.undecided.some((q) => referenced.has(q))
      ? "undecided"
      : req.keep.every((f) => matches(result.answers, f))
        ? "kept"
        : "dropped"
  }

  return {
    ...(req.spec ? { spec: req.spec.name } : {}),
    id: item.id,
    ...(item.path ? { path: item.path } : {}),
    ...(item.lines ? { lines: item.lines } : {}),
    source: result.source,
    model: result.model,
    servedBy: result.servedBy,
    answers: result.answers,
    undecided: result.undecided,
    ...(verdict ? { verdict } : {}),
    usage: result.usage,
    latencyMs: result.latencyMs,
    skipped: summariseSkipped(prepared.skipped),
    redactions: { total: prepared.redactions.total, items: prepared.redactions.items },
  }
}
