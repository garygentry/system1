/**
 * Reading what `compare` measures (M11, plan m11-adopt D3): the shadow
 * harness's capture and, when there is one, a labels file. The engine runs no
 * user code (0014): the harness ran the current mechanism and mapped its
 * output into the question set's answer space before writing these rows.
 *
 * - `.system1/compare/<spec>/captured.jsonl`: `{id, state, current?, output?, usage?, latencyMs?}`
 * - `.system1/labels/<spec>.jsonl`: `{id, labels: {<question>: <value>}}`
 *
 * A bad line is reported with its number and left out, never fatal: one torn
 * line shouldn't throw away a capture that took real traffic to gather.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type BaselineAnswers,
  BaselineParseError,
  parseBaseline,
  parseBaselineValue,
} from "../baseline/parse.js"
import { stateDir } from "../config/load.js"
import { DecisionsError } from "../errors.js"
import type { QuestionSet, State, Usage } from "../model/types.js"

export interface CapturedRow {
  id: string
  /** 1-based line in the file. */
  line: number
  state: State
  /** The current mechanism's answers, parsed strictly; absent with `currentError`. */
  current?: BaselineAnswers
  /** Why `current` isn't answers: missing, or a value outside the answer space. */
  currentError?: string
  /** What the current mechanism cost; absent means unknown, never zero. */
  usage?: Usage
  latencyMs?: number
}

export interface BadLine {
  line: number
  reason: string
}

export function compareDir(repoRoot: string, spec: string): string {
  return join(stateDir(repoRoot), "compare", spec)
}

export function labelsPath(repoRoot: string, spec: string): string {
  return join(stateDir(repoRoot), "labels", `${spec}.jsonl`)
}

/** JSON lines with their 1-based numbers; blank lines are skipped. */
function lines(file: string): Array<{ line: number; value?: unknown; error?: string }> {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((text, i): Array<{ line: number; value?: unknown; error?: string }> => {
      if (text.trim() === "") return []
      try {
        return [{ line: i + 1, value: JSON.parse(text) as unknown }]
      } catch {
        return [{ line: i + 1, error: "not JSON" }]
      }
    })
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * The capture's rows. A missing file is `source-error` naming where it is
 * expected and what writes it.
 */
export function readCaptured(
  file: string,
  questions: QuestionSet,
): { rows: CapturedRow[]; bad: BadLine[] } {
  if (!existsSync(file))
    throw new DecisionsError(
      "source-error",
      `No capture at ${file}. The shadow harness that \`adopt\` generates writes it: one JSON line per input, {id, state, current, usage?, latencyMs?}.`,
      { path: file },
    )
  const rows: CapturedRow[] = []
  const bad: BadLine[] = []
  const seen = new Set<string>()
  for (const { line, value, error } of lines(file)) {
    if (error || !isObject(value)) {
      bad.push({ line, reason: error ?? "not a JSON object" })
      continue
    }
    const { id, state } = value
    if (typeof id !== "string" || id.trim() === "") {
      bad.push({ line, reason: "no string id" })
      continue
    }
    if (seen.has(id)) {
      bad.push({ line, reason: `duplicate id "${id}"` })
      continue
    }
    if (typeof state !== "string" && !isObject(state)) {
      bad.push({ line, reason: "state is not a string or an object" })
      continue
    }
    seen.add(id)
    const row: CapturedRow = { id, line, state: state as State }
    if (value.current === undefined || value.current === null)
      row.currentError = "no current answers"
    else
      try {
        row.current = parseBaseline(value.current, questions)
      } catch (e) {
        if (!(e instanceof BaselineParseError)) throw e
        row.currentError = e.message
      }
    const usage = readUsage(value.usage)
    if (usage) row.usage = usage
    if (
      typeof value.latencyMs === "number" &&
      Number.isFinite(value.latencyMs) &&
      value.latencyMs >= 0
    )
      row.latencyMs = value.latencyMs
    rows.push(row)
  }
  return { rows, bad }
}

/**
 * The current mechanism's cost as the harness recorded it: a `cost` in USD,
 * with token counts if known. No finite, non-negative cost means unknown.
 */
function readUsage(raw: unknown): Usage | undefined {
  if (!isObject(raw)) return undefined
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined
  const cost = num(raw.cost)
  if (cost === undefined) return undefined
  return {
    input_tokens: num(raw.input_tokens) ?? 0,
    output_tokens: num(raw.output_tokens) ?? 0,
    cost,
  }
}

/**
 * The labels for a spec, by id, or `undefined` when there is no labels file.
 * A row may label some questions only. A value outside the answer space makes
 * the line bad rather than guessing.
 */
export function readLabels(
  file: string,
  questions: QuestionSet,
): { byId: Map<string, BaselineAnswers>; bad: BadLine[] } | undefined {
  if (!existsSync(file)) return undefined
  const byId = new Map<string, BaselineAnswers>()
  const bad: BadLine[] = []
  for (const { line, value, error } of lines(file)) {
    if (error || !isObject(value)) {
      bad.push({ line, reason: error ?? "not a JSON object" })
      continue
    }
    const { id, labels } = value
    if (typeof id !== "string" || id.trim() === "" || !isObject(labels)) {
      bad.push({ line, reason: "needs {id, labels: {<question>: <value>}}" })
      continue
    }
    if (byId.has(id)) {
      bad.push({ line, reason: `duplicate id "${id}"` })
      continue
    }
    try {
      const parsed: BaselineAnswers = {}
      for (const [name, v] of Object.entries(labels)) {
        const question = Object.hasOwn(questions, name) ? questions[name] : undefined
        if (!question) throw new BaselineParseError(`"${name}" is not a question of this spec`)
        parsed[name] = parseBaselineValue(name, question, v)
      }
      byId.set(id, parsed)
    } catch (e) {
      if (!(e instanceof BaselineParseError)) throw e
      bad.push({ line, reason: e.message })
    }
  }
  return { byId, bad }
}
