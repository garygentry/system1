import { DecisionsError } from "../errors.js"
import { confidenceOf } from "../model/answers.js"
import type { Answer, Answers, QuestionSet } from "../model/types.js"

/**
 * Projection: the engine returns only what the agent will act on (charter
 * principle 2). Filters, sort and field selection are parsed from a small
 * string syntax so they fit on a command line and in a spec file.
 */

export type Op = ">=" | ">" | "<=" | "<" | "=" | "!=" | "in"

export interface Filter {
  question: string
  /** Dotted path into the answer, e.g. `noul`, `choice`, `probabilities.fix`. */
  field: string
  op: Op
  value: number | string | string[]
  /** The original text, for error messages and echoing back. */
  source: string
}

export interface SortKey {
  question: string
  field: string
  direction: "asc" | "desc"
}

const FILTER = /^\s*([A-Za-z_][\w-]*)((?:\.[\w-]+)*)\s*(>=|<=|!=|>|<|=|\s+in\s+)\s*(.+?)\s*$/

/** Parse `relevant>=0.7`, `kind=fix`, `kind in fix,feature`, `kind.probabilities.fix>=0.5`. */
export function parseFilter(text: string, questions?: QuestionSet): Filter {
  const m = FILTER.exec(text)
  if (!m?.[1] || !m[3] || m[4] === undefined) {
    throw new DecisionsError(
      "invalid-request",
      `Cannot parse --keep "${text}". Use <question>[.<field>]<op><value>, e.g. relevant>=0.7 or kind in fix,feature`,
    )
  }
  const question = m[1]
  const op = m[3].trim() as Op
  const field = m[2] ? m[2].slice(1) : defaultField(question, questions)
  const raw = m[4]
  const value: Filter["value"] =
    op === "in"
      ? raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : isNumeric(raw)
        ? Number(raw)
        : raw
  const filter: Filter = { question, field, op, value, source: text }
  if (questions) assertKnown(question, questions, text)
  if ((op === ">" || op === ">=" || op === "<" || op === "<=") && typeof value !== "number") {
    throw new DecisionsError("invalid-request", `--keep "${text}": ${op} needs a number`)
  }
  return filter
}

/** Parse `relevant`, `relevant.noul:asc`, `risk.score:desc`. Defaults to descending. */
export function parseSort(text: string, questions?: QuestionSet): SortKey {
  const m = /^\s*([A-Za-z_][\w-]*)((?:\.[\w-]+)*)(?::(asc|desc))?\s*$/.exec(text)
  if (!m?.[1]) {
    throw new DecisionsError(
      "invalid-request",
      `Cannot parse --sort "${text}". Use <question>[.<field>][:asc|desc]`,
    )
  }
  if (questions) assertKnown(m[1], questions, text)
  const field = m[2] ? m[2].slice(1) : sortField(m[1], questions)
  return { question: m[1], field, direction: (m[3] as "asc" | "desc" | undefined) ?? "desc" }
}

export function matches(answers: Answers, filter: Filter): boolean {
  const actual = read(answers[filter.question], filter.field)
  switch (filter.op) {
    case "in":
      return (filter.value as string[]).includes(String(actual))
    case "=":
      return String(actual) === String(filter.value)
    case "!=":
      return String(actual) !== String(filter.value)
    default: {
      if (typeof actual !== "number") return false
      const v = filter.value as number
      return filter.op === ">="
        ? actual >= v
        : filter.op === ">"
          ? actual > v
          : filter.op === "<="
            ? actual <= v
            : actual < v
    }
  }
}

export interface ProjectInput<T extends { answers: Answers }> {
  rows: readonly T[]
  keep?: readonly Filter[]
  sort?: SortKey
  limit?: number
  fields?: readonly string[]
  /** Names of each row's undecided answers. */
  undecidedOf: (row: T) => readonly string[]
}

export interface Projected<T> {
  kept: T[]
  /** Kept before `limit` cut it down. */
  keptTotal: number
  /** Rows whose relevant answers are too flat to judge: for the agent or a human. */
  undecided: Array<{ row: T; questions: string[] }>
  dropped: number
}

/**
 * Split rows into kept / undecided / dropped.
 *
 * Undecided is decided first and is never subject to a threshold. A flat
 * answer rounded into "kept" or "dropped" would be acting on noise (charter
 * principle 4).
 *
 * Every question the projection *acts on* counts: those `keep` filters on and
 * the one `sort` ranks by. (Sorting was missed before: an item ranked first by
 * an undecided score was kept, and reported as decided.) With neither, every
 * question counts.
 */
export function project<T extends { answers: Answers }>(input: ProjectInput<T>): Projected<T> {
  const keep = input.keep ?? []
  const acted = [...keep.map((f) => f.question), ...(input.sort ? [input.sort.question] : [])]
  const relevant = acted.length > 0 ? new Set(acted) : undefined
  const kept: T[] = []
  const undecided: Array<{ row: T; questions: string[] }> = []
  let dropped = 0
  for (const row of input.rows) {
    const flat = input.undecidedOf(row).filter((q) => !relevant || relevant.has(q))
    if (flat.length > 0) undecided.push({ row, questions: [...flat] })
    else if (keep.every((f) => matches(row.answers, f))) kept.push(row)
    else dropped += 1
  }
  if (input.sort) {
    const { question, field, direction } = input.sort
    const sign = direction === "asc" ? 1 : -1
    kept.sort(
      (a, b) =>
        sign * (num(read(a.answers[question], field)) - num(read(b.answers[question], field))),
    )
  }
  const keptTotal = kept.length
  const limited = input.limit !== undefined ? kept.slice(0, input.limit) : kept
  const withFields = input.fields
    ? limited.map((row) => pickAnswers(row, input.fields as string[]))
    : limited
  return { kept: withFields, keptTotal, undecided, dropped }
}

function pickAnswers<T extends { answers: Answers }>(row: T, fields: readonly string[]): T {
  return {
    ...row,
    answers: Object.fromEntries(Object.entries(row.answers).filter(([k]) => fields.includes(k))),
  }
}

function read(answer: Answer | undefined, field: string): unknown {
  if (!answer) return undefined
  if (field === "confidence") return confidenceOf(answer)
  let value: unknown = answer
  for (const part of field.split(".")) {
    value =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)[part]
        : undefined
  }
  return value
}

function defaultField(question: string, questions?: QuestionSet): string {
  const type = questions?.[question]?.type
  return type ?? "noul"
}

/** Choices sort by confidence (their winner is a label, not a number). */
function sortField(question: string, questions?: QuestionSet): string {
  const type = questions?.[question]?.type
  return type === "choice" ? "confidence" : (type ?? "noul")
}

function assertKnown(question: string, questions: QuestionSet, text: string): void {
  if (!(question in questions)) {
    throw new DecisionsError(
      "invalid-request",
      `"${text}" names question "${question}", which is not in the question set (${Object.keys(questions).join(", ")})`,
    )
  }
}

function isNumeric(text: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(text)
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number.NEGATIVE_INFINITY
}
