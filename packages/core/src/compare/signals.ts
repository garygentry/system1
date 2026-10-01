/**
 * `compare`'s measured signals (M11, plan m11-adopt D3), as pure functions over
 * the answers both sides gave to the same states. Agreement is data, never a
 * score: without labels nothing here says which side is right.
 *
 * Ported in spirit from `jev-poc/shared/baseline.ts` `compare()`: two answers
 * agree on the same choice, the same rounded level, or the same side of 0.5.
 */
import type { BaselineAnswer, BaselineAnswers } from "../baseline/parse.js"
import type { Answer, Answers, Question, QuestionSet, QuestionType, Usage } from "../model/types.js"

/** Do two answers point the same way? Loose on purpose: the disagreements are the interesting part. */
export function agrees(jev: Answer | BaselineAnswer, other: BaselineAnswer): boolean {
  if (jev.type === "choice" && other.type === "choice") return jev.choice === other.choice
  if (jev.type === "score" && other.type === "score") return Math.round(jev.score) === other.score
  if (jev.type === "noul" && other.type === "noul") return jev.noul >= 0.5 === other.noul >= 0.5
  return false
}

/** An answer as one short value, for a disagreement listing. Never the state. */
export function describeAnswer(answer: Answer | BaselineAnswer): string {
  if (answer.type === "choice") return answer.choice
  if (answer.type === "score")
    return Number.isInteger(answer.score) ? String(answer.score) : answer.score.toFixed(2)
  return answer.noul.toFixed(2)
}

/** How sure an answer is, 0–1: a calibrated confidence, or a noul's distance from 0.5. */
function decisiveness(answer: Answer | BaselineAnswer): number | undefined {
  if (answer.type === "noul") return Math.abs(2 * answer.noul - 1)
  return "confidence" in answer ? answer.confidence : undefined
}

export interface Rate {
  n: number
  hits: number
  /** `hits / n`, or null when `n` is 0. */
  rate: number | null
}

const rate = (hits: number, n: number): Rate => ({ n, hits, rate: n > 0 ? hits / n : null })

/** One row's answers from both sides, after the calls. */
export interface RowAnswers {
  id: string
  /** Jev's answers, and the names it left undecided. Absent when its call failed. */
  jev?: { answers: Answers; undecided: readonly string[] }
  /** The baseline's answers. Absent when its call failed or the reply didn't parse. */
  baseline?: BaselineAnswers
  /** Ground truth for some questions, when a labels file names this row. */
  label?: BaselineAnswers
}

export interface Agreement {
  byQuestion: Record<string, Rate & { type: QuestionType; jevUndecided: number }>
  byType: Partial<Record<QuestionType, Rate>>
  overall: Rate
}

/**
 * Agreement on each question, over the rows where both sides answered and Jev
 * was decided. An undecided Jev answer is counted apart (`jevUndecided`), not
 * as a disagreement: it declined to answer.
 */
export function agreement(questions: QuestionSet, rows: readonly RowAnswers[]): Agreement {
  const byQuestion: Agreement["byQuestion"] = {}
  const byType: Partial<Record<QuestionType, { n: number; hits: number }>> = {}
  let n = 0
  let hits = 0
  for (const [name, question] of Object.entries(questions)) {
    let qn = 0
    let qhits = 0
    let undecided = 0
    for (const row of rows) {
      const a = row.jev?.answers[name]
      const b = row.baseline?.[name]
      if (!a || !b) continue
      if (row.jev?.undecided.includes(name)) {
        undecided += 1
        continue
      }
      qn += 1
      if (agrees(a, b)) qhits += 1
    }
    byQuestion[name] = { type: question.type, ...rate(qhits, qn), jevUndecided: undecided }
    const t = byType[question.type] ?? { n: 0, hits: 0 }
    byType[question.type] = t
    t.n += qn
    t.hits += qhits
    n += qn
    hits += qhits
  }
  return {
    byQuestion,
    byType: Object.fromEntries(
      Object.entries(byType).map(([type, t]) => [type, rate(t.hits, t.n)]),
    ) as Agreement["byType"],
    overall: rate(hits, n),
  }
}

export interface Accuracy {
  byQuestion: Record<string, Rate & { unanswered: number }>
  overall: Rate & { unanswered: number }
}

/**
 * Accuracy against labels, per side: correct means agreeing with the label by
 * the same rule as `agrees`. A labelled question a side didn't answer (a
 * failed call, a parse failure, or Jev undecided) is `unanswered`, not wrong,
 * and never in `n`, so each rate says how many it rests on.
 */
