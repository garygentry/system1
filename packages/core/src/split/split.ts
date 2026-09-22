import { DecisionsError } from "../errors.js"
import type { Document, Item } from "../sources/types.js"

/**
 * How documents become items: one item = one state = one decision call.
 *
 * - `file`: each document whole.
 * - `hunk`: each `@@` hunk of a diff document, with its file header for context.
 * - `lines`: windows of `size` lines, overlapping by `overlap`.
 * - `row`: JSONL rows as-is; for text, each non-empty line.
 */
export type SplitSpec =
  | { kind: "file" }
  | { kind: "hunk" }
  | { kind: "lines"; size: number; overlap: number }
  | { kind: "row" }
  /** Every source as one state, joined after excludes (see `prepare`). */
  | { kind: "join" }

/** Parse `file`, `hunk`, `row`, `join`, `lines:40` or `lines:40/10`. */
export function parseSplit(text: string): SplitSpec {
  if (text === "file" || text === "hunk" || text === "row" || text === "join") return { kind: text }
  const match = /^lines:(\d+)(?:\/(\d+))?$/.exec(text)
  if (match) {
    const size = Number(match[1])
    const overlap = Number(match[2] ?? 0)
    if (size < 1 || overlap >= size) {
      throw new DecisionsError(
        "invalid-request",
        `Invalid split "${text}": need size ≥ 1 and overlap < size`,
      )
    }
    return { kind: "lines", size, overlap }
  }
  throw new DecisionsError(
    "invalid-request",
    `Unknown split "${text}" (file, hunk, row, join, lines:N[/overlap])`,
  )
}

export function split(documents: readonly Document[], spec: SplitSpec): Item[] {
  // `join` splits by file first, so excludes still see each file on its own.
  const each: SplitSpec = spec.kind === "join" ? { kind: "file" } : spec
  return documents.flatMap((doc) => splitOne(doc, each))
}

/**
 * One item from many, each part headed by its id. Used by `join` after
 * excludes have run, so a secret-shaped file is never folded in.
 */
export function joinItems(items: readonly Item[]): Item[] {
  if (items.length <= 1) return [...items]
  const text = items
    .map(
      (i) => `--- ${i.id} ---\n${typeof i.state === "string" ? i.state : JSON.stringify(i.state)}`,
    )
    .join("\n\n")
  return [{ id: `joined(${items.length})`, state: text }]
}

function splitOne(doc: Document, spec: SplitSpec): Item[] {
  if (doc.kind === "row") return [rowItem(doc)]
  const text = doc.text ?? ""
  const start = doc.startLine ?? 1
  switch (spec.kind) {
    case "file":
    case "join":
    case "row":
      if (spec.kind === "file" || spec.kind === "join")
        return [base(doc, doc.id, text, doc.kind === "file" ? span(start, text) : undefined)]
      return text
        .split("\n")
        .map((line, i) => ({ line, n: start + i }))
        .filter(({ line }) => line.trim() !== "")
        .map(({ line, n }) => base(doc, `${idRoot(doc)}:${n}`, line, { start: n, end: n }))
    case "lines": {
      const lines = text.split("\n")
      const step = spec.size - spec.overlap
      const items: Item[] = []
      for (let i = 0; i < lines.length; i += step) {
        const chunk = lines.slice(i, i + spec.size)
        const from = start + i
        const to = from + chunk.length - 1
        items.push(
          base(doc, `${idRoot(doc)}:${from}-${to}`, chunk.join("\n"), { start: from, end: to }),
        )
        if (i + spec.size >= lines.length) break
      }
      return items
    }
    case "hunk":
      if (doc.kind !== "diff") {
        throw new DecisionsError(
          "invalid-request",
          `split "hunk" needs a diff source, but ${doc.id} is not a diff`,
        )
      }
      return hunks(doc)
  }
}

function hunks(doc: Document): Item[] {
  const text = doc.text ?? ""
  const headerEnd = text.search(/^@@ /m)
  if (headerEnd < 0) return [base(doc, `${doc.path}#h0`, text)] // binary or mode-only change
  const header = text
    .slice(0, headerEnd)
    .split("\n")
    .filter((l) => l.startsWith("--- ") || l.startsWith("+++ "))
    .join("\n")
  return text
    .slice(headerEnd)
    .split(/^(?=@@ )/m)
    .map((hunk, i) => {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(hunk)
      const from = Number(m?.[1] ?? 0)
      const count = Number(m?.[2] ?? 1)
      const lines = count > 0 ? { start: from, end: from + count - 1 } : undefined
      return base(doc, `${doc.path}#h${i + 1}`, `${header}\n${hunk.replace(/\n$/, "")}`, lines)
    })
}

function rowItem(doc: Document): Item {
  return {
    id: doc.id,
    state: doc.data as Item["state"],
    ...(doc.path ? { path: doc.path } : {}),
    ...(doc.startLine ? { lines: { start: doc.startLine, end: doc.startLine } } : {}),
  }
}

function base(
  doc: Document,
  id: string,
  text: string,
  lines?: { start: number; end: number },
): Item {
  return { id, state: text, ...(doc.path ? { path: doc.path } : {}), ...(lines ? { lines } : {}) }
}

function span(start: number, text: string) {
  return { start, end: start + text.split("\n").length - 1 }
}

/** A document id without any line suffix, so window ids read `path:10-49`. */
function idRoot(doc: Document): string {
  return doc.path ?? doc.id
}
