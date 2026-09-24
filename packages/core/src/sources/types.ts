import type { State } from "../model/types.js"

/**
 * Where the content to judge comes from. The agent names a source and the
 * engine reads it, so the agent never pastes content into a command (charter
 * principle 1: state by reference, not by value).
 *
 * There is deliberately no `command` source (decision 0014): pipe command
 * output into `stdin` instead.
 */
export type SourceSpec =
  | { kind: "text"; text: string; id?: string }
  /** Content the caller already read from stdin. */
  | { kind: "stdin"; text: string }
  | { kind: "file"; path: string; range?: LineRange }
  | { kind: "glob"; patterns: string[] }
  | { kind: "jsonl"; path: string }
  /**
   * `git diff`. With no `range`, working tree changes against `HEAD`; `staged`
   * means the index against `HEAD`. `paths` limits the diff.
   */
  | { kind: "diff"; range?: string; staged?: boolean; paths?: string[] }

/** 1-based and inclusive, as editors show them. */
export interface LineRange {
  start: number
  end: number
}

/** One unit of read content, before splitting. */
export interface Document {
  id: string
  kind: "text" | "file" | "row" | "diff"
  /** Repo-relative path, when the content came from a file. */
  path?: string
  /**
   * The path with symlinks resolved, when it differs from `path`. Excludes are
   * matched against this, so `innocent.txt -> .env` is still withheld.
   */
  realPath?: string
  /** Text content (every kind except structured JSONL rows). */
  text?: string
  /** Parsed value of a JSONL row. */
  data?: unknown
  /** Line number of the first line of `text` in its file (1-based). */
  startLine?: number
}

export interface Skipped {
  path: string
  reason: "binary" | "too-large" | "gitignored" | "excluded" | "outside-repo" | "filtered"
  /** For `excluded` and `filtered`: the pattern that matched. */
  detail?: string
}

/** One thing to send: a state, labelled with where it came from. */
export interface Item {
  id: string
  state: State
  path?: string
  /** See `Document.realPath`. */
  realPath?: string
  /** 1-based inclusive line span in `path`, when known. */
  lines?: LineRange
}