export function accuracy(
  questions: QuestionSet,
  rows: readonly RowAnswers[],
  side: "jev" | "baseline",
): Accuracy {
  const byQuestion: Accuracy["byQuestion"] = {}
  let n = 0
  let hits = 0
  let unanswered = 0
  for (const name of Object.keys(questions)) {
    let qn = 0
    let qhits = 0
    let qmissing = 0
    for (const row of rows) {
      const label = row.label?.[name]
      if (!label) continue
      const answer =
        side === "jev"
          ? row.jev && !row.jev.undecided.includes(name)
            ? row.jev.answers[name]
            : undefined
          : row.baseline?.[name]
      if (!answer) {
        qmissing += 1
        continue
      }
      qn += 1
      if (agrees(answer, label)) qhits += 1
    }
    byQuestion[name] = { ...rate(qhits, qn), unanswered: qmissing }
    n += qn
    hits += qhits
    unanswered += qmissing
  }
  return { byQuestion, overall: { ...rate(hits, n), unanswered } }
}

export interface CostSignal {
  /** Answers this side gave whose cost was measured or reported. */
  calls: number
  /** Measured or reported total, USD. Null when nothing was reported: unknown, never zero. */
  total: number | null
  perCall: number | null
  /** False when some call's cost is unknown: `total` is then a lower bound. */
  complete: boolean
}

/** Cost from per-row usage; `undefined` marks a call whose cost nobody reported. */
export function costSignal(usages: ReadonlyArray<Usage | undefined>): CostSignal {
  const present = usages.filter((u): u is Usage => u !== undefined && Number.isFinite(u.cost))
  const complete =
    usages.length > 0 &&
    present.length === usages.length &&
    present.every((u) => u.reported !== false)
  // A usage marked unreported with a zero cost measured nothing at all.
  const measured = present.filter((u) => u.reported !== false || u.cost > 0)
  if (measured.length === 0)
    return { calls: usages.length, total: null, perCall: null, complete: false }
  const total = present.reduce((sum, u) => sum + Math.max(0, u.cost), 0)
  return { calls: usages.length, total, perCall: total / usages.length, complete }
}

export interface LatencySignal {
  n: number
  meanMs: number | null
  p50Ms: number | null
  p95Ms: number | null
}

export function latencySignal(values: ReadonlyArray<number | undefined>): LatencySignal {
  const ms = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0,
  )
  if (ms.length === 0) return { n: 0, meanMs: null, p50Ms: null, p95Ms: null }
  const sorted = [...ms].sort((a, b) => a - b)
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] as number
  return {
    n: ms.length,
    meanMs: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length),
    p50Ms: at(0.5),
    p95Ms: at(0.95),
  }
}

/**
 * Mean decisiveness per question type, 0–1: Jev's calibrated confidence (a
 * noul's distance from 0.5). A single choice or score value has no spread, so
 * the baseline's is null there; its noul's distance from 0.5 still counts.
 */
export function decisivenessByType(
  questions: QuestionSet,
  rows: readonly RowAnswers[],
): Partial<Record<QuestionType, { jev: number | null; baseline: number | null }>> {
  const out: Partial<Record<QuestionType, { jev: number | null; baseline: number | null }>> = {}
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const types = new Set(Object.values(questions).map((q: Question) => q.type))
  for (const type of types) {
    const names = Object.entries(questions)
      .filter(([, q]) => q.type === type)
      .map(([name]) => name)
    const jev: number[] = []
    const base: number[] = []
    for (const row of rows)
      for (const name of names) {
        const a = row.jev?.answers[name]
        const b = row.baseline?.[name]
        const da = a ? decisiveness(a) : undefined
        const db = b ? decisiveness(b) : undefined
        if (da !== undefined) jev.push(da)
        if (db !== undefined) base.push(db)
      }
    out[type] = { jev: mean(jev), baseline: mean(base) }
  }
  return out
}

/** Share of Jev's answers too flat to act on, over every answer it gave. */
export function undecidedShare(questions: QuestionSet, rows: readonly RowAnswers[]): Rate {
  let n = 0
  let hits = 0
  for (const row of rows) {
    if (!row.jev) continue
    for (const name of Object.keys(questions)) {
      if (!row.jev.answers[name]) continue
      n += 1
      if (row.jev.undecided.includes(name)) hits += 1
    }
  }
  return rate(hits, n)
}

export interface Disagreement {
  id: string
  question: string
  jev: string
  baseline: string
}

/** Every decided disagreement, in row then question order. */
export function disagreements(questions: QuestionSet, rows: readonly RowAnswers[]): Disagreement[] {
  const out: Disagreement[] = []
  for (const row of rows)
    for (const name of Object.keys(questions)) {
      const a = row.jev?.answers[name]
      const b = row.baseline?.[name]
      if (!a || !b || row.jev?.undecided.includes(name) || agrees(a, b)) continue
      out.push({ id: row.id, question: name, jev: describeAnswer(a), baseline: describeAnswer(b) })
    }
  return out
}
