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

/**
 * The `--keep` grammar, shared by answer filters and record filters
 * (`decide opportunities list`): `<name>[.<path>]<op><value>`.
 */
export interface FilterTokens {
  name: string
  /** The dotted path after the name, without the leading dot; "" when absent. */
  path: string
  op: Op
  value: number | string | string[]
}

export function tokenizeFilter(text: string): FilterTokens | undefined {
  const m = FILTER.exec(text)
  if (!m?.[1] || !m[3] || m[4] === undefined) return undefined
  const op = m[3].trim() as Op
  const raw = m[4]
  const value: FilterTokens["value"] =
    op === "in"
      ? raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : isNumeric(raw)
        ? Number(raw)
        : raw
  return { name: m[1], path: m[2] ? m[2].slice(1) : "", op, value }
}

/** The `--sort` grammar: `<name>[.<path>][:asc|desc]`. */
export function tokenizeSort(
  text: string,
): { name: string; path: string; direction: "asc" | "desc" } | undefined {
  const m = /^\s*([A-Za-z_][\w-]*)((?:\.[\w-]+)*)(?::(asc|desc))?\s*$/.exec(text)
  if (!m?.[1]) return undefined
  return {
    name: m[1],
    path: m[2] ? m[2].slice(1) : "",
    direction: (m[3] as "asc" | "desc" | undefined) ?? "desc",
  }
}

/** Parse `relevant>=0.7`, `kind=fix`, `kind in fix,feature`, `kind.probabilities.fix>=0.5`. */
export function parseFilter(text: string, questions?: QuestionSet): Filter {
  const t = tokenizeFilter(text)
  if (!t) {
    throw new DecisionsError(
      "invalid-request",
      `Cannot parse --keep "${text}". Use <question>[.<field>]<op><value>, e.g. relevant>=0.7 or kind in fix,feature`,
    )
  }
  const question = t.name
  const op = t.op
  const field = t.path || defaultField(question, questions)
  const value = t.value
  const filter: Filter = { question, field, op, value, source: text }
  if (questions) assertKnown(question, questions, text)
  if ((op === ">" || op === ">=" || op === "<" || op === "<=") && typeof value !== "number") {
    throw new DecisionsError("invalid-request", `--keep "${text}": ${op} needs a number`)
  }
  return filter
}

/** Parse `relevant`, `relevant.noul:asc`, `risk.score:desc`. Defaults to descending. */
export function parseSort(text: string, questions?: QuestionSet): SortKey {
  const t = tokenizeSort(text)
  if (!t) {
    throw new DecisionsError(
      "invalid-request",
      `Cannot parse --sort "${text}". Use <question>[.<field>][:asc|desc]`,
    )
  }
  if (questions) assertKnown(t.name, questions, text)
  const field = t.path || sortField(t.name, questions)
  return { question: t.name, field, direction: t.direction }
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
  /** Kept when any of these matches (and every `keep` does). */
  keepAny?: readonly Filter[]
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

export interface Verdict {
  verdict: "kept" | "dropped" | "undecided"
  /** For `undecided`: the questions whose flat answers could change the outcome. */
  questions: string[]
}

/**
 * One row's verdict under `keep` (all must match) and `keepAny` (at least one
 * must match).
 *
 * A flat answer on a `keep` or `sort` question makes the row undecided, as
 * before. A flat `keepAny` answer only does when it could change the outcome:
 * if a decided `keepAny` filter already matches, the row is kept; if none
 * matches and none is flat, it is dropped. With no filters and no sort, every
 * question counts.
 */
export function verdictOf(
  answers: Answers,
  flat: readonly string[],
  keep: readonly Filter[],
  keepAny: readonly Filter[] = [],
  sortQuestion?: string,
): Verdict {
  const acted = [...keep.map((f) => f.question), ...(sortQuestion ? [sortQuestion] : [])]
  const all = acted.length === 0 && keepAny.length === 0
  const blocking = flat.filter((q) => all || acted.includes(q))
  if (blocking.length > 0) return { verdict: "undecided", questions: [...blocking] }
  if (!keep.every((f) => matches(answers, f))) return { verdict: "dropped", questions: [] }
  if (keepAny.length === 0) return { verdict: "kept", questions: [] }
  const decided = keepAny.filter((f) => !flat.includes(f.question))
  if (decided.some((f) => matches(answers, f))) return { verdict: "kept", questions: [] }
  const open = [...new Set(keepAny.filter((f) => flat.includes(f.question)).map((f) => f.question))]
  return open.length > 0
    ? { verdict: "undecided", questions: open }
    : { verdict: "dropped", questions: [] }
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
  const keepAny = input.keepAny ?? []
  const kept: T[] = []
  const undecided: Array<{ row: T; questions: string[] }> = []
  let dropped = 0
  for (const row of input.rows) {
    const v = verdictOf(row.answers, input.undecidedOf(row), keep, keepAny, input.sort?.question)
    if (v.verdict === "undecided") undecided.push({ row, questions: v.questions })
    else if (v.verdict === "kept") kept.push(row)
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
